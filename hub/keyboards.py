"""Меню веток."""

from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from .callbacks import AgentCb
from .registry import Agent


def agents_menu(agents: list[Agent], active: str | None = None) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for agent in agents:
        mark = "✅ " if agent.slug == active else ""
        builder.button(text=f"{mark}{agent.title}", callback_data=AgentCb(slug=agent.slug))
    builder.adjust(1)
    return builder.as_markup()
