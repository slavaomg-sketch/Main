"""Фабрики callback_data бота-трекера."""

from __future__ import annotations

from aiogram.filters.callback_data import CallbackData


class AlertCb(CallbackData, prefix="al"):
    """Включить/выключить порог напоминания под карточкой поездки."""

    trip_id: str
    minutes: int


class TripCb(CallbackData, prefix="tr"):
    """Действия над поездкой: custom (свой интервал), stop, refresh."""

    action: str
    trip_id: str
