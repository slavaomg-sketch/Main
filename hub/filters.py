"""Фильтр «эта ветка сейчас открыта»."""

from __future__ import annotations

from typing import Any

from aiogram.filters import Filter
from aiogram.types import TelegramObject


class ActiveAgent(Filter):
    """Пропускает сообщение к ветке, только если она активна в этом чате.

    Нажатия на кнопки не фильтруются: у каждой ветки свой префикс
    callback_data, поэтому кнопка старой карточки должна работать всегда.
    """

    def __init__(self, slug: str) -> None:
        self.slug = slug

    async def __call__(
        self, event: TelegramObject, agent_slug: str | None = None, **kwargs: Any
    ) -> bool:
        return agent_slug == self.slug
