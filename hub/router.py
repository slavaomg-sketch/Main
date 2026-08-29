"""Обработчики самого хаба: приветствие, меню веток, переключение.

Роутеры собираются функциями, а не лежат готовыми в модуле: один и тот же
объект Router нельзя подключить к двум диспетчерам, а собирать хаб дважды
(например, в тестах с другим набором веток) должно быть можно.
"""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from . import texts
from .callbacks import AgentCb
from .keyboards import agents_menu
from .registry import Agent, find
from .state import HubState


async def cmd_start(
    message: Message, state: FSMContext, agents: list[Agent], agent_slug: str | None
) -> None:
    await state.clear()
    if not agents:
        await message.answer(texts.NO_AGENTS)
        return

    await message.answer(
        texts.greeting(agents),
        reply_markup=agents_menu(agents, agent_slug),
        disable_web_page_preview=True,
    )
    active = find(agents, agent_slug)
    if active is not None:
        await message.answer(texts.switched(active), disable_web_page_preview=True)


async def cmd_menu(message: Message, agents: list[Agent], agent_slug: str | None) -> None:
    if not agents:
        await message.answer(texts.NO_AGENTS)
        return
    await message.answer(
        texts.menu_header(find(agents, agent_slug)),
        reply_markup=agents_menu(agents, agent_slug),
    )


async def cmd_help(message: Message, agents: list[Agent], agent_slug: str | None) -> None:
    active = find(agents, agent_slug)
    if active is None:
        await message.answer(texts.greeting(agents), reply_markup=agents_menu(agents, None))
        return
    await message.answer(texts.switched(active), disable_web_page_preview=True)


async def cmd_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(texts.CANCELLED)


async def on_pick_agent(
    call: CallbackQuery,
    callback_data: AgentCb,
    state: FSMContext,
    agents: list[Agent],
    hub_state: HubState,
) -> None:
    agent = find(agents, callback_data.slug)
    if agent is None:
        await call.answer("Такой ветки больше нет", show_alert=True)
        return

    await state.clear()
    hub_state.set_agent(call.message.chat.id, agent.slug)
    await call.message.answer(texts.switched(agent), disable_web_page_preview=True)
    await call.answer(agent.title)


async def unhandled_text(message: Message, agents: list[Agent], agent_slug: str | None) -> None:
    """Ветка не выбрана — иначе сообщение забрал бы её роутер."""
    if not agents:
        await message.answer(texts.NO_AGENTS)
        return
    await message.answer(
        texts.unknown_without_agent(agents),
        reply_markup=agents_menu(agents, agent_slug),
    )


async def unhandled_other(message: Message, agents: list[Agent], agent_slug: str | None) -> None:
    """Не текст: фото, файл, стикер."""
    await message.answer(
        texts.menu_header(find(agents, agent_slug)),
        reply_markup=agents_menu(agents, agent_slug),
    )


def build_commands_router() -> Router:
    """Команды хаба. Подключается первым, чтобы ветки их не перехватывали."""
    router = Router(name="hub-commands")
    router.message.register(cmd_start, CommandStart())
    router.message.register(cmd_menu, Command("menu", "agents"))
    router.message.register(cmd_help, Command("help"))
    router.message.register(cmd_cancel, Command("cancel"))
    router.callback_query.register(on_pick_agent, AgentCb.filter())
    return router


def build_fallback_router() -> Router:
    """То, что не разобрала ни одна ветка. Подключается последним."""
    router = Router(name="hub-fallback")
    router.message.register(unhandled_text, F.text)
    router.message.register(unhandled_other)
    return router
