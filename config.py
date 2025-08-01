# config.py

import os
from dotenv import load_dotenv

# --- ЗАГРУЗКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ---
load_dotenv()

# --- ОСНОВНЫЕ НАСТРОЙКИ БОТА ---
BOT_TOKEN = os.getenv("BOT_TOKEN")
OWNER_ID_STR = os.getenv("OWNER_ID")
YCLIENTS_TOKEN = os.getenv("YCLIENTS_AUTH_TOKEN")

# Проверка наличия обязательных переменных
if not BOT_TOKEN or not OWNER_ID_STR:
    raise ValueError("Критическая ошибка: не найдены BOT_TOKEN или OWNER_ID в .env файле.")

try:
    OWNER_ID = int(OWNER_ID_STR)
except (ValueError, TypeError):
    raise ValueError(f"Критическая ошибка: OWNER_ID ('{OWNER_ID_STR}') должен быть числом.")

# --- КОНСТАНТЫ И НАСТРОЙКИ ПОВЕДЕНИЯ ---
DB_PATH = "bot_users.db"
CHECK_INTERVAL_SECONDS = 60
DEFAULT_RANGE_DAYS = 10
MAX_SPECIFIC_DAYS = 30
ANY_HOUR_PLACEHOLDER = -1

# Константы для продвинутого анти-флуда (Leaky Bucket)
FLOOD_CONTROL_ACTIONS = 5  # Разрешенное количество действий...
FLOOD_CONTROL_PERIOD_SECONDS = 3   # ...за этот период в секундах.

# --- КОНФИГУРАЦИЯ ЛОКАЦИЙ ---
# ИЗМЕНЕНО: Порядок локаций изменен для более релевантной выдачи в меню
LOCATIONS_CONFIG = {
    'Лужники': {
        'api_type': 'vivacrm',
        'booking_link': 'https://moscowpdl.ru/#courtrental',
        'display_in_case': 'в Лужниках',
        'courts': {
            "Открытый корт": {
                "api_url": "https://api.vivacrm.ru/end-user/api/v1/wTksKv/products/master-services/08b5ef55-d1b4-4736-8152-4d5d5c52a4ab/timeslots",
                "studioId": "eec3430e-a54a-4da6-99e5-1ba40bb86352",
                "subServiceIds": ["c77df85e-e9a3-4e44-b5c5-e0ff45d1eefa"]
            },
            "Закрытый корт": {
                "api_url": "https://api.vivacrm.ru/end-user/api/v1/wTksKv/products/master-services/08b5ef55-d1b4-4736-8152-4d5d5c52a4ab/timeslots",
                "studioId": "29d6ab31-4ea1-4613-9738-257741b45cda",
                "subServiceIds": ["d5b658b2-22a9-475d-82d3-f298a2af2ff5"]
            }
        }
    },
    'Лужники-2': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://padelfriends.ru/moscow',
        'display_in_case': 'в Лужниках-2',
        'company_id': 'b861100',
        'location_id': '804153',
        'courts': {
            'Корт для 4-х': {'service_id': '11654151'},
            'Корт для 2-х': {'service_id': '11663448'}
        }
    },
    'Фили (Дело спорт)': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'на Филях (Дело спорт)',
        'company_id': "b911781",
        'location_id': '1168982',
        'courts': {
            'Корт (тип 1)': {'service_id': '17570389'},
            'Корт (тип 2)': {'service_id': '17571377'}
        }
    },
    'Фили (Звезда)': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'на Филях (Звезда)',
        'company_id': "b911781",
        'location_id': '847747',
        'courts': {
            'Корт': {'service_id': '12616669'}
        }
    },
    'Химки': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'в Химках',
        'company_id': "b911781",
        'location_id': '820948',
        'courts': {
            'Корт для 2-х': {'service_id': '12077982'},
            'Корт для 4-х': {'service_id': '11995111'},
            'Ultra корт': {'service_id': '11995098'}
        }
    }
}
