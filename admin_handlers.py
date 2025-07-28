# admin_handlers.py

import os
import psutil
from datetime import datetime, timedelta

from telegram import Update
from telegram.ext import ContextTypes
from telegram.constants import ParseMode

from database import db
from config import OWNER_ID


# --- НОВАЯ КОМАНДА /STATUS ---
async def show_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показывает админу статус системы."""
    process = psutil.Process(os.getpid())

    # CPU
    cpu_usage = psutil.cpu_percent(interval=1)

    # RAM
    ram_usage = process.memory_info().rss / (1024 * 1024)  # в МБ
    total_ram = psutil.virtual_memory().total / (1024 * 1024)
    ram_percent = psutil.virtual_memory().percent

    # Uptime
    uptime_delta = datetime.now() - context.bot_data['start_time']
    days, remainder = divmod(uptime_delta.total_seconds(), 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{int(days)}д {int(hours)}ч {int(minutes)}м"

    # DB Stats
    total_users = db.get_total_users_count()
    total_subs = db.get_total_subscriptions_count()

    text = (
        "<b>📊 Статус Бота</b>\n\n"
        f"<b>⚙️ Система:</b>\n"
        f"  - CPU: {cpu_usage}%\n"
        f"  - RAM (бот): {ram_usage:.2f} МБ\n"
        f"  - RAM (всего): {ram_percent}% ({total_ram:.0f} МБ)\n\n"
        f"<b>⏱️ Uptime:</b> {uptime_str}\n\n"
        f"<b>👥 Пользователи:</b> {total_users}\n"
        f"<b>🔔 Подписки:</b> {total_subs}"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


# --- ОСТАЛЬНЫЕ АДМИН-КОМАНДЫ ---
async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "⚙️ <b>Панель администратора</b>\n/status, /admin_add, /admin_remove, /admin_list, /admin_users",
        parse_mode=ParseMode.HTML)


async def admin_add(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        db.add_admin(int(context.args[0]), update.effective_user.id)
        await update.message.reply_text("✅ Админ добавлен.")
    except (IndexError, ValueError):
        await update.message.reply_text("❗️Формат: /admin_add USER_ID")


async def admin_remove(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        admin_id = int(context.args[0])
        if admin_id == OWNER_ID:
            await update.message.reply_text("⛔️ Нельзя удалить владельца.")
            return
        db.remove_admin(admin_id)
        await update.message.reply_text("🗑️ Админ удален.")
    except (IndexError, ValueError):
        await update.message.reply_text("❗️Формат: /admin_remove USER_ID")


async def admin_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    admins = db.get_all_admins()
    owner = f"👑 Владелец: <code>{OWNER_ID}</code>"
    other_admins = "\n".join([f"- <code>{admin_id}</code>" for admin_id in admins])
    await update.message.reply_text(f"{owner}\n\n👥 <b>Админы:</b>\n{other_admins or 'Нет'}", parse_mode=ParseMode.HTML)


async def admin_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    users = db.get_all_users_info()
    text = f"👥 <b>Всего пользователей: {len(users)}</b>\n\n" + "\n".join(
        [f"- {u['first_name']} (<code>{u['user_id']}</code>)" for u in users[:20]])
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)
