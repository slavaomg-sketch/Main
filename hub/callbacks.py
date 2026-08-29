"""Фабрики callback_data хаба. У веток — свои префиксы, они не пересекаются."""

from __future__ import annotations

from aiogram.filters.callback_data import CallbackData


class AgentCb(CallbackData, prefix="hub"):
    """Выбор ветки в меню."""

    slug: str
