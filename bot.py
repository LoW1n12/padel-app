# bot.py

import asyncio
import logging
from datetime import datetime
from functools import wraps
import aiohttp

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
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
# ИЗМЕНЕНО: Импортируем функцию для создания веб-сервера
from webapp_server import create_webapp_server

logger = logging.getLogger(__name__)


# ================== НОВАЯ КОМАНДА ДЛЯ ЗАПУСКА WEBAPP ==================

async def webapp_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Отправляет кнопку для запуска Mini App."""
    # !!! ВАЖНО: Замените URL на ваш URL от GitHub Pages !!!
    WEBAPP_URL = "https://low1n12.github.io/padel-app/"

    keyboard = [[InlineKeyboardButton("🎾 Открыть приложение", web_app={"url": WEBAPP_URL})]]
    await update.message.reply_text(
        "Нажмите на кнопку ниже, чтобы открыть удобный интерфейс для поиска кортов:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )


# ================== ДЕКОРАТОРЫ И ОБРАБОТЧИКИ ЖИЗНЕННОГО ЦИКЛА ==================

def admin_required(func):
    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        if not db.is_admin(update.effective_user.id):
            logger.warning(
                f"Попытка несанкционированного доступа к админ-команде от user_id={update.effective_user.id}")
            return
        return await func(update, context, *args, **kwargs)

    return wrapper


async def post_init(application: Application):
    logger.info("--- Запуск post_init хука ---")
    application.bot_data['start_time'] = datetime.now()
    application.bot_data['aiohttp_session'] = aiohttp.ClientSession(headers={'User-Agent': 'Mozilla/5.0'})

    # Запуск фоновой задачи мониторинга
    monitor_task = asyncio.create_task(monitor_availability(application))
    application.bot_data['monitor_task'] = monitor_task
    logger.info("--- Задача мониторинга успешно создана ---")

    # ИЗМЕНЕНО: Запуск веб-сервера для Mini App
    webapp_task = asyncio.create_task(create_webapp_server(bot_app=application))
    application.bot_data['webapp_task'] = webapp_task


async def post_shutdown(application: Application):
    logger.info("--- Запуск post_shutdown хука ---")
    if monitor_task := application.bot_data.get('monitor_task'):
        monitor_task.cancel()
    # ИЗМЕНЕНО: Корректная остановка веб-сервера
    if webapp_task := application.bot_data.get('webapp_task'):
        webapp_task.cancel()

    if session := application.bot_data.get('aiohttp_session'):
        await session.close()
    db.close()
    logger.info("--- Ресурсы успешно освобождены ---")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.error("Exception while handling an update:", exc_info=context.error)
    if isinstance(context.error, Conflict):
        logger.critical("КРИТИЧЕСКАЯ ОШИБКА: Обнаружен конфликт. Вероятно, запущена еще одна копия бота.")


# ================== ФУНКЦИЯ СБОРКИ ПРИЛОЖЕНИЯ ==================

def create_bot_app() -> Application:
    application = Application.builder().token(config.BOT_TOKEN).post_init(post_init).post_shutdown(
        post_shutdown).build()

    # --- РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ ---
    # ИЗМЕНЕНО: Добавлен обработчик команды /webapp
    application.add_handler(CommandHandler("webapp", webapp_command))

    application.add_handler(CommandHandler("start", apply_flood_control(ensure_user_registered(start))))
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
