"""Фабрики callback_data. Отдельный модуль, чтобы префиксы не расползались по коду."""

from __future__ import annotations

from aiogram.filters.callback_data import CallbackData


class Nav(CallbackData, prefix="nav"):
    """Переходы по меню: main, my, catalog, mine, tz, stats, admin, admin_list, ..."""

    to: str


class SubCb(CallbackData, prefix="sub"):
    """Действия над подпиской сотрудника: open, time, days, pause, resume, delete."""

    action: str
    sub_id: int


class RemCb(CallbackData, prefix="rem"):
    """Действия над напоминанием: open, join, leave, time, days, edit, delete, confirm_delete."""

    action: str
    rem_id: int


class ItemCb(CallbackData, prefix="itm"):
    """Отметка пункта чек-листа в присланном напоминании."""

    delivery_id: int
    item_id: int


class DoneCb(CallbackData, prefix="done"):
    """Кнопки под напоминанием: finish (Готово), all (Отметить всё), skip (Не смогу)."""

    action: str
    delivery_id: int


class TzCb(CallbackData, prefix="tz"):
    index: int


class DayCb(CallbackData, prefix="day"):
    """Выбор дней недели в мастере создания: toggle / preset / save."""

    action: str
    value: str


class TimeCb(CallbackData, prefix="time", sep="|"):
    """Быстрый выбор времени: value = 'HH:MM' или 'manual'.

    Разделитель заменён на '|', потому что двоеточие внутри времени
    конфликтует со стандартным разделителем callback_data.
    """

    value: str


class EmpCb(CallbackData, prefix="emp"):
    """Карточка сотрудника в админке: open, block, unblock, report."""

    action: str
    user_id: int


class ReportCb(CallbackData, prefix="rep"):
    """Отчёт за день: offset = 0 сегодня, 1 вчера и т.д."""

    action: str
    offset: int
