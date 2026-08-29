"""Точка входа бота-трекера: сборка, фоновый опрос, polling."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramNetworkError, TelegramUnauthorizedError
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from tracker.providers import YandexDeliveryProvider
from tracker.store import TripStore

from .config import BotConfig
from .handlers import router
from .middlewares import AccessMiddleware
from .poller import TripPoller

log = logging.getLogger(__name__)

COMMANDS = [
    BotCommand(command="start", description="Как пользоваться"),
    BotCommand(command="list", description="Что я сейчас отслеживаю"),
    BotCommand(command="help", description="Справка"),
    BotCommand(command="cancel", description="Отменить ввод"),
]


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("aiogram.event").setLevel(logging.WARNING)


def build_dispatcher(store: TripStore, config: BotConfig, provider=None) -> Dispatcher:
    """Собирает диспетчер. Используется и в тестах."""
    dispatcher = Dispatcher(storage=MemoryStorage())
    dispatcher["store"] = store
    dispatcher["config"] = config
    dispatcher["provider"] = provider or YandexDeliveryProvider()

    dispatcher.update.outer_middleware(AccessMiddleware())
    dispatcher.include_router(router)
    return dispatcher


async def run() -> None:
    setup_logging()
    config = BotConfig.from_env()

    store = TripStore(config.state_path)
    bot = Bot(token=config.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = build_dispatcher(store, config)

    try:
        me = await bot.get_me()
    except TelegramUnauthorizedError:
        await bot.session.close()
        raise RuntimeError(
            "Telegram отклонил токен. Проверьте TRACKER_BOT_TOKEN в .env — "
            "его можно перевыпустить у @BotFather."
        ) from None
    except TelegramNetworkError as error:
        await bot.session.close()
        raise RuntimeError(f"Нет связи с Telegram: {error}") from None

    poller = TripPoller(bot, store, config, provider=dispatcher["provider"])
    poller.start()
    log.info(
        "Трекер @%s запущен. Доступ: %s. Опрос раз в %s с.",
        me.username,
        config.allowed_ids or "всем",
        config.poll_seconds,
    )

    try:
        await bot.set_my_commands(COMMANDS)
        await bot.delete_webhook(drop_pending_updates=True)
        await dispatcher.start_polling(bot)
    finally:
        await poller.shutdown()
        await bot.session.close()
        log.info("Трекер остановлен")


def main() -> None:
    try:
        asyncio.run(run())
    except (KeyboardInterrupt, SystemExit):
        pass
    except RuntimeError as error:
        raise SystemExit(f"\n❌ {error}\n")


if __name__ == "__main__":
    main()
