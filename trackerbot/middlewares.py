"""Ограничение доступа: бот личный, если задан TRACKER_ALLOWED_IDS."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject, Update

from .config import BotConfig
from .texts import NOT_ALLOWED


class AccessMiddleware(BaseMiddleware):
    """Настройки берёт из данных диспетчера, чтобы их можно было подменить на лету."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        config: BotConfig | None = data.get("config")
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
