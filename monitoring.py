# monitoring.py

import asyncio
import logging
from datetime import datetime, timedelta
from collections import defaultdict
import json

from telegram.ext import Application
from telegram.constants import ParseMode

from database import db
from config import LOCATIONS_CONFIG, CHECK_INTERVAL_SECONDS
from parser import fetch_availability_for_location_date
from utils import format_date_full

logger = logging.getLogger(__name__)


async def monitor_availability(application: Application):
    """Основная асинхронная задача для фонового мониторинга свободных слотов."""
    logger.info("--- Задача мониторинга запущена ---")
    session = application.bot_data['aiohttp_session']

    while True:
        try:
            # 1. Очистка старых уведомлений
            notified_slots = application.bot_data.setdefault("notified_slots", set())
            now_date = datetime.now().date()
            pruned_slots = {s for s in notified_slots if
                            datetime.strptime(s.split('_')[2], '%Y-%m-%d').date() >= now_date}
            if len(notified_slots) != len(pruned_slots):
                logger.info(f"Очищено {len(notified_slots) - len(pruned_slots)} старых слотов из кэша уведомлений.")
                application.bot_data["notified_slots"] = pruned_slots
                notified_slots = pruned_slots

            # 2. Сбор всех подписок из БД
            all_users_data = db.get_all_monitored_data()
            if not all_users_data:
                await asyncio.sleep(CHECK_INTERVAL_SECONDS)
                continue

            # 3. Формирование уникальных запросов к API
            checks_to_perform = defaultdict(set)
            for user_data in all_users_data.values():
                for sub in user_data["subscriptions"]:
                    md = sub["monitor_data"]
                    if md["type"] == "range":
                        for i in range(md["value"]):
                            checks_to_perform[sub["location"]].add(now_date + timedelta(days=i))
                    elif md["type"] == "specific" and (
                    d := datetime.strptime(md["value"], "%Y-%m-%d").date()) >= now_date:
                        checks_to_perform[sub["location"]].add(d)

            if not checks_to_perform:
                await asyncio.sleep(CHECK_INTERVAL_SECONDS)
                continue

            # 4. Асинхронное выполнение запросов
            tasks = [fetch_availability_for_location_date(session, loc, d) for loc, dates in checks_to_perform.items()
                     for d in dates]
            task_keys = [(loc, d) for loc, dates in checks_to_perform.items() for d in dates]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            full_availability = defaultdict(dict)
            for (loc, d), res in zip(task_keys, results):
                if not isinstance(res, Exception) and res:
                    full_availability[loc][d] = res

            # 5. Поиск совпадений и формирование уведомлений
            notifications_to_send = defaultdict(lambda: defaultdict(list))
            newly_found_slots_this_cycle = set()

            for user_id, user_data in all_users_data.items():
                for sub in user_data['subscriptions']:
                    loc, md, sub_court_types, sub_hour = sub['location'], sub['monitor_data'], set(sub['court_types']), \
                    sub['hour']
                    if not (location_avail := full_availability.get(loc)): continue

                    sub_dates = []
                    if md["type"] == "range":
                        sub_dates.extend(now_date + timedelta(days=i) for i in range(md["value"]))
                    elif md["type"] == "specific" and (
                    d := datetime.strptime(md["value"], "%Y-%m-%d").date()) >= now_date:
                        sub_dates.append(d)

                    hours_to_check = range(7, 24) if sub_hour == -1 else [sub_hour]

                    for check_date in sub_dates:
                        if not (date_avail := location_avail.get(check_date)): continue
                        for hour in hours_to_check:
                            time_str = f"{hour:02d}:00"
                            if time_str in date_avail:
                                available_courts = date_avail[time_str]
                                matching_courts = sub_court_types.intersection(available_courts.keys())
                                if matching_courts:
                                    result_key = f"{user_id}_{loc}_{check_date.isoformat()}_{time_str}_{json.dumps(sorted(list(sub_court_types)))}"
                                    if result_key not in notified_slots:
                                        details = " | ".join(
                                            [f"{ct} - {available_courts[ct]['price']:,.0f} ₽".replace(',', '.') for ct
                                             in sorted(list(matching_courts))])
                                        msg = f"• <b>{time_str}</b>: {details}"
                                        notifications_to_send[user_id][(loc, check_date)].append(msg)
                                        newly_found_slots_this_cycle.add(result_key)

            # 6. Отправка сгруппированных уведомлений
            if notifications_to_send:
                for user_id, grouped_data in notifications_to_send.items():
                    chat_id = all_users_data[user_id]['chat_id']
                    msg_parts = ["<b><u>👋 Появились новые свободные корты!</u></b>"]
                    locations_in_notification = {loc for loc, d in grouped_data.keys()}

                    for (loc, d), slots in sorted(grouped_data.items()):
                        msg_parts.append(f"\n🎾 <b>{loc}</b> ({format_date_full(d)})\n" + "\n".join(sorted(slots)))

                    msg_parts.append("\n*<i>Цена указана за час</i>")

                    links_to_display = {}
                    for loc in locations_in_notification:
                        link = LOCATIONS_CONFIG.get(loc, {}).get('booking_link')
                        if link and link not in links_to_display:
                            links_to_display[link] = loc

                    link_parts = []
                    if len(links_to_display) == 1:
                        link_parts.append(f'<a href="{list(links_to_display.keys())[0]}">Забронировать</a>')
                    elif len(links_to_display) > 1:
                        for link, name in links_to_display.items():
                            link_parts.append(f'<a href="{link}">Забронировать ({name})</a>')

                    if link_parts:
                        msg_parts.append(f"\n🔗 {' | '.join(link_parts)}")

                    await application.bot.send_message(chat_id, "\n".join(msg_parts), parse_mode=ParseMode.HTML,
                                                       disable_web_page_preview=True)

                notified_slots.update(newly_found_slots_this_cycle)

        except asyncio.CancelledError:
            logger.info("--- Задача мониторинга корректно остановлена ---")
            break
        except Exception as e:
            logger.error(f"КРИТИЧЕСКАЯ ОШИБКА в цикле мониторинга: {e}", exc_info=True)
            await asyncio.sleep(60)  # Пауза перед следующей попыткой в случае сбоя

        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
