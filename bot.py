# bot.py

import asyncio
import logging
from datetime import datetime
from functools import wraps
import aiohttp
import aiohttp_cors
from aiohttp import web

# ИЗМЕНЕНО: Добавлены ReplyKeyboardMarkup и KeyboardButton для создания кнопок
from telegram import Update, WebAppInfo, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes
from telegram.error import Conflict

import config
from database import db
from handlers import (
    start, help_command, show_sessions, add_time, my_times, button_callback,
    ensure_user_registered, apply_flood_control
)
from admin_handlers import (
    admin_panel, show_status, admin_add, admin_remove, admin_list, admin_users
)
from monitoring import monitor_availability
from api import setup_api_routes

logger = logging.getLogger(__name__)


# ================== ДЕКОРАТОРЫ И ОБРАБОТЧИКИ ЖИЗНЕННОГО ЦИКЛА ==================

def admin_required(func):
    """Декоратор для проверки прав администратора."""

    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        if not db.is_admin(update.effective_user.id):
            logger.warning(
                f"Попытка несанкционированного доступа к админ-команде от user_id={update.effective_user.id}")
            return
        return await func(update, context, *args, **kwargs)

    return wrapper


# Команда для запуска Mini App
@ensure_user_registered
async def app_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Отправляет кнопку для запуска Mini App."""
    await update.message.reply_text(
        "Нажмите кнопку ниже, чтобы открыть удобный интерфейс для просмотра и бронирования сеансов.",
        # ИЗМЕНЕНО: Убрано некорректное 'web.' перед классами кнопок Telegram
        reply_markup=ReplyKeyboardMarkup.from_button(
            KeyboardButton("🎾 Открыть приложение", web_app=WebAppInfo(url=config.MINI_APP_URL)),
            resize_keyboard=True
        )
    )


async def post_init(application: Application):
    """Выполняется после инициализации для настройки ресурсов."""
    logger.info("--- Запуск post_init хука ---")
    db.init_database()
    application.bot_data['start_time'] = datetime.now()
    application.bot_data['aiohttp_session'] = aiohttp.ClientSession(headers={'User-Agent': 'Mozilla/5.0'})

    # Запуск фоновой задачи мониторинга
    monitor_task = asyncio.create_task(monitor_availability(application))
    application.bot_data['monitor_task'] = monitor_task

    # Настройка и запуск веб-сервера для API
    web_app = web.Application()
    web_app['bot_app'] = application
    setup_api_routes(application, web_app)

    cors = aiohttp_cors.setup(web_app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
        )
    })
    for route in list(web_app.router.routes()):
        cors.add(route)

    runner = web.AppRunner(web_app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8080)
    await site.start()
    application.bot_data['web_runner'] = runner
    logger.info("--- Веб-сервер для API успешно запущен на порту 8080 ---")


async def post_shutdown(application: Application):
    """Выполняется перед завершением работы для освобождения ресурсов."""
    logger.info("--- Запуск post_shutdown хука ---")
    if monitor_task := application.bot_data.get('monitor_task'):
        monitor_task.cancel()
    if session := application.bot_data.get('aiohttp_session'):
        await session.close()
    if runner := application.bot_data.get('web_runner'):
        await runner.cleanup()
    db.close()
    logger.info("--- Ресурсы успешно освобождены ---")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.error("Exception while handling an update:", exc_info=context.error)
    if isinstance(context.error, Conflict):
        logger.critical("КРИТИЧЕСКАЯ ОШИБКА: Обнаружен конфликт. Вероятно, запущена еще одна копия бота.")


# ================== ФУНКЦИЯ СБОРКИ ПРИЛОЖЕНИЯ ==================

def create_bot_app() -> Application:
    """Создает и настраивает экземпляр приложения Telegram бота."""
    application = (
        Application.builder()
        .token(config.BOT_TOKEN)
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )

    # --- РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ ---
    application.add_handler(CommandHandler("start", apply_flood_control(ensure_user_registered(start))))
    application.add_handler(CommandHandler("app", app_command))
    application.add_handler(CommandHandler("help", apply_flood_control(ensure_user_registered(help_command))))
    application.add_handler(CommandHandler("sessions", apply_flood_control(ensure_user_registered(show_sessions))))
    application.add_handler(CommandHandler("addtime", apply_flood_control(ensure_user_registered(add_time))))
    application.add_handler(CommandHandler("mytimes", apply_flood_control(ensure_user_registered(my_times))))

    application.add_handler(CommandHandler("admin", ensure_user_registered(admin_required(admin_panel))))
    application.add_handler(CommandHandler("status", ensure_user_registered(admin_required(show_status))))
    application.add_handler(CommandHandler("admin_add", ensure_user_registered(admin_required(admin_add))))
    application.add_handler(CommandHandler("admin_remove", ensure_user_registered(admin_required(admin_remove))))
    application.add_handler(CommandHandler("admin_list", ensure_user_registered(admin_required(admin_list))))
    application.add_handler(CommandHandler("admin_users", ensure_user_registered(admin_required(admin_users))))

    application.add_handler(CallbackQueryHandler(button_callback))
    application.add_error_handler(error_handler)

    return application
