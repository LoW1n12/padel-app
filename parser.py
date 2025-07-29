# parser.py

import logging
from datetime import date, datetime
from typing import Dict, Any, List, Optional
import json

from aiohttp import ClientSession

from config import LOCATIONS_CONFIG

logger = logging.getLogger(__name__)


async def _fetch_vivacrm(session: ClientSession, court_config: Dict[str, Any], check_date: date) -> List[str]:
    # ... (код этой функции не меняется, так как она скорее всего не используется сейчас)
    return []


async def _fetch_yclients_fili(session: ClientSession, company_id: str, location_id: str, service_id: str,
                               check_date: date) -> List[str]:
    """Получает доступное время для одного корта через API YClients."""
    api_url = f"https://api.yclients.com/api/v1/book_times/{company_id}/{location_id}/{service_id}"
    params = {'date': check_date.strftime('%Y-%m-%d')}

    try:
        # ИЗМЕНЕНО: Добавлено подробное логирование запроса
        logger.info(f"[YCLIENTS] Отправка запроса на URL: {api_url} с параметрами: {params}")

        async with session.get(api_url, params=params, headers={
            'Authorization': f"Bearer {LOCATIONS_CONFIG['Химки']['yclients_token']}"}) as response:
            logger.info(f"[YCLIENTS] Статус ответа от API: {response.status}")

            if response.status != 200:
                logger.error(f"[YCLIENTS] Ошибка API: {response.status}, {await response.text()}")
                return []

            # ИЗМЕНЕНО: Получаем и логируем сырой ответ
            raw_text = await response.text()
            logger.info(f"[YCLIENTS] Сырой ответ от API (первые 500 символов): {raw_text[:500]}")

            try:
                data = json.loads(raw_text)
                if isinstance(data, list) and data:
                    return [item['time'] for item in data]
                elif isinstance(data, dict) and 'data' in data and data['data']:
                    return [item['time'] for item in data['data']]
                else:
                    return []
            except json.JSONDecodeError:
                logger.error(f"[YCLIENTS] Не удалось декодировать JSON из ответа: {raw_text}")
                return []

    except Exception as e:
        logger.error(f"[YCLIENTS] Исключение при запросе к YClients: {e}", exc_info=True)
        return []


async def fetch_availability_for_location_date(session: ClientSession, location: str, check_date: date) -> Dict[
    str, Any]:
    # ... (код этой функции без изменений)
    config = LOCATIONS_CONFIG.get(location)
    if not config:
        return {}

    api_type = config.get('api_type')
    all_available_times = {}

    for court_name, court_details in config['courts'].items():
        if api_type == 'vivacrm':
            times = await _fetch_vivacrm(session, court_details, check_date)
        elif api_type == 'yclients_fili':
            times = await _fetch_yclients_fili(session, config['company_id'], config['location_id'],
                                               court_details['service_id'], check_date)
        else:
            times = []

        for time_str in times:
            if time_str not in all_available_times:
                all_available_times[time_str] = {}
            # Предполагаем, что цена одинаковая для всех, можно будет доработать
            all_available_times[time_str][court_name] = {"price": "N/A"}

    return all_available_times


# Добавляем фиктивный токен в конфиг, если его нет, для совместимости
for loc in LOCATIONS_CONFIG.values():
    if 'yclients_fili' in loc.get('api_type', ''):
        loc.setdefault('yclients_token', 'your_default_token_here')

