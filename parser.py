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
              'subServiceIds': court_config['subServiceIds'][0]}
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
    payload_timeslots = {"context": {"location_id": int(location_id)},
                         "filter": {"date": date_str, "records": [{"attendance_service_items": []}]}}

    try:
        async with session.post(url_timeslots, headers=DEFAULT_HEADERS, json=payload_timeslots, timeout=10) as resp:
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

    tasks = []
    for slot in slots:
        dt = slot.get('attributes', {}).get('datetime', '')
        if dt and dt.endswith(":00:00+03:00"):
            payload = {"context": {"location_id": int(location_id)},
                       "filter": {"datetime": dt, "records": [{"attendance_service_items": []}]}}
            tasks.append(
                asyncio.create_task(session.post(url_services, headers=headers_with_auth, json=payload, timeout=10)))

    if not tasks: return {}
    price_responses = await asyncio.gather(*tasks, return_exceptions=True)

    for resp_or_exc in price_responses:
        if isinstance(resp_or_exc, Exception):
            logger.error(f"YCLIENTS_EXCEPTION: Ошибка в gather при запросе цен: {resp_or_exc}")
            continue

        resp = resp_or_exc
        if resp.status != 200:
            if resp.status == 401:
                logger.warning(f"YCLIENTS: Ошибка 401 (Unauthorized). Токен авторизации, вероятно, истек.")
            else:
                logger.warning(f"YCLIENTS: Ошибка получения цен. Статус {resp.status} для URL {resp.url}")
            continue

        try:
            services_data = await resp.json()
            time_iso = services_data.get('meta', {}).get('context', {}).get('datetime', 'N/A')
            time_str = datetime.fromisoformat(time_iso).strftime('%H:%M') if time_iso != 'N/A' else 'N/A'
            for service in services_data.get('data', []):
                if service.get('id') == service_id:
                    price = service.get('attributes', {}).get('price_min')
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
        court_config = location_config.get('courts', {}).get(court_type)
        if not court_config: return {}

        raw_response = await get_vivacrm_sessions(session, check_date, court_config)
        result_by_time = defaultdict(dict)
        if raw_response and isinstance(raw_response, list) and len(raw_response) > 0:
            timeslots = raw_response[0].get('timeslots', [])
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
