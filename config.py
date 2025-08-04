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
        'description': 'Корты от MoscowPDL',
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
        'description': 'Корты от Padel Friends',
        'company_id': 'b861100',
        'location_id': '804153',
        'courts': {
            'Корт для 4-х': {'service_id': '11654151'},
            'Корт для 2-х': {'service_id': '11663448'}
        }
    },
    'Фили (Дело спорт)': {
        'api_type': 'yclients_fili',
        'description': 'Корты от Lunda Padel',
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
        'description': 'Корты от Lunda Padel',
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
        'description': 'Корты от Lunda Padel',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'в Химках',
        'company_id': "b911781",
        'location_id': '820948',
        'courts': {
            'Корт для 2-х': {'service_id': '12077982'},
            'Корт для 4-х': {'service_id': '11995111'},
            'Ultra корт': {'service_id': '11995098'}
        }
    },
    'Долгопрудный': {
        'api_type': 'vivacrm',
        'booking_link': 'https://paripadel.ru/admiral#booking',
        'description': 'Корты от Pari в яхт-клубе',
        'display_in_case': 'в Долгопрудном',
        'courts': {
            "Закрытый корт": {
                "api_url": "https://api.vivacrm.ru/end-user/api/v1/ucYTIM/products/master-services/bc7ce7e6-40c3-4c23-885a-ac0bf38e90cc/timeslots",
                "studioId": "a20eac9b-0e7e-4d84-9888-52d904feb74e",
                "subServiceIds": ["2d8a66d5-cd3b-4154-b9f7-a54b0f14cad3"]
            }
        }
    },
    'Мытищи': {
        'api_type': 'yclients_fili',
        'description': 'Корты от A33',
        'booking_link': 'https://b918666.yclients.com/company/855029/personal/select-time?o=m-1',
        'display_in_case': 'в Мытищах',
        'company_id': "b918666",
        'location_id': '855029',
        'courts': {
            'Открытый корт': {'service_id': '15554204'}
        }
    },
    'Терехово': {
        'api_type': 'yclients_fili',
        'description': 'Корты от Академии Будущего',
        'booking_link': 'https://n1165596.yclients.com/company/1149911',
        'display_in_case': 'в Терехово',
        'company_id': "n1165596",
        'location_id': '1149911',
        'courts': {
            'Корт 1': {'service_id': '18999132', 'staff_id': '3801338'},
            'Корт 2': {'service_id': '17302417', 'staff_id': '3497691'},
            'Корт 3': {'service_id': '17302417', 'staff_id': '3497812'},
            'Корт 4': {'service_id': '17302417', 'staff_id': '3497820'},
            'Корт 5': {'service_id': '17302417', 'staff_id': '3497822'},
        }
    },

}
