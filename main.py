# main.py (финальная, улучшенная версия)

import logging
import sys
import asyncio

from bot import create_bot_app

# --- НАСТРОЙКА ЛОГИРОВАНИЯ ---
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO,
    handlers=[
        logging.StreamHandler(sys.stdout),
        # ИЗМЕНЕНО: Добавлена явная кодировка utf-8 для файла логов
        logging.FileHandler("bot.log", encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


def main():
    """Основная функция для запуска бота."""
    try:
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

        app = create_bot_app()
        logger.info("Бот запускается...")
        app.run_polling()

    except Exception as e:
        logger.critical(f"Критическая ошибка при запуске бота: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
