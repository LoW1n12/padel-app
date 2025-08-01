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

from config import BOT_TOKEN, LOCATIONS_CONFIG
from database import db
from parser import fetch_availability_for_location_date

logger = logging.getLogger(__name__)


# ================== БЕЗОПАСНОСТЬ: ПРОВЕРКА ДАННЫХ TELEGRAM ==================

def is_safe_data(init_data: str) -> (bool, dict):
    """Проверяет подлинность данных, полученных от Telegram Mini App."""
    if not BOT_TOKEN:
        return False, {}

    try:
        # Преобразуем строку "key=value&key2=value2" в словарь
        parsed_data = dict(parse_qsl(init_data))
    except ValueError:
        return False, {}

    if "hash" not in parsed_data:
        return False, {}

    hash_from_telegram = parsed_data.pop('hash')

    # Сортируем ключи и формируем строку для проверки
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))

    # Создаем хеш из токена бота
    secret_key = hmac.new("WebAppData".encode(), BOT_TOKEN.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if calculated_hash == hash_from_telegram:
        try:
            # Декодируем пользователя из JSON-строки
            user_data = json.loads(parsed_data.get("user", "{}"))
            return True, user_data
        except json.JSONDecodeError:
            return False, {}

    return False, {}


def auth_required(handler):
    """Декоратор для защиты эндпоинтов, требующих авторизации."""

    @wraps(handler)
    async def wrapper(request):
        # initData может быть в заголовках или в теле JSON-запроса
        init_data = request.headers.get("X-Telegram-Init-Data")
        if not init_data:
            try:
                body = await request.json()
                init_data = body.get("initData")
            except (json.JSONDecodeError, TypeError):
                init_data = None

        if not init_data:
            return web.json_response({"error": "Authorization required"}, status=401)

        is_safe, user_data = is_safe_data(init_data)

        if not is_safe:
            return web.json_response({"error": "Invalid authorization data"}, status=403)

        # Передаем данные пользователя в обработчик
        return await handler(request, user_data)

    return wrapper


# ================== ОБРАБОТЧИКИ API-ЭНДПОИНТОВ ==================

async def get_locations(request):
    """Возвращает список локаций в формате, который ожидает frontend."""
    locations_list = [
        {"id": key, "name": value['display_in_case'].replace("в ", "").replace("на ", ""), "description": key}
        for key, value in LOCATIONS_CONFIG.items()
    ]
    return web.json_response({"locations": locations_list})


async def get_calendar_data(request):
    """Возвращает даты, на которые есть свободные сеансы."""
    location_id = request.query.get("location_id")
    if not location_id:
        return web.json_response({"error": "location_id is required"}, status=400)

    # Проверяем на 60 дней вперед (примерно 2 месяца)
    today = date.today()
    dates_to_check = [today + timedelta(days=i) for i in range(60)]
    session = request.app['aiohttp_session']

    tasks = [fetch_availability_for_location_date(session, location_id, d) for d in dates_to_check]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    available_dates = []
    for d, res in zip(dates_to_check, results):
        if res and not isinstance(res, Exception):
            available_dates.append(d.isoformat())

    return web.json_response({"available_dates": available_dates})


async def get_sessions_for_date(request):
    """Возвращает детальную информацию о сеансах на конкретную дату."""
    location_id = request.query.get("location_id")
    date_str = request.query.get("date")
    if not location_id or not date_str:
        return web.json_response({"error": "location_id and date are required"}, status=400)

    try:
        check_date = date.fromisoformat(date_str)
    except ValueError:
        return web.json_response({"error": "Invalid date format"}, status=400)

    session = request.app['aiohttp_session']
    availability = await fetch_availability_for_location_date(session, location_id, check_date)

    # Форматируем ответ для frontend
    sessions = []
    for time, courts in sorted(availability.items()):
        details = " | ".join([f"{name} ({data['price']}₽)" for name, data in sorted(courts.items())])
        sessions.append({"time": time, "details": details})

    return web.json_response({"sessions": sessions})


@auth_required
async def add_notification(request, user_data):
    """Добавляет подписку на уведомления для пользователя."""
    try:
        body = await request.json()
        location_id = body.get("location_id")
        date_str = body.get("date")
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    if not location_id or not date_str:
        return web.json_response({"error": "location_id and date are required"}, status=400)

    user_id = user_data.get("id")
    if not user_id:
        return web.json_response({"error": "Failed to identify user"}, status=400)

    # Создаем подписку "на конкретную дату, любое время, все корты"
    monitor_data = {"type": "specific", "value": date_str}
    hour = -1  # Любое время
    court_types = list(LOCATIONS_CONFIG.get(location_id, {}).get("courts", {}).keys())

    if not court_types:
        return web.json_response({"error": "Invalid location"}, status=400)

    db.add_user_time(user_id, location_id, hour, court_types, monitor_data)
    logger.info(f"Добавлена подписка через WebApp для user_id={user_id} на {location_id} ({date_str})")

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

    # Делаем сессию aiohttp доступной для обработчиков
    webapp['aiohttp_session'] = bot_app.bot_data['aiohttp_session']

    setup_webapp_routes(webapp)

    # Настройка CORS для всех маршрутов
    import aiohttp_cors
    cors = aiohttp_cors.setup(webapp, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
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
