"""Точка входа: сборка бота, планировщика и запуск polling."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramNetworkError, TelegramUnauthorizedError
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from bot import db, repo
from bot.config import Config
from bot.handlers import build_router
from bot.middlewares import UserMiddleware
from bot.scheduler import ReminderScheduler

log = logging.getLogger(__name__)

COMMANDS = [
    BotCommand(command="start", description="Запустить бота"),
    BotCommand(command="my", description="Мои напоминания"),
    BotCommand(command="catalog", description="Каталог напоминаний"),
    BotCommand(command="new", description="Создать своё напоминание"),
    BotCommand(command="stats", description="Моя статистика"),
    BotCommand(command="settings", description="Часовой пояс"),
    BotCommand(command="help", description="Справка"),
    BotCommand(command="cancel", description="Отменить текущее действие"),
]


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("aiogram.event").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)


def build_dispatcher(conn, config: Config) -> Dispatcher:
    """Собирает диспетчер с мидлварями и роутерами. Используется и в тестах."""
    dispatcher = Dispatcher(storage=MemoryStorage())
    dispatcher["conn"] = conn
    dispatcher["config"] = config

    dispatcher.update.outer_middleware(UserMiddleware(config))
    dispatcher.include_router(build_router())
    return dispatcher


async def run() -> None:
    setup_logging()
    config = Config.from_env()

    conn = await db.connect(config.db_path)
    await repo.ensure_admins(conn, config.admin_ids)

    bot = Bot(
        token=config.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = build_dispatcher(conn, config)

    try:
        me = await bot.get_me()
    except TelegramUnauthorizedError:
        await bot.session.close()
        await conn.close()
        raise RuntimeError(
            "Telegram отклонил токен. Проверьте BOT_TOKEN в .env — "
            "его можно перевыпустить у @BotFather."
        ) from None
    except TelegramNetworkError as error:
        await bot.session.close()
        await conn.close()
        raise RuntimeError(f"Нет связи с Telegram: {error}") from None

    scheduler = ReminderScheduler(bot, conn, config)
    scheduler.start()
    log.info("Бот @%s запущен. Администраторы: %s", me.username, config.admin_ids)

    try:
        await bot.set_my_commands(COMMANDS)
        await bot.delete_webhook(drop_pending_updates=True)
        await dispatcher.start_polling(bot)
    finally:
        await scheduler.shutdown()
        await conn.close()
        await bot.session.close()
        log.info("Бот остановлен")


def main() -> None:
    try:
        asyncio.run(run())
    except (KeyboardInterrupt, SystemExit):
        pass
    except RuntimeError as error:
        # Ошибки конфигурации показываем понятной строкой, без стека.
        raise SystemExit(f"\n❌ {error}\n")


if __name__ == "__main__":
    main()
