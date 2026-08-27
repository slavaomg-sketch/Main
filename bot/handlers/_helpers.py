"""Вспомогательные функции, общие для хендлеров."""

from __future__ import annotations

from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message


async def safe_edit(
    message: Message | None, text: str, markup: InlineKeyboardMarkup | None = None
) -> None:
    """Редактирует сообщение, молча игнорируя «текст не изменился»."""
    if message is None:
        return
    try:
        await message.edit_text(text, reply_markup=markup)
    except TelegramBadRequest as error:
        if "message is not modified" not in str(error):
            raise


async def show(callback: CallbackQuery, text: str, markup: InlineKeyboardMarkup | None = None) -> None:
    await safe_edit(callback.message, text, markup)
    await callback.answer()
