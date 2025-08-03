# webapp_server.py

import asyncio
import hmac
import hashlib
import json
import logging
from datetime import date, timedelta, datetime  # ИЗМЕНЕНО: Добавлен импорт datetime
from functools import wraps
from urllib.parse import parse_qsl

from aiohttp import web
import aiohttp_cors
from telegram.constants import ParseMode  # ИЗМЕНЕНО: Добавлен импорт ParseMode
from telegram.error import TelegramError  # ИЗМЕНЕНО: Добавлен импорт для обработки ошибок

from config import BOT_TOKEN, LOCATIONS_CONFIG, ANY_HOUR_PLACEHOLDER  # ИЗМЕНЕНО: Добавлен импорт ANY_HOUR_PLACEHOLDER
from database import db
from parser import fetch_availability_for_location_date
from utils import format_date_short  # ИЗМЕНЕНО: Добавлен импорт format_date_short

logger = logging.getLogger(__name__)


# ================== БЕЗОПАСНОСТЬ: ПРОВЕРКА ДАННЫХ TELEGRAM ==================

def is_safe_data(init_data: str) -> (bool, dict):
    if not BOT_TOKEN:
        logger.error("WebApp Auth: BOT_TOKEN не найден, проверка невозможна.")
        return False, {}
    try:
        parsed_data = dict(parse_qsl(init_data))
    except ValueError:
        return False, {}
    if "hash" not in parsed_data: return False, {}

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
        if not is_safe: return web.json_response({"error": "Invalid authorization data"}, status=403)
        return await handler(request, user_data)

    return wrapper


# ================== ОБРАБОТЧИКИ API-ЭНДПОИНТОВ ==================

async def get_locations(request):
    logger.info("WebApp API: Получен запрос на /api/locations")
    locations_list = [{"id": key, "name": key, "description": value.get('description', '')} for key, value in
                      LOCATIONS_CONFIG.items()]
    return web.json_response({"locations": locations_list})


async def get_calendar_data(request):
    location_id = request.query.get("location_id")
    if not location_id or location_id not in LOCATIONS_CONFIG:
        return web.json_response({"error": "location_id is required or invalid"}, status=400)

    today = date.today()
    dates_to_check = [today + timedelta(days=i) for i in range(30)]
    session = request.app['aiohttp_session']
    tasks = [fetch_availability_for_location_date(session, location_id, d) for d in dates_to_check]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    available_dates = [d.isoformat() for d, res in zip(dates_to_check, results) if
                       res and not isinstance(res, Exception)]
    return web.json_response({"available_dates": available_dates})


async def get_sessions_for_date(request):
    location_id = request.query.get("location_id")
    date_str = request.query.get("date")
    if not location_id or not date_str: return web.json_response({"error": "location_id and date are required"},
                                                                 status=400)

    try:
        check_date = date.fromisoformat(date_str)
    except ValueError:
        return web.json_response({"error": "Invalid date format"}, status=400)

    session = request.app['aiohttp_session']
    availability = await fetch_availability_for_location_date(session, location_id, check_date)
    sessions = [{"time": time_str,
                 "details": " | ".join([f"{name} ({data['price']}₽)" for name, data in sorted(courts.items())])} for
                time_str, courts in sorted(availability.items())]
    booking_link = LOCATIONS_CONFIG.get(location_id, {}).get('booking_link', '')
    return web.json_response({"sessions": sessions, "booking_link": booking_link})


@auth_required
async def add_notification(request, user_data):
    try:
        body = await request.json()
        location_id = body.get("location_id")
        date_str = body.get("date")
        logger.info(f"WebApp API: /api/notify от user_id={user_data.get('id')} на {location_id} ({date_str})")
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    if not location_id or not date_str: return web.json_response({"error": "location_id and date are required"},
                                                                 status=400)
    user_id = user_data.get("id")
    if not user_id: return web.json_response({"error": "Failed to identify user"}, status=400)

    monitor_data = {"type": "specific", "value": date_str}
    hour = ANY_HOUR_PLACEHOLDER
    court_types = sorted(list(LOCATIONS_CONFIG.get(location_id, {}).get("courts", {}).keys()))

    if not court_types: return web.json_response({"error": "Invalid location"}, status=400)

    db.add_user_time(user_id, location_id, hour, court_types, monitor_data)
    logger.info(f"WebApp API: Успешно добавлена подписка в БД для user_id={user_id}.")

    # --- ИЗМЕНЕНО: Блок отправки уведомления в чат ---
    try:
        bot = request.app['bot']
        label = "любое время"
        types_str = "+".join(court_types)
        desc = f"на {format_date_short(datetime.strptime(date_str, '%Y-%m-%d').date())}"

        confirmation_message = (
            f"✅ *Отслеживание добавлено через WebApp:*\n"
            f"📍 *{location_id}* | 🕐 *{label}* | 🎾 *{types_str}*\n"
            f"_{desc}_"
        )

        # Заменяем символы для корректного отображения в MarkdownV2
        # Но для простоты лучше использовать HTML
        confirmation_message_html = (
            f"✅ <b>Отслеживание добавлено через WebApp:</b>\n"
            f"📍 <b>{location_id}</b> | 🕐 <b>{label}</b> | 🎾 <b>{types_str}</b>\n"
            f"<i>({desc})</i>"
        )

        await bot.send_message(chat_id=user_id, text=confirmation_message_html, parse_mode=ParseMode.HTML)
        logger.info(f"WebApp API: Отправлено подтверждение в чат для user_id={user_id}")
    except TelegramError as e:
        logger.error(f"WebApp API: Не удалось отправить сообщение для user_id={user_id}. Ошибка: {e}")
    except Exception as e:
        logger.error(f"WebApp API: Непредвиденная ошибка при отправке сообщения: {e}", exc_info=True)
    # --- Конец блока отправки уведомления ---

    return web.json_response({"status": "ok", "message": "Уведомление добавлено!"})


# ================== НАСТРОЙКА И ЗАПУСК СЕРВЕРА ==================

def setup_webapp_routes(app):
    app.router.add_get("/api/locations", get_locations)
    app.router.add_get("/api/calendar", get_calendar_data)
    app.router.add_get("/api/sessions", get_sessions_for_date)
    app.router.add_post("/api/notify", add_notification)


async def create_webapp_server(host='0.0.0.0', port=8080, bot_app=None):
    webapp = web.Application()

    # ИЗМЕНЕНО: Сохраняем не только сессию, но и сам объект бота
    webapp['aiohttp_session'] = bot_app.bot_data['aiohttp_session']
    webapp['bot'] = bot_app.bot

    setup_webapp_routes(webapp)
    cors = aiohttp_cors.setup(webapp, defaults={
        "*": aiohttp_cors.ResourceOptions(allow_credentials=True, expose_headers="*", allow_headers="*")})
    for route in list(webapp.router.routes()): cors.add(route)
    runner = web.AppRunner(webapp)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    logger.info(f"🚀 Веб-сервер для Mini App запущен на http://{host}:{port}")
    await site.start()
    return site
