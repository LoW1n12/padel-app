# webapp_server.py

import asyncio
import hmac
import hashlib
import json
import logging
from datetime import date, timedelta
from functools import wraps
from urllib.parse import parse_qsl

from aiohttp import web
import aiohttp_cors

from config import BOT_TOKEN, LOCATIONS_CONFIG
from database import db
from parser import fetch_availability_for_location_date

logger = logging.getLogger(__name__)


# ================== БЕЗОПАСНОСТЬ: ПРОВЕРКА ДАННЫХ TELEGRAM ==================

def is_safe_data(init_data: str) -> (bool, dict):
    """Проверяет подлинность данных, полученных от Telegram Mini App."""
    if not BOT_TOKEN:
        logger.error("WebApp Auth: BOT_TOKEN не найден, проверка невозможна.")
        return False, {}

    try:
        parsed_data = dict(parse_qsl(init_data))
    except ValueError:
        return False, {}

    if "hash" not in parsed_data:
        return False, {}

    hash_from_telegram = parsed_data.pop('hash')

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))

    secret_key = hmac.new("WebAppData".encode(), BOT_TOKEN.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if calculated_hash == hash_from_telegram:
        try:
            user_data = json.loads(parsed_data.get("user", "{}"))
            return True, user_data
        except json.JSONDecodeError:
            return False, {}

    logger.warning(f"WebApp Auth: Неудачная проверка хеша для {parsed_data.get('user')}")
    return False, {}


def auth_required(handler):
    """Декоратор для защиты эндпоинтов, требующих авторизации."""

    @wraps(handler)
    async def wrapper(request):
        init_data = request.headers.get("X-Telegram-Init-Data")
        if not init_data:
            try:
                body = await request.json()
                init_data = body.get("initData")
            except (json.JSONDecodeError, TypeError):
                init_data = None

        if not init_data:
            logger.warning("WebApp Auth: Запрос без initData.")
            return web.json_response({"error": "Authorization required"}, status=401)

        is_safe, user_data = is_safe_data(init_data)

        if not is_safe:
            return web.json_response({"error": "Invalid authorization data"}, status=403)

        return await handler(request, user_data)

    return wrapper


# ================== ОБРАБОТЧИКИ API-ЭНДПОИНТОВ ==================

async def get_locations(request):
    """Возвращает список локаций для фронтенда."""
    logger.info("WebApp API: Получен запрос на /api/locations")
    locations_list = [
        {"id": key, "name": value.get('display_in_case', key).replace("в ", "").replace("на ", ""), "description": key}
        for key, value in LOCATIONS_CONFIG.items()
    ]
    logger.debug(f"WebApp API: Отправка {len(locations_list)} локаций.")
    return web.json_response({"locations": locations_list})


async def get_calendar_data(request):
    """Возвращает даты, на которые есть свободные сеансы."""
    location_id = request.query.get("location_id")
    logger.info(f"WebApp API: Получен запрос на /api/calendar для location_id='{location_id}'")

    if not location_id or location_id not in LOCATIONS_CONFIG:
        logger.error(f"WebApp API: Неверный location_id='{location_id}'")
        return web.json_response({"error": "location_id is required or invalid"}, status=400)

    # Проверяем на 30 дней вперед
    today = date.today()
    dates_to_check = [today + timedelta(days=i) for i in range(30)]
    session = request.app['aiohttp_session']

    logger.debug(f"WebApp API: Запускаю проверку доступности для '{location_id}' на {len(dates_to_check)} дней.")
    tasks = [fetch_availability_for_location_date(session, location_id, d) for d in dates_to_check]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    available_dates = []
    for d, res in zip(dates_to_check, results):
        if isinstance(res, Exception):
            logger.error(f"WebApp API: Ошибка при получении данных для {d}: {res}")
            continue

        if res:  # Если словарь не пустой
            logger.debug(f"WebApp API: Найдена доступность на {d} для '{location_id}'. Данные: {res}")
            available_dates.append(d.isoformat())

    logger.info(f"WebApp API: Для '{location_id}' найдено {len(available_dates)} доступных дат. Отправляю на фронтенд.")
    return web.json_response({"available_dates": available_dates})


async def get_sessions_for_date(request):
    """Возвращает детальную информацию о сеансах на конкретную дату."""
    location_id = request.query.get("location_id")
    date_str = request.query.get("date")
    logger.info(f"WebApp API: Получен запрос на /api/sessions для location_id='{location_id}', date='{date_str}'")

    if not location_id or not date_str:
        return web.json_response({"error": "location_id and date are required"}, status=400)

    try:
        check_date = date.fromisoformat(date_str)
    except ValueError:
        logger.error(f"WebApp API: Неверный формат даты: '{date_str}'")
        return web.json_response({"error": "Invalid date format"}, status=400)

    session = request.app['aiohttp_session']
    logger.debug(f"WebApp API: Запрашиваю парсер для '{location_id}' на дату {check_date}...")
    availability = await fetch_availability_for_location_date(session, location_id, check_date)

    sessions = []
    if availability:
        logger.debug(f"WebApp API: Парсер вернул данные: {availability}")
        for time_str, courts in sorted(availability.items()):
            details = " | ".join([f"{name} ({data['price']}₽)" for name, data in sorted(courts.items())])
            sessions.append({"time": time_str, "details": details})
    else:
        logger.warning(f"WebApp API: Парсер вернул пустой ответ для '{location_id}' на {check_date}.")

    logger.info(f"WebApp API: Отправляю {len(sessions)} сеансов на фронтенд.")
    return web.json_response({"sessions": sessions})


@auth_required
async def add_notification(request, user_data):
    """Добавляет подписку на уведомления для пользователя."""
    try:
        body = await request.json()
        location_id = body.get("location_id")
        date_str = body.get("date")
        logger.info(
            f"WebApp API: Получен запрос на /api/notify от user_id={user_data.get('id')} на {location_id} ({date_str})")
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    if not location_id or not date_str:
        return web.json_response({"error": "location_id and date are required"}, status=400)

    user_id = user_data.get("id")
    if not user_id:
        return web.json_response({"error": "Failed to identify user"}, status=400)

    monitor_data = {"type": "specific", "value": date_str}
    hour = -1
    court_types = list(LOCATIONS_CONFIG.get(location_id, {}).get("courts", {}).keys())

    if not court_types:
        return web.json_response({"error": "Invalid location"}, status=400)

    db.add_user_time(user_id, location_id, hour, court_types, monitor_data)
    logger.info(f"WebApp API: Успешно добавлена подписка через WebApp для user_id={user_id}.")

    return web.json_response({"status": "ok", "message": "Уведомление добавлено!"})


# ================== НАСТРОЙКА И ЗАПУСК СЕРВЕРА ==================

def setup_webapp_routes(app):
    """Настраивает все маршруты для веб-приложения."""
    app.router.add_get("/api/locations", get_locations)
    app.router.add_get("/api/calendar", get_calendar_data)
    app.router.add_get("/api/sessions", get_sessions_for_date)
    app.router.add_post("/api/notify", add_notification)


async def create_webapp_server(host='0.0.0.0', port=8080, bot_app=None):
    """Создает и запускает aiohttp веб-сервер."""
    webapp = web.Application()
    webapp['aiohttp_session'] = bot_app.bot_data['aiohttp_session']
    setup_webapp_routes(webapp)

    cors = aiohttp_cors.setup(webapp, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True, expose_headers="*", allow_headers="*",
        )
    })
    for route in list(webapp.router.routes()):
        cors.add(route)

    runner = web.AppRunner(webapp)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    logger.info(f"🚀 Веб-сервер для Mini App запущен на http://{host}:{port}")
    await site.start()
    return site
