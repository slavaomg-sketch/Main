"""Клавиатура под карточкой поездки."""

from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from tracker.models import Trip

from .callbacks import AlertCb, TripCb
from .config import ALERT_PRESETS


def trip_keyboard(trip: Trip) -> InlineKeyboardMarkup:
    """Кнопки-переключатели интервалов плюс «свой интервал» и «не следить»."""
    builder = InlineKeyboardBuilder()

    minutes = sorted(set(ALERT_PRESETS) | set(trip.alerts))
    for value in minutes:
        chosen = value in trip.alerts
        label = "в момент прибытия" if value == 0 else f"{value} мин"
        builder.button(
            text=f"✅ {label}" if chosen else label,
            callback_data=AlertCb(trip_id=trip.id, minutes=value),
        )
    builder.button(text="⏱ Свой интервал", callback_data=TripCb(action="custom", trip_id=trip.id))
    builder.button(text="⏹ Не следить", callback_data=TripCb(action="stop", trip_id=trip.id))

    builder.adjust(*([3] * ((len(minutes) + 2) // 3)), 1, 1)
    return builder.as_markup()
