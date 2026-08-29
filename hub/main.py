"""Точка входа бота-хаба: подключает ветки, поднимает их фоновые задачи, polling."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramNetworkError, TelegramUnauthorizedError
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from .agents import AGENTS
from .config import HubConfig
from .filters import ActiveAgent
from .middlewares import AccessMiddleware, AgentRoutingMiddleware
from .registry import Agent, Background
from .router import build_commands_router, build_fallback_router
from .state import HubState

log = logging.getLogger(__name__)

HUB_COMMANDS = [
    BotCommand(command="start", description="С чего начать"),
    BotCommand(command="menu", description="Выбрать ветку"),
    BotCommand(command="help", description="Справка по открытой ветке"),
    BotCommand(command="cancel", description="Отменить ввод"),
]


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("aiogram.event").setLevel(logging.WARNING)


def commands_for(agents: list[Agent]) -> list[BotCommand]:
    """Меню команд Telegram: команды хаба плюс всё, что просят ветки."""
    seen = {command.command for command in HUB_COMMANDS}
    merged = list(HUB_COMMANDS)
    for agent in agents:
        for command in agent.commands:
            if command.command not in seen:
                seen.add(command.command)
                merged.append(command)
    return merged


def build_dispatcher(
    config: HubConfig | None,
    state: HubState | None = None,
    agents: list[Agent] | None = None,
) -> Dispatcher:
    """Собирает диспетчер. Используется и в тестах.

    Порядок роутеров важен: сперва команды хаба, потом ветки (их обработчики
    видят только свои сообщения), в конце — то, что никто не разобрал.
    """
    agents = AGENTS if agents is None else agents
    if state is None:
        state = HubState(config.state_path) if config else HubState()

    dispatcher = Dispatcher(storage=MemoryStorage())
    dispatcher["hub_config"] = config
    dispatcher["hub_state"] = state
    dispatcher["agents"] = agents

    for agent in agents:
        if agent.setup is not None and config is not None:
            agent.setup(dispatcher.workflow_data, config)

    dispatcher.update.outer_middleware(AccessMiddleware())
    dispatcher.update.outer_middleware(AgentRoutingMiddleware())

    dispatcher.include_router(build_commands_router())
    for agent in agents:
        # Обычные сообщения достаются ветке, только когда она открыта в этом чате.
        agent.router.message.filter(ActiveAgent(agent.slug))
        dispatcher.include_router(agent.router)
    dispatcher.include_router(build_fallback_router())

    return dispatcher


def start_background(bot: Bot, dispatcher: Dispatcher, agents: list[Agent]) -> list[Background]:
    tasks: list[Background] = []
    for agent in agents:
        if agent.background is None:
            continue
        task = agent.background(bot, dispatcher.workflow_data)
        task.start()
        tasks.append(task)
    return tasks


async def run() -> None:
    setup_logging()
    config = HubConfig.from_env()

    state = HubState(config.state_path)
    bot = Bot(token=config.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = build_dispatcher(config, state, AGENTS)

    try:
        me = await bot.get_me()
    except TelegramUnauthorizedError:
        await bot.session.close()
        raise RuntimeError(
            "Telegram отклонил токен. Проверьте HUB_BOT_TOKEN в .env — "
            "его можно перевыпустить у @BotFather."
        ) from None
    except TelegramNetworkError as error:
        await bot.session.close()
        raise RuntimeError(f"Нет связи с Telegram: {error}") from None

    tasks = start_background(bot, dispatcher, AGENTS)
    log.info(
        "Бот @%s запущен. Ветки: %s. Доступ: %s.",
        me.username,
        ", ".join(agent.slug for agent in AGENTS) or "нет",
        config.allowed_ids or "всем",
    )

    try:
        await bot.set_my_commands(commands_for(AGENTS))
        await bot.delete_webhook(drop_pending_updates=True)
        await dispatcher.start_polling(bot)
    finally:
        for task in tasks:
            await task.shutdown()
        await bot.session.close()
        log.info("Бот остановлен")


def main() -> None:
    try:
        asyncio.run(run())
    except (KeyboardInterrupt, SystemExit):
        pass
    except RuntimeError as error:
        raise SystemExit(f"\n❌ {error}\n")


if __name__ == "__main__":
    main()
