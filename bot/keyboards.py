"""Клавиатуры интерфейса."""

from __future__ import annotations

from typing import Sequence

import aiosqlite
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

from bot.callbacks import (
    DayCb,
    DoneCb,
    EmpCb,
    ItemCb,
    Nav,
    RemCb,
    ReportCb,
    SubCb,
    TimeCb,
    TzCb,
)
from bot.utils import POPULAR_TZ, WEEKDAY_NAMES, format_days, shorten

BTN_MY = "📋 Мои напоминания"
BTN_CATALOG = "📚 Каталог"
BTN_NEW = "➕ Своё напоминание"
BTN_STATS = "📊 Моя статистика"
BTN_SETTINGS = "⚙️ Настройки"
BTN_ADMIN = "🛠 Админка"

TIME_PRESETS = ["07:00", "08:00", "09:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]


def main_menu(is_admin: bool = False) -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text=BTN_MY), KeyboardButton(text=BTN_CATALOG)],
        [KeyboardButton(text=BTN_NEW), KeyboardButton(text=BTN_STATS)],
        [KeyboardButton(text=BTN_SETTINGS)],
    ]
    if is_admin:
        rows[-1].append(KeyboardButton(text=BTN_ADMIN))
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def back_to(target: str, text: str = "‹ Назад") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text=text, callback_data=Nav(to=target))
    return builder.as_markup()


# ------------------------------------------------- напоминание, присланное сотруднику


def delivery_keyboard(
    delivery_id: int, items: Sequence[aiosqlite.Row], finalized: bool = False
) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()

    if finalized:
        done = sum(1 for item in items if item["is_done"])
        label = "✅ Отмечено" if not items or done == len(items) else f"🟡 Отмечено {done}/{len(items)}"
        builder.button(text=label, callback_data=DoneCb(action="noop", delivery_id=delivery_id))
        builder.adjust(1)
        return builder.as_markup()

    for item in items:
        mark = "✅" if item["is_done"] else "☑️"
        builder.button(
            text=f"{mark} {shorten(item['text'], 34)}",
            callback_data=ItemCb(delivery_id=delivery_id, item_id=item["id"]),
        )
    builder.adjust(1)

    if items:
        builder.row(
            InlineKeyboardButton(
                text="☑️ Отметить всё",
                callback_data=DoneCb(action="all", delivery_id=delivery_id).pack(),
            )
        )
        builder.row(
            InlineKeyboardButton(
                text="✅ Готово",
                callback_data=DoneCb(action="finish", delivery_id=delivery_id).pack(),
            ),
            InlineKeyboardButton(
                text="🚫 Не смогу",
                callback_data=DoneCb(action="skip", delivery_id=delivery_id).pack(),
            ),
        )
    else:
        builder.row(
            InlineKeyboardButton(
                text="✅ Выполнено",
                callback_data=DoneCb(action="finish", delivery_id=delivery_id).pack(),
            ),
            InlineKeyboardButton(
                text="🚫 Не смогу",
                callback_data=DoneCb(action="skip", delivery_id=delivery_id).pack(),
            ),
        )
    return builder.as_markup()


# ------------------------------------------------------------ подписки сотрудника


def subscriptions_keyboard(subs: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for sub in subs:
        mark = "🔔" if sub["is_active"] else "🔕"
        lock = "🔒" if sub["scope"] == "global" and sub["is_mandatory"] else ""
        builder.button(
            text=f"{mark} {sub['time']} · {shorten(sub['title'], 26)} {lock}".strip(),
            callback_data=SubCb(action="open", sub_id=sub["id"]),
        )
    builder.adjust(1)
    builder.row(
        InlineKeyboardButton(text="📚 Каталог", callback_data=Nav(to="catalog").pack()),
        InlineKeyboardButton(text="➕ Своё", callback_data=Nav(to="new").pack()),
    )
    return builder.as_markup()


def subscription_card(sub: aiosqlite.Row) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="🕐 Изменить время", callback_data=SubCb(action="time", sub_id=sub["id"]))
    builder.button(text="📅 Изменить дни", callback_data=SubCb(action="days", sub_id=sub["id"]))

    mandatory = sub["scope"] == "global" and sub["is_mandatory"]
    if not mandatory:
        if sub["is_active"]:
            builder.button(
                text="🔕 Приостановить", callback_data=SubCb(action="pause", sub_id=sub["id"])
            )
        else:
            builder.button(
                text="🔔 Возобновить", callback_data=SubCb(action="resume", sub_id=sub["id"])
            )
    if sub["scope"] == "personal":
        builder.button(
            text="🗑 Удалить", callback_data=RemCb(action="confirm_delete", rem_id=sub["reminder_id"])
        )
    builder.adjust(2)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="my").pack()))
    return builder.as_markup()


def catalog_keyboard(
    reminders: Sequence[aiosqlite.Row], subscribed_ids: set[int]
) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for reminder in reminders:
        mark = "✅" if reminder["id"] in subscribed_ids else "➕"
        lock = " 🔒" if reminder["is_mandatory"] else ""
        builder.button(
            text=f"{mark} {shorten(reminder['title'], 30)}{lock}",
            callback_data=RemCb(action="open", rem_id=reminder["id"]),
        )
    builder.adjust(1)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="my").pack()))
    return builder.as_markup()


def catalog_card(reminder: aiosqlite.Row, subscribed: bool) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if subscribed:
        builder.button(
            text="🕐 Настроить время", callback_data=RemCb(action="time", rem_id=reminder["id"])
        )
        if not reminder["is_mandatory"]:
            builder.button(
                text="🚫 Отписаться", callback_data=RemCb(action="leave", rem_id=reminder["id"])
            )
    else:
        builder.button(
            text="➕ Подписаться", callback_data=RemCb(action="join", rem_id=reminder["id"])
        )
    builder.adjust(1)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="catalog").pack()))
    return builder.as_markup()


# ------------------------------------------------------------- выбор времени и дней


def time_keyboard(cancel_to: str = "my") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for value in TIME_PRESETS:
        builder.button(text=value, callback_data=TimeCb(value=value))
    builder.adjust(3)
    builder.row(
        InlineKeyboardButton(text="⌨️ Ввести своё", callback_data=TimeCb(value="manual").pack())
    )
    builder.row(InlineKeyboardButton(text="‹ Отмена", callback_data=Nav(to=cancel_to).pack()))
    return builder.as_markup()


def days_keyboard(selected: Sequence[int]) -> InlineKeyboardMarkup:
    chosen = set(selected)
    builder = InlineKeyboardBuilder()
    for number, name in WEEKDAY_NAMES.items():
        mark = "✅" if number in chosen else "▫️"
        builder.button(text=f"{mark} {name}", callback_data=DayCb(action="toggle", value=str(number)))
    builder.adjust(4, 3)
    builder.row(
        InlineKeyboardButton(
            text="Будни", callback_data=DayCb(action="preset", value="1,2,3,4,5").pack()
        ),
        InlineKeyboardButton(
            text="Каждый день", callback_data=DayCb(action="preset", value="1,2,3,4,5,6,7").pack()
        ),
    )
    builder.row(
        InlineKeyboardButton(text="✅ Сохранить", callback_data=DayCb(action="save", value="").pack())
    )
    return builder.as_markup()


def checklist_edit_keyboard(count: int) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if count:
        builder.button(text="✅ Готово, дальше", callback_data=Nav(to="items_done"))
    builder.button(text="⏭ Без чек-листа", callback_data=Nav(to="items_skip"))
    builder.button(text="✖️ Отмена", callback_data=Nav(to="cancel"))
    builder.adjust(1)
    return builder.as_markup()


def tz_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for index, (label, _) in enumerate(POPULAR_TZ):
        builder.button(text=label, callback_data=TzCb(index=index))
    builder.adjust(2)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="settings").pack()))
    return builder.as_markup()


def settings_keyboard(tz_name: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text=f"🌍 Часовой пояс: {tz_name}", callback_data=Nav(to="tz"))
    builder.button(text="📋 Мои напоминания", callback_data=Nav(to="my"))
    builder.adjust(1)
    return builder.as_markup()


# ------------------------------------------------------------------------ админка


def admin_menu() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="➕ Создать напоминание", callback_data=Nav(to="admin_new"))
    builder.button(text="📋 Все напоминания", callback_data=Nav(to="admin_list"))
    builder.button(text="👥 Сотрудники", callback_data=Nav(to="admin_staff"))
    builder.button(text="📊 Отчёт за сегодня", callback_data=ReportCb(action="show", offset=0))
    builder.button(text="📈 Отчёт за вчера", callback_data=ReportCb(action="show", offset=1))
    builder.adjust(1)
    return builder.as_markup()


def admin_reminders_keyboard(reminders: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for reminder in reminders:
        lock = "🔒" if reminder["is_mandatory"] else "🔓"
        builder.button(
            text=f"{lock} {reminder['default_time']} · {shorten(reminder['title'], 26)}",
            callback_data=RemCb(action="admin_open", rem_id=reminder["id"]),
        )
    builder.adjust(1)
    builder.row(
        InlineKeyboardButton(text="➕ Создать", callback_data=Nav(to="admin_new").pack()),
        InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="admin").pack()),
    )
    return builder.as_markup()


def admin_reminder_card(reminder: aiosqlite.Row) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(
        text="🕐 Время по умолчанию", callback_data=RemCb(action="admin_time", rem_id=reminder["id"])
    )
    builder.button(text="📅 Дни", callback_data=RemCb(action="admin_days", rem_id=reminder["id"]))
    builder.button(
        text="🔒 Обязательное" if reminder["is_mandatory"] else "🔓 По желанию",
        callback_data=RemCb(action="toggle_mandatory", rem_id=reminder["id"]),
    )
    builder.button(
        text="👥 Разослать всем", callback_data=RemCb(action="push_all", rem_id=reminder["id"])
    )
    builder.button(text="🗑 Удалить", callback_data=RemCb(action="confirm_delete", rem_id=reminder["id"]))
    builder.adjust(2)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="admin_list").pack()))
    return builder.as_markup()


def confirm_delete_keyboard(reminder_id: int, back_to_target: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="🗑 Да, удалить", callback_data=RemCb(action="delete", rem_id=reminder_id))
    builder.button(text="‹ Отмена", callback_data=Nav(to=back_to_target))
    builder.adjust(1)
    return builder.as_markup()


def staff_keyboard(employees: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for employee in employees:
        mark = "🟢" if employee["is_active"] else "⛔️"
        role = " 👑" if employee["role"] == "admin" else ""
        builder.button(
            text=f"{mark} {shorten(employee['full_name'], 28)}{role}",
            callback_data=EmpCb(action="open", user_id=employee["tg_id"]),
        )
    builder.adjust(1)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="admin").pack()))
    return builder.as_markup()


def staff_card(employee: aiosqlite.Row) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if employee["is_active"]:
        builder.button(text="⛔️ Отключить", callback_data=EmpCb(action="block", user_id=employee["tg_id"]))
    else:
        builder.button(text="🟢 Включить", callback_data=EmpCb(action="unblock", user_id=employee["tg_id"]))
    builder.adjust(1)
    builder.row(InlineKeyboardButton(text="‹ Назад", callback_data=Nav(to="admin_staff").pack()))
    return builder.as_markup()


def report_nav(offset: int) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="‹ Раньше", callback_data=ReportCb(action="show", offset=offset + 1))
    if offset > 0:
        builder.button(text="Позже ›", callback_data=ReportCb(action="show", offset=offset - 1))
    builder.adjust(2)
    builder.row(InlineKeyboardButton(text="‹ В админку", callback_data=Nav(to="admin").pack()))
    return builder.as_markup()


def summary_line(sub: aiosqlite.Row) -> str:
    days = sub["days"] or sub["reminder_days"]
    return f"{sub['time']} · {format_days(days)}"


__all__ = [name for name in dir() if not name.startswith("_")]
