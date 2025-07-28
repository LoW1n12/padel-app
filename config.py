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

# ИЗМЕНЕНО: Добавлена недостающая переменная для URL веб-приложения
MINI_APP_URL = "https://low1n12.github.io/padel-app/" # ЗАМЕНИТЕ НА СВОЙ URL

# ... (все переменные до LOCATIONS_CONFIG без изменений) ...

# --- КОНФИГУРАЦИЯ ЛОКАЦИЙ ---
LOCATIONS_CONFIG = {
    'Лужники': {
        'api_type': 'vivacrm',
        'booking_link': 'https://moscowpdl.ru/#courtrental',
        'display_in_case': 'в Лужниках',
        'description': 'Главные корты Москвы', # ИЗМЕНЕНО: Добавлено описание
        'courts': {
            # ...
        }
    },
    'Лужники-2': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://padelfriends.ru/moscow',
        'display_in_case': 'в Лужниках-2',
        'description': 'Дополнительные корты', # ИЗМЕНЕНО
        'courts': {
            # ...
        }
    },
    'Фили (Дело спорт)': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'на Филях (Дело спорт)',
        'description': 'Клуб в парковой зоне', # ИЗМЕНЕНО
        'courts': {
            # ...
        }
    },
    'Фили (Звезда)': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'на Филях (Звезда)',
        'description': 'Современные корты у воды', # ИЗМЕНЕНО
        'courts': {
            # ...
        }
    },
    'Химки': {
        'api_type': 'yclients_fili',
        'booking_link': 'https://lundapadel.ru/?ysclid=mdnkr2vxjk957475916',
        'display_in_case': 'в Химках',
        'description': 'Корты на севере от Москвы', # ИЗМЕНЕНО
        'courts': {
            # ...
        }
    }
}