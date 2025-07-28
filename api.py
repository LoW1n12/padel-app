# api.py

import logging
from datetime import date, timedelta
import asyncio
import json
import hmac
import hashlib

from aiohttp import web
from telegram.ext import Application

from config import LOCATIONS_CONFIG, BOT_TOKEN, MAX_SPECIFIC_DAYS
from parser import fetch_availability_for_location_date
from database import db

logger = logging.getLogger(__name__)


def validate_init_data(init_data: str, bot_token: str) -> (bool, dict):
    """Проверяет подлинность данных, полученных от Telegram Mini App."""
    try:
        parsed_data = {k: v for k, v in (pair.split('=') for pair in init_data.split('&'))}
        hash_from_telegram = parsed_data.pop('hash')

        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))

        secret_key = hmac.new("WebAppData".encode(), bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if calculated_hash == hash_from_telegram:
            user_data = json.loads(parsed_data.get('user', '{}'))
            return True, user_data
        return False, {}
    except Exception as e:
        logger.error(f"Ошибка валидации initData: {e}")
        return False, {}


async def get_locations(request):
    """Отдает список локаций для отображения в Mini App."""
    locations_list = [{"id": loc, "name": loc} for loc in LOCATIONS_CONFIG.keys()]
    return web.json_response({"locations": locations_list})


async def get_sessions(request):
    """Отдает доступные сеансы для выбранной локации и ОДНОЙ даты."""
    location = request.query.get('location')
    date_str = request.query.get('date')
    if not location or not date_str:
        return web.json_response({"error": "Location and date are required"}, status=400)

    try:
        check_date = date.fromisoformat(date_str)
        session = request.app['bot_app'].bot_data['aiohttp_session']
        availability = await fetch_availability_for_location_date(session, location, check_date)
        return web.json_response(availability)
    except Exception as e:
        logger.error(f"Ошибка при получении сеансов через API: {e}")
        return web.json_response({"error": "Internal server error"}, status=500)


# ИЗМЕНЕНО: Новый эндпоинт для календаря
async def get_calendar_data(request):
    """Отдает список дат с доступными сеансами на 30 дней вперед."""
    location = request.query.get('location')
    if not location:
        return web.json_response({"error": "Location is required"}, status=400)

    try:
        session = request.app['bot_app'].bot_data['aiohttp_session']
        today = date.today()
        dates_to_check = [today + timedelta(days=i) for i in range(MAX_SPECIFIC_DAYS)]

        tasks = [fetch_availability_for_location_date(session, location, d) for d in dates_to_check]
        results = await asyncio.gather(*tasks)

        available_dates = [
            d.isoformat() for d, res in zip(dates_to_check, results) if res
        ]

        return web.json_response({"available_dates": available_dates})
    except Exception as e:
        logger.error(f"Ошибка при получении данных для календаря: {e}")
        return web.json_response({"error": "Internal server error"}, status=500)


async def add_subscription(request):
    """Добавляет подписку на уведомления от имени пользователя."""
    post_data = await request.json()
    init_data = post_data.get('initData')

    is_valid, user_data = validate_init_data(init_data, BOT_TOKEN)
    if not is_valid or not user_data:
        return web.json_response({"error": "Unauthorized"}, status=401)

    user_id = user_data.get('id')
    sub_details = post_data.get('subscription')

    try:
        db.add_user_time(
            user_id=int(user_id),
            location=sub_details['location'],
            hour=sub_details['hour'],
            court_types=sub_details['court_types'],
            monitor_type_data=sub_details['monitor_data']
        )
        return web.json_response({"status": "ok"})
    except Exception as e:
        logger.error(f"Ошибка при добавлении подписки через API: {e}")
        return web.json_response({"error": "Failed to add subscription"}, status=500)


def setup_api_routes(app: Application, web_app: web.Application):
    """Настраивает роуты для API."""
    web_app.router.add_get("/api/locations", get_locations)
    web_app.router.add_get("/api/sessions", get_sessions)
    web_app.router.add_get("/api/calendar", get_calendar_data)  # ИЗМЕНЕНО: Регистрация нового роута
    web_app.router.add_post("/api/subscribe", add_subscription)
