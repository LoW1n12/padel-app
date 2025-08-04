# parser.py

import asyncio
import aiohttp
import logging
from datetime import date, datetime
from collections import defaultdict
import json
from typing import Dict, List, Optional

from config import LOCATIONS_CONFIG, YCLIENTS_TOKEN

logger = logging.getLogger(__name__)
DEFAULT_HEADERS = {'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*'}


async def get_vivacrm_sessions(session: aiohttp.ClientSession, check_date: date, court_config: dict) -> List[Dict]:
    params = {'date': check_date.strftime('%Y-%m-%d'), 'studioId': court_config['studioId'],
              'subServiceIds': court_config['subServiceIds']}
    try:
        async with session.get(court_config['api_url'], params=params, headers=DEFAULT_HEADERS, timeout=10) as resp:
            if resp.status == 200:
                return await resp.json()
            logger.warning(f"VIVACRM: Статус {resp.status} для {check_date} по URL {resp.url}")
            return []
    except Exception as e:
        logger.error(f"VIVACRM_EXCEPTION: Ошибка при запросе к vivacrm: {e}", exc_info=True)
        return []


async def get_yclients_fili_sessions(session: aiohttp.ClientSession, check_date: date, location_config: dict,
                                     service_id: str) -> Dict[str, Dict]:
    if not YCLIENTS_TOKEN:
        logger.warning("YCLIENTS: Токен авторизации (YCLIENTS_AUTH_TOKEN) не найден.")
        return {}

    location_id, company_id = location_config['location_id'], location_config['company_id']
    date_str = check_date.strftime('%Y-%m-%d')
    url_timeslots = "https://platform.yclients.com/api/v1/b2c/booking/availability/search-timeslots"

    payload_timeslots = {
        "context": {"location_id": int(location_id)},
        "filter": {"date": date_str, "records": [{"staff_id": -1, "attendance_service_items": []}]}
    }

    try:
        async with session.post(url_timeslots, headers=DEFAULT_HEADERS, json=payload_timeslots, timeout=15) as resp:
            if resp.status != 200:
                logger.warning(
                    f"YCLIENTS: Ошибка получения таймслотов. Статус {resp.status}, URL {url_timeslots}, Payload {payload_timeslots}")
                return {}
            slots = (await resp.json()).get('data', [])
    except Exception as e:
        logger.error(f"YCLIENTS_EXCEPTION: Ошибка при запросе таймслотов: {e}", exc_info=True)
        return {}

    if not slots: return {}

    url_services = f"https://{company_id}.yclients.com/api/v1/booking/search/services/"
    headers_with_auth = {**DEFAULT_HEADERS, 'Authorization': f'Bearer {YCLIENTS_TOKEN}'}
    aggregated_data = defaultdict(dict)

    tasks_with_time = []
    for slot in slots:
        dt = slot.get('attributes', {}).get('datetime', '')
        if dt and dt.endswith((":00:00+03:00", ":30:00+03:00")):
            payload = {"context": {"location_id": int(location_id)},
                       "filter": {"datetime": dt, "records": [{"staff_id": -1, "attendance_service_items": []}]}}
            task = asyncio.create_task(session.post(url_services, headers=headers_with_auth, json=payload, timeout=10))
            tasks_with_time.append((task, dt))

    if not tasks_with_time: return {}

    all_tasks = [t[0] for t in tasks_with_time]
    await asyncio.gather(*all_tasks, return_exceptions=True)

    for task, time_iso in tasks_with_time:
        if task.cancelled() or task.exception():
            logger.error(f"YCLIENTS_EXCEPTION: Ошибка в gather при запросе цен: {task.exception()}")
            continue

        resp = task.result()
        if resp.status != 200:
            if resp.status == 401:
                logger.warning(f"YCLIENTS: Ошибка 401 (Unauthorized). Токен авторизации, вероятно, истек.")
            else:
                logger.warning(f"YCLIENTS: Ошибка получения цен. Статус {resp.status} для URL {resp.url}")
            continue

        try:
            services_data = await resp.json()
            time_obj = datetime.fromisoformat(time_iso)

            if time_obj.minute != 0: continue

            time_str = time_obj.strftime('%H:%M')
            for service in services_data.get('data', []):
                attrs = service.get('attributes', {})
                if attrs.get('duration') == 3600:
                    price = attrs.get('price_min')
                    if price is not None:
                        aggregated_data[time_str] = {'price': price}
                    break
        except Exception as e:
            logger.error(f"YCLIENTS_PARSE_ERROR: Ошибка при обработке ответа от {url_services}: {e}", exc_info=True)
        finally:
            if not resp.closed:
                await resp.release()

    return dict(aggregated_data)


async def get_available_sessions_api(session: aiohttp.ClientSession, check_date: date, location: str,
                                     court_type: str) -> Dict[str, Dict]:
    location_config = LOCATIONS_CONFIG.get(location, {})
    api_type = location_config.get('api_type')

    if api_type == 'vivacrm':
        # ИСПРАВЛЕНО: Добавлен полный код для обработки vivacrm
        court_config = location_config.get('courts', {}).get(court_type)
        if not court_config: return {}

        raw_response = await get_vivacrm_sessions(session, check_date, court_config)
        result_by_time = defaultdict(dict)

        if raw_response and isinstance(raw_response, list) and len(raw_response) > 0:
            # Ответ vivacrm - это список, обычно с одним элементом
            data_block = raw_response[0]
            timeslots = data_block.get('timeslots', [])
            for slot in timeslots:
                time_from_iso = slot.get('timeFrom')
                if time_from_iso and datetime.fromisoformat(time_from_iso).minute == 0:
                    dt_obj = datetime.fromisoformat(time_from_iso)
                    time_str = dt_obj.strftime('%H:%M')
                    price = slot.get('price', {}).get('from', 0)
                    result_by_time[time_str] = {'price': price}
        return dict(result_by_time)

    elif api_type == 'yclients_fili':
        court_config = location_config.get('courts', {}).get(court_type)
        if not court_config or not (service_id := court_config.get('service_id')):
            return {}
        return await get_yclients_fili_sessions(session, check_date, location_config, service_id)

    return {}


async def fetch_availability_for_location_date(session: aiohttp.ClientSession, location: str, check_date: date) -> Dict[
    str, Dict[str, Dict]]:
    location_config = LOCATIONS_CONFIG.get(location, {})
    court_types = location_config.get("courts", {}).keys()

    tasks = [get_available_sessions_api(session, check_date, location, ct) for ct in court_types]
    results_per_type = await asyncio.gather(*tasks)

    aggregated_data = defaultdict(lambda: defaultdict(dict))
    for court_type, result_for_type in zip(court_types, results_per_type):
        if not result_for_type:
            continue
        for time_str, data in result_for_type.items():
            aggregated_data[time_str][court_type] = {'price': data.get('price', 0)}

    return dict(aggregated_data)
