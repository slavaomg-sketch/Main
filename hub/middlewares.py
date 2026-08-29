"""Доступ к боту и выбор активной ветки для входящего сообщения."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message, TelegramObject, Update

from .registry import Agent
from .state import HubState
from .texts import NOT_ALLOWED


class AccessMiddleware(BaseMiddleware):
    """Бот личный, если задан список разрешённых ID.

    Настройки берёт из данных диспетчера, чтобы их можно было подменить на лету.
    """

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        config = data.get("hub_config")
        user = data.get("event_from_user")
        if config is None or user is None or config.is_allowed(user.id):
            return await handler(event, data)

        # Молчать невежливо: один раз объясняем, почему бот не отвечает.
        inner = event.event if isinstance(event, Update) else event
        if isinstance(inner, Message):
            await inner.answer(NOT_ALLOWED)
        elif isinstance(inner, CallbackQuery):
            await inner.answer(NOT_ALLOWED, show_alert=True)
        return None


class AgentRoutingMiddleware(BaseMiddleware):
    """Определяет, какой ветке достанется сообщение, и кладёт это в `agent_slug`.

    Регистрируется после встроенных мидлварей aiogram, поэтому в данных уже
    есть FSM-состояние: если пользователь на середине диалога, перехватывать
    сообщение другой веткой нельзя.

    Хранилище и список веток берутся из данных диспетчера, а не из конструктора,
    чтобы их можно было подменить на лету.
    """

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        chat = data.get("event_chat")
        state: HubState | None = data.get("hub_state")
        agents: list[Agent] = data.get("agents") or []
        if chat is None or state is None or not agents:
            return await handler(event, data)

        slug = state.agent_for(chat.id)

        # Единственная ветка не требует выбора — открываем её сразу.
        if slug is None and len(agents) == 1:
            slug = agents[0].slug
            state.set_agent(chat.id, slug)

        text = _text_of(event)
        if text and not await _busy(data):
            for agent in agents:
                if agent.slug != slug and agent.owns(text):
                    slug = agent.slug
                    state.set_agent(chat.id, slug)
                    data["agent_switched"] = agent
                    break

        data["agent_slug"] = slug
        return await handler(event, data)


def _text_of(event: TelegramObject) -> str:
    inner = event.event if isinstance(event, Update) else event
    if isinstance(inner, Message) and inner.text and not inner.text.startswith("/"):
        return inner.text
    return ""


async def _busy(data: dict[str, Any]) -> bool:
    """Идёт ли сейчас диалог, который нельзя перебивать."""
    fsm: FSMContext | None = data.get("state")
    if fsm is None:
        return False
    return await fsm.get_state() is not None
