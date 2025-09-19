import asyncio
import hmac
import hashlib
import json
import logging
import time
from datetime import date, timedelta, datetime
from functools import wraps
from urllib.parse import parse_qsl
from collections import defaultdict

from aiohttp import web
import aiohttp_cors
from telegram.constants import ParseMode

from config import BOT_TOKEN, LOCATIONS_CONFIG, ANY_HOUR_PLACEHOLDER
from database import db
from parser import fetch_availability_for_location_date
from utils import format_date_short

logger = logging.getLogger(__name__)

# ================== УРОВЕНЬ ЗАЩИТЫ 1: ОГРАНИЧЕНИЕ ЧАСТОТЫ ЗАПРОСОВ ==================
user_last_request_time = defaultdict(float)
RATE_LIMIT_SECONDS = 1

def rate_limited(handler):
    @wraps(handler)
    async def wrapper(request, user_data):
        user_id = user_data.get("id")
        if not user_id:
            return await handler(request, user_data)
        current_time = time.time()
        if current_time - user_last_request_time.get(user_id, 0) < RATE_LIMIT_SECONDS:
            return web.json_response({"error": "Too many requests"}, status=429)
        user_last_request_time[user_id] = current_time
        return await handler(request, user_data)
    return wrapper

# ================== УРОВЕНЬ ЗАЩИТЫ 2: ПРОВЕРКА ПОДЛИННОСТИ И СРОКА ГОДНОСТИ ==================
def is_safe_data(init_data: str) -> tuple[bool, dict]:
    if not BOT_TOKEN:
        return False, {}
    try:
        parsed_data = dict(parse_qsl(init_data))
        if "hash" not in parsed_data:
            return False, {}
        
        if time.time() - int(parsed_data.get('auth_date', 0)) > 3600:
            logger.warning("WebApp Auth: Received outdated data (auth_date).")
            return False, {}
        
        hash_from_telegram = parsed_data.pop('hash')
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))
        secret_key = hmac.new("WebAppData".encode(), BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if calculated_hash == hash_from_telegram:
            user_info = json.loads(parsed_data.get("user", "{}"))
            return True, user_info
    except Exception as e:
        logger.error(f"is_safe_data check failed: {e}")

    # Это нужно на случай, если `parsed_data` не определена из-за ошибки в try-блоке
    user_str = dict(parse_qsl(init_data)).get('user', '{}')
    logger.warning(f"WebApp Auth: Hash validation failed for {user_str}")
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
            return web.json_response({"error": "Authorization required"}, status=401)
        
        is_safe, user_data = is_safe_data(init_data)
        if not is_safe:
            return web.json_response({"error": "Invalid or outdated authorization data"}, status=403)
        
        return await handler(request, user_data)
    return wrapper

# ================== ОБРАБОТЧИКИ API-ЭНДПОИНТОВ ==================

async def get_locations(request):
    logger.info("WebApp API: Request for /api/locations")
    locations_list = [{
        "id": key,
        "name": key,
        "description": value.get('description', ''),
        "coords": value.get('coords'),
        "address": value.get('address'),
        "images": value.get('images', []),
        "booking_link": value.get('booking_link')
    } for key, value in LOCATIONS_CONFIG.items()]
    return web.json_response({"locations": locations_list})

async def get_availability(request):
    date_str = request.query.get("date")
    time_str = request.query.get("time")

    if not date_str or not time_str:
        return web.json_response({"error": "date and time are required"}, status=400)
    
    try:
        check_date = date.fromisoformat(date_str)
    except ValueError:
        return web.json_response({"error": "Invalid date format"}, status=400)

    session = request.app['aiohttp_session']
    
    async def check_location(location_id):
        availability_data = await fetch_availability_for_location_date(session, location_id, check_date)
        if not availability_data:
            return {"id": location_id, "is_available": False}
        if time_str == 'any':
            return {"id": location_id, "is_available": True}
        return {"id": location_id, "is_available": time_str in availability_data}

    tasks = [check_location(loc_id) for loc_id in LOCATIONS_CONFIG.keys()]
    results = await asyncio.gather(*tasks)
    
    return web.json_response({"availability": results})

@auth_required
@rate_limited
async def add_notification(request, user_data):
    try:
        body = await request.json()
        location_id = body.get("location_id")
        date_str = body.get("date")
        time_to_track = body.get("time", ANY_HOUR_PLACEHOLDER)
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    if not all([location_id, date_str]): 
        return web.json_response({"error": "location_id and date are required"}, status=400)
    
    user_id = user_data.get("id")
    if not user_id: 
        return web.json_response({"error": "Failed to identify user"}, status=400)

    court_types = sorted(list(LOCATIONS_CONFIG.get(location_id, {}).get("courts", {}).keys()))
    if not court_types: 
        return web.json_response({"error": "Invalid location"}, status=400)

    db.add_user_time(
        user_id, 
        location_id, 
        time_to_track if time_to_track != 'any' else ANY_HOUR_PLACEHOLDER, 
        court_types, 
        {"type": "specific", "value": date_str}
    )
    logger.info(f"WebApp API: Added subscription for user_id={user_id} on {location_id} {date_str} {time_to_track}.")

    try:
        bot = request.app['bot']
        time_display = "любое время" if time_to_track == 'any' else time_to_track
        desc = f"на {format_date_short(datetime.strptime(date_str, '%Y-%m-%d').date())}"
        
        # Исправленная многострочная f-строка
        confirmation_message_html = (
            f"✅ <b>Отслеживание добавлено:</b>\n"
            f"📍 <b>{location_id}</b>\n"
            f"📅 <b>{desc}</b>\n"
            f"🕐 <b>{time_display}</b>"
        )
        
        await bot.send_message(chat_id=user_id, text=confirmation_message_html, parse_mode=ParseMode.HTML)
    except Exception as e:
        logger.error(f"WebApp API: Failed to send message: {e}", exc_info=True)

    return web.json_response({"status": "ok"})

# ================== НАСТРОЙКА И ЗАПУСК СЕРВЕРА ==================

def setup_webapp_routes(app):
    app.router.add_get("/api/locations", get_locations)
    app.router.add_get("/api/availability", get_availability)
    app.router.add_post("/api/notify", add_notification)

async def create_webapp_server(host='0.0.0.0', port=8080, bot_app=None):
    webapp = web.Application()
    webapp['aiohttp_session'] = bot_app.bot_data['aiohttp_session']
    webapp['bot'] = bot_app.bot
    setup_webapp_routes(webapp)
    
    cors = aiohttp_cors.setup(webapp, defaults={
        "*": aiohttp_cors.ResourceOptions(allow_credentials=True, expose_headers="*", allow_headers="*")
    })
    for route in list(webapp.router.routes()):
        cors.add(route)
        
    runner = web.AppRunner(webapp)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    logger.info(f"🚀 Web server for Mini App started at http://{host}:{port}")
    await site.start()
    return site

