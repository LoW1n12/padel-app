# handlers.py

import asyncio
import logging
import time
from datetime import date, timedelta, datetime
from collections import defaultdict, deque
import json
from functools import wraps

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from telegram.constants import ParseMode
from telegram.error import BadRequest

from database import db
from config import (
    LOCATIONS_CONFIG, DEFAULT_RANGE_DAYS, MAX_SPECIFIC_DAYS, ANY_HOUR_PLACEHOLDER,
    FLOOD_CONTROL_ACTIONS, FLOOD_CONTROL_PERIOD_SECONDS
)
from utils import format_date_short, format_date_full
from parser import fetch_availability_for_location_date

logger = logging.getLogger(__name__)


# ================== ДЕКОРАТОРЫ И MIDDLEWARE ==================

def ensure_user_registered(func):
    """Декоратор, который гарантирует, что пользователь зарегистрирован в БД."""

    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        user = update.effective_user
        chat = update.effective_chat
        if user and chat:
            db.add_user(user.id, chat.id, user.username, user.first_name)
        return await func(update, context, *args, **kwargs)

    return wrapper


def apply_flood_control(func):
    """Декоратор для защиты команд от слишком частых вызовов."""

    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        user_actions = context.user_data.get('user_actions', deque(maxlen=FLOOD_CONTROL_ACTIONS))
        now = time.time()

        while user_actions and now - user_actions[0] > FLOOD_CONTROL_PERIOD_SECONDS:
            user_actions.popleft()

        if len(user_actions) >= FLOOD_CONTROL_ACTIONS:
            logger.warning(f"Обнаружен флуд командами от user_id={update.effective_user.id}")
            return

        user_actions.append(now)
        context.user_data['user_actions'] = user_actions

        return await func(update, context, *args, **kwargs)

    return wrapper


# ================== ОСНОВНЫЕ КОМАНДЫ ==================

@ensure_user_registered
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    welcome_text = (
        f"👋 Привет, {update.effective_user.first_name}!\n\n"
        "Я помогу отслеживать свободные корты.\n\n"
        "<b>Команды:</b>\n"
        "/sessions - 🎾 Посмотреть Сеансы\n"
        "/addtime - ➕ Добавить Отслеживание\n"
        "/mytimes - 📝 Мои Отслеживания\n"
        "/help - ❓ Помощь"
    )
    await update.message.reply_text(welcome_text, parse_mode=ParseMode.HTML)


@ensure_user_registered
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)


# ================== ЛОГИКА ПРОСМОТРА СЕАНСОВ (/sessions) ==================

@ensure_user_registered
async def show_sessions(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await send_sessions_location_selection(update, context)


async def send_sessions_location_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [[InlineKeyboardButton(loc, callback_data=f"sessions_loc_{loc}")] for loc in LOCATIONS_CONFIG.keys()]
    text = "📍 Выберите локацию для просмотра сеансов:"
    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


async def show_sessions_summary(query: Update.callback_query, context: ContextTypes.DEFAULT_TYPE, location: str):
    await query.edit_message_text(f"🔍 Ищу сеансы для <b>{location}</b>...", parse_mode=ParseMode.HTML)
    now, today = datetime.now(), date.today()
    dates_to_check = [today + timedelta(days=i) for i in range(DEFAULT_RANGE_DAYS)]
    session = context.bot_data['aiohttp_session']

    tasks = [fetch_availability_for_location_date(session, location, d) for d in dates_to_check]
    results = await asyncio.gather(*tasks)

    all_sessions_by_date = defaultdict(list)
    for d, res in zip(dates_to_check, results):
        if res:
            for time_str in res:
                if d == today and int(time_str.split(':')[0]) < now.hour:
                    continue
                all_sessions_by_date[d].append(time_str)

    location_in_case = LOCATIONS_CONFIG.get(location, {}).get('display_in_case', f"в «{location}»")

    if not all_sessions_by_date:
        keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data="sessions_back_to_loc_select")]]
        await query.edit_message_text(
            f"😔 Свободных кортов {location_in_case} на ближайшие {DEFAULT_RANGE_DAYS} дней не найдено.",
            reply_markup=InlineKeyboardMarkup(keyboard), parse_mode=ParseMode.HTML)
        return

    msg_parts = [f"<b>Все свободные корты {location_in_case} в ближайшие {DEFAULT_RANGE_DAYS} дней:</b>\n"]
    date_buttons = []

    for d, times in sorted(all_sessions_by_date.items()):
        times_str = "• " + ' '.join(sorted(times))
        msg_parts.append(f"🎾 <b>{format_date_full(d)}:</b>\n{times_str}\n")
        date_buttons.append(
            InlineKeyboardButton(format_date_short(d), callback_data=f"sessions_date_{location}_{d.isoformat()}"))

    msg_parts.append("<b>Подробнее:</b>")

    keyboard = [date_buttons[i:i + 4] for i in range(0, len(date_buttons), 4)]
    keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="sessions_back_to_loc_select")])
    await query.edit_message_text("\n".join(msg_parts), parse_mode=ParseMode.HTML,
                                  reply_markup=InlineKeyboardMarkup(keyboard), disable_web_page_preview=True)


async def show_sessions_detail(query: Update.callback_query, context: ContextTypes.DEFAULT_TYPE, location: str,
                               date_iso: str):
    check_date = date.fromisoformat(date_iso)
    await query.edit_message_text(f"🔍 Загружаю детали на <b>{format_date_short(check_date)}</b>...",
                                  parse_mode=ParseMode.HTML)

    session = context.bot_data['aiohttp_session']
    res = await fetch_availability_for_location_date(session, location, check_date)
    if not res:
        await query.edit_message_text("😕 Не удалось получить данные на эту дату.")
        return

    msg_parts = [f"🎾 <b>{location}</b> ({format_date_full(check_date)}):"]
    for time_str, court_data in sorted(res.items()):
        details_parts = []
        for court_type, details in sorted(court_data.items()):
            price_str = f"{details['price']:,.0f}".replace(',', '.')
            details_parts.append(f"{court_type} - {price_str} ₽")
        msg_parts.append(f"• <b>{time_str}</b>: {' | '.join(details_parts)}")

    msg_parts.append("\n*<i>Цена указана за час</i>")

    booking_link = LOCATIONS_CONFIG.get(location, {}).get('booking_link')
    if booking_link:
        msg_parts.append(f'\n🔗 <a href="{booking_link}">Забронировать</a>')

    keyboard = [[InlineKeyboardButton("⬅️ Назад к обзору", callback_data=f"sessions_back_to_summary_{location}")]]
    await query.edit_message_text("\n".join(msg_parts), parse_mode=ParseMode.HTML,
                                  reply_markup=InlineKeyboardMarkup(keyboard), disable_web_page_preview=True)


# ================== ЛОГИКА ДОБАВЛЕНИЯ ОТСЛЕЖИВАНИЯ (/addtime) ==================

@ensure_user_registered
async def add_time(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await send_location_selection(update, context, new_message=True)


async def send_location_selection(update: Update, context: ContextTypes.DEFAULT_TYPE, new_message: bool = False):
    keyboard = [[InlineKeyboardButton(loc, callback_data=f"loc_{loc}")] for loc in LOCATIONS_CONFIG.keys()]
    text = "📍 Выберите локацию для отслеживания:"
    if new_message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


# ИЗМЕНЕНО: Добавлена логика проверки существующих подписок
async def send_monitoring_type_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id
    location = context.user_data.get('location')

    user_times = db.get_user_times(user_id)
    # Проверяем, есть ли уже подписка "на 10 дней, любое время" для этой локации
    has_range_any_time_sub = any(
        sub['location'] == location and
        sub['monitor_data'].get('type') == 'range' and
        sub['monitor_data'].get('value') == DEFAULT_RANGE_DAYS and
        sub['hour'] == ANY_HOUR_PLACEHOLDER
        for sub in user_times
    )

    keyboard = []
    # Показываем кнопку, только если такой подписки еще нет
    if not has_range_any_time_sub:
        keyboard.append([InlineKeyboardButton(f"На ближайшие {DEFAULT_RANGE_DAYS} дней",
                                              callback_data=f"mon_type_range_{DEFAULT_RANGE_DAYS}")])

    keyboard.append([InlineKeyboardButton("Выбрать конкретную дату", callback_data="mon_type_specific")])
    keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="back_to_loc_select")])

    await query.edit_message_text(f"📍 <b>{location}</b>\n🗓️ Выберите тип мониторинга:",
                                  reply_markup=InlineKeyboardMarkup(keyboard), parse_mode=ParseMode.HTML)


# ИЗМЕНЕНО: Добавлена логика проверки существующих подписок
async def send_date_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id
    location = context.user_data.get('location')

    user_times = db.get_user_times(user_id)
    # Собираем все даты, на которые уже есть подписка "любое время" для этой локации
    existing_any_time_dates = {
        sub['monitor_data']['value'] for sub in user_times
        if sub['location'] == location and
           sub['monitor_data'].get('type') == 'specific' and
           sub['hour'] == ANY_HOUR_PLACEHOLDER
    }

    today = date.today()
    keyboard_rows, buttons_in_row = [], []
    any_date_button_added = False

    for i in range(MAX_SPECIFIC_DAYS):
        d = today + timedelta(days=i)
        date_iso = d.isoformat()
        # Показываем дату, только если на нее нет подписки "любое время"
        if date_iso not in existing_any_time_dates:
            any_date_button_added = True
            buttons_in_row.append(InlineKeyboardButton(d.strftime('%d.%m'), callback_data=f"mon_date_{date_iso}"))
            if len(buttons_in_row) == 5:
                keyboard_rows.append(buttons_in_row)
                buttons_in_row = []
    if buttons_in_row:
        keyboard_rows.append(buttons_in_row)

    keyboard_rows.append([InlineKeyboardButton("⬅️ Назад", callback_data="back_to_mon_type")])

    text = f"📍 <b>{location}</b>\n🗓️ Выберите дату для отслеживания:"
    if not any_date_button_added:
        text = f"📍 <b>{location}</b>\n🗓️ У вас уже есть отслеживания на 'любое время' для всех доступных дат.\n\nУдалите подписки в /mytimes, чтобы добавить новые."
        final_keyboard = [[InlineKeyboardButton("⬅️ Назад", callback_data="back_to_mon_type")]]
    else:
        final_keyboard = keyboard_rows

    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(final_keyboard), parse_mode=ParseMode.HTML)


# ИЗМЕНЕНО: Добавлена логика проверки существующих подписок
async def send_hour_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id
    location = context.user_data.get('location')
    monitor_data = context.user_data.get('monitor_data', {})

    user_times = db.get_user_times(user_id)
    # Собираем часы, на которые уже есть подписка для этой локации и этого типа мониторинга (даты/диапазона)
    existing_hours = {
        sub['hour'] for sub in user_times
        if sub['location'] == location and sub['monitor_data'] == monitor_data
    }

    keyboard_rows = []
    # Показываем только те часы, на которые еще нет подписки
    hour_buttons = [InlineKeyboardButton(f"{h:02d}:00", callback_data=f"hour_{h}") for h in range(7, 24) if
                    h not in existing_hours]

    for i in range(0, len(hour_buttons), 4):
        keyboard_rows.append(hour_buttons[i:i + 4])

    # Показываем кнопку "Любое время", если она еще не выбрана
    if ANY_HOUR_PLACEHOLDER not in existing_hours:
        keyboard_rows.append([InlineKeyboardButton("👀 Любое время", callback_data="hour_all")])

    back_callback = "back_to_date_select" if monitor_data.get("type") == "specific" else "back_to_mon_type"
    keyboard_rows.append([InlineKeyboardButton("⬅️ Назад", callback_data=back_callback)])

    await query.edit_message_text(f"📍 <b>{location}</b>\n🕐 Выберите час:",
                                  reply_markup=InlineKeyboardMarkup(keyboard_rows), parse_mode=ParseMode.HTML)


async def send_court_type_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    location = context.user_data.get('location')
    hour = context.user_data.get('selected_hour')

    hour_str = "Любое время" if hour == ANY_HOUR_PLACEHOLDER else f"{hour:02d}:00"
    court_types = LOCATIONS_CONFIG.get(location, {}).get("courts", {}).keys()

    keyboard = [[InlineKeyboardButton(f"Только {ct}", callback_data=f"courts_{ct}")] for ct in court_types]
    if len(court_types) > 1:
        keyboard.append([InlineKeyboardButton("Все типы", callback_data=f"courts_both")])

    keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="back_to_hour_select")])

    await query.edit_message_text(f"📍 <b>{location}</b> | 🕐 <b>{hour_str}</b>\n\n🎾 Выберите тип корта:",
                                  reply_markup=InlineKeyboardMarkup(keyboard), parse_mode=ParseMode.HTML)


# ================== ЛОГИКА ПРОСМОТРА И УДАЛЕНИЯ ПОДПИСОК (/mytimes) ==================

@ensure_user_registered
async def my_times(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await send_my_times_message(update.message, update.effective_user.id)


async def send_my_times_message(message, user_id: int):
    user_times = db.get_user_times(user_id)
    if not user_times:
        await message.reply_text("❌ У вас нет активных отслеживаний.")
        return

    msg_parts = ["🕐 <b>Ваши отслеживания:</b>"]
    sorted_subs = sorted(user_times, key=lambda s: (s['location'], str(s['monitor_data'].get('value', '')), s['hour']))

    for sub in sorted_subs:
        label = "Любое время" if sub['hour'] == ANY_HOUR_PLACEHOLDER else f"{sub['hour']:02d}:00"
        types_str = ", ".join(sub["court_types"])
        md = sub["monitor_data"]
        desc = f"на {md['value']} дн." if md[
                                              "type"] == "range" else f"на {format_date_short(datetime.strptime(md['value'], '%Y-%m-%d').date())}"
        msg_parts.append(f"\n📍 <b>{sub['location']}</b>: {label} ({types_str}) - <i>{desc}</i>")

    await message.reply_text("\n".join(msg_parts), parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(
        [[InlineKeyboardButton("🗑️ Удалить отслеживания", callback_data="go_to_remove")]]))


async def send_remove_menu(message, user_id: int):
    user_times = db.get_user_times(user_id)
    if not user_times:
        await message.reply_text("❌ Нет отслеживаний для удаления.")
        return

    keyboard = []
    sorted_subs = sorted(user_times, key=lambda s: (s['location'], str(s['monitor_data'].get('value', '')), s['hour']))

    for sub in sorted_subs:
        label_hour = "Любое" if sub['hour'] == ANY_HOUR_PLACEHOLDER else f"{sub['hour']:02d}:00"
        types_str = "+".join([c[0] for c in sub["court_types"]])
        md = sub["monitor_data"]
        desc = f"({md['value']}д)" if md[
                                          "type"] == "range" else f"({datetime.strptime(md['value'], '%Y-%m-%d').date().strftime('%d.%m')})"
        keyboard.append([InlineKeyboardButton(f"🗑 {sub['location']} {label_hour} {desc} ({types_str})",
                                              callback_data=f"rm_id_{sub['id']}")])

    if user_times:
        keyboard.append([InlineKeyboardButton("❌ Удалить все", callback_data="rm_all")])

    keyboard.append([InlineKeyboardButton("⬅️ Назад", callback_data="back_to_mytimes")])
    await message.reply_text("Выберите отслеживание для удаления:", reply_markup=InlineKeyboardMarkup(keyboard))


# ================== ОБРАБОТЧИК ВСЕХ КНОПОК ==================

@ensure_user_registered
async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query

    user_actions = context.user_data.get('user_actions', deque(maxlen=FLOOD_CONTROL_ACTIONS))
    now = time.time()

    while user_actions and now - user_actions[0] > FLOOD_CONTROL_PERIOD_SECONDS:
        user_actions.popleft()

    if len(user_actions) >= FLOOD_CONTROL_ACTIONS:
        await query.answer("Слишком много запросов. Попробуйте через несколько секунд.", show_alert=True)
        return

    user_actions.append(now)
    context.user_data['user_actions'] = user_actions

    await query.answer()
    data = query.data
    user_id = query.from_user.id

    try:
        if data.startswith("sessions_"):
            if data.startswith("sessions_loc_"):
                await show_sessions_summary(query, context, data.split("_", 2)[2])
            elif data.startswith("sessions_date_"):
                await show_sessions_detail(query, context, *data.split("_")[2:])
            elif data == "sessions_back_to_loc_select":
                await send_sessions_location_selection(update, context)
            elif data.startswith("sessions_back_to_summary_"):
                await show_sessions_summary(query, context, data[len("sessions_back_to_summary_"):])
            return

        if data == "back_to_loc_select":
            await send_location_selection(update, context)
        elif data == "back_to_mon_type":
            await send_monitoring_type_selection(update, context)
        elif data.startswith("back_to_date_select"):
            await send_date_selection(update, context)
        elif data == "back_to_hour_select":
            await send_hour_selection(update, context)

        elif data == "back_to_mytimes":
            await query.message.delete()
            await send_my_times_message(query.message, user_id)
        elif data == 'go_to_remove':
            await query.message.delete()
            await send_remove_menu(query.message, user_id)
        elif data.startswith("rm_id_"):
            db.remove_user_time_by_id(int(data.split("_")[2]))
            await query.message.delete()
            await send_my_times_message(query.message, user_id)
        elif data == "rm_all":
            await query.edit_message_text("Вы уверены, что хотите удалить ВСЕ отслеживания?",
                                          reply_markup=InlineKeyboardMarkup(
                                              [[InlineKeyboardButton("✅ Да, удалить", callback_data="rm_all_confirm")],
                                               [InlineKeyboardButton("🚫 Отмена", callback_data="go_to_remove")]]))
        elif data == "rm_all_confirm":
            db.remove_all_user_times(user_id)
            await query.message.delete()
            await send_my_times_message(query.message, user_id)

        elif data.startswith("loc_"):
            context.user_data['location'] = data.split("_", 1)[1]
            await send_monitoring_type_selection(update, context)
        elif data.startswith("mon_type_"):
            _, _, mon_type, *rest = data.split("_")
            if mon_type == 'range':
                context.user_data['monitor_data'] = {"type": "range", "value": int(rest[0])}
                await send_hour_selection(update, context)
            elif mon_type == 'specific':
                await send_date_selection(update, context)
        elif data.startswith("mon_date_"):
            context.user_data['monitor_data'] = {"type": "specific", "value": data.split("_")[2]}
            await send_hour_selection(update, context)
        elif data.startswith("hour_"):
            context.user_data['selected_hour'] = ANY_HOUR_PLACEHOLDER if data.endswith("_all") else int(
                data.split("_")[1])
            await send_court_type_selection(update, context)
        elif data.startswith("courts_"):
            loc = context.user_data.get('location')
            hour = context.user_data.get('selected_hour')
            md = context.user_data.get('monitor_data')

            if not all([loc, hour is not None, md]):
                await query.edit_message_text("❗️Ошибка сессии. Начните заново с /addtime")
                return

            court_selection = data.split("_", 1)[1]
            all_court_types = LOCATIONS_CONFIG.get(loc, {}).get("courts", {}).keys()
            court_types = sorted(list(all_court_types) if court_selection == "both" else [court_selection])

            db.add_user_time(user_id, loc, hour, court_types, md)

            label = "любое время" if hour == ANY_HOUR_PLACEHOLDER else f"{hour:02d}:00"
            types_str = "+".join(court_types)
            desc = f"на {md['value']} дн." if md[
                                                  "type"] == "range" else f"на {format_date_short(datetime.strptime(md['value'], '%Y-%m-%d').date())}"

            await query.edit_message_text(
                f"✅ Готово! Добавлено отслеживание:\n📍 <b>{loc}</b> | 🕐 <b>{label}</b> | 🎾 <b>{types_str}</b>\n<i>({desc})</i>",
                parse_mode=ParseMode.HTML)
            context.user_data.clear()

    except BadRequest as e:
        if "Message is not modified" not in str(e):
            logger.error(f"Ошибка BadRequest в button_callback: {e}")
    except Exception as e:
        logger.error(f"Критическая ошибка в button_callback: {e}", exc_info=True)
        try:
            await query.edit_message_text("Произошла непредвиденная ошибка. Попробуйте снова.")
        except BadRequest:
            pass
