"""Текстовые заготовки сообщений."""

from __future__ import annotations

from typing import Sequence

import aiosqlite

from bot.utils import escape, format_days, percent

GREETING = (
    "👋 <b>Привет, {name}!</b>\n\n"
    "Я напоминаю о рабочих процессах и веду учёт выполнения.\n\n"
    "Как это работает:\n"
    "1️⃣ Вы подписываетесь на напоминания и <b>сами выбираете время</b>, когда их получать.\n"
    "2️⃣ В назначенное время я присылаю чек-лист.\n"
    "3️⃣ Вы отмечаете галочками, что сделано, и жмёте «Готово».\n"
    "4️⃣ Вечером руководитель получает сводный отчёт.\n\n"
    "Начните с кнопки «📋 Мои напоминания»."
)

HELP = (
    "<b>Что я умею</b>\n\n"
    "📋 <b>Мои напоминания</b> — список того, что вам приходит, и время получения.\n"
    "📚 <b>Каталог</b> — общие напоминания компании; можно подписаться на необязательные.\n"
    "➕ <b>Своё напоминание</b> — личный чек-лист с вашим временем.\n"
    "📊 <b>Моя статистика</b> — как вы отмечались последние 7 дней.\n"
    "⚙️ <b>Настройки</b> — часовой пояс (важно, чтобы напоминания приходили вовремя).\n\n"
    "Команды: /start, /menu, /my, /help"
)

ADMIN_HELP = (
    "<b>Админка</b>\n\n"
    "➕ <b>Создать напоминание</b> — название, чек-лист, время и дни. "
    "Обязательные автоматически подключаются всем сотрудникам, необязательные видны в каталоге.\n"
    "📋 <b>Все напоминания</b> — редактировать, удалить, разослать всем.\n"
    "👥 <b>Сотрудники</b> — список, отключение уволенных.\n"
    "📊 <b>Отчёт</b> — сводка за день. Такой же приходит автоматически вечером.\n\n"
    "Команды: /admin, /report, /report_yesterday"
)


def render_delivery(
    title: str,
    description: str | None,
    items: Sequence[aiosqlite.Row],
    scheduled_time: str,
    finalized: bool = False,
    skipped: bool = False,
) -> str:
    """Текст напоминания, присланного сотруднику."""
    head = "🚫" if skipped else ("✅" if finalized else "🔔")
    lines = [f"{head} <b>{escape(title)}</b>", f"<i>Напоминание на {scheduled_time}</i>"]

    if description:
        lines += ["", escape(description)]

    if items:
        done = sum(1 for item in items if item["is_done"])
        lines += ["", f"<b>Чек-лист</b> — {done}/{len(items)} ({percent(done, len(items))}%)"]
        for item in items:
            mark = "✅" if item["is_done"] else "◻️"
            text = escape(item["text"])
            lines.append(f"{mark} <s>{text}</s>" if item["is_done"] else f"{mark} {text}")

    lines.append("")
    if skipped:
        lines.append("<i>Отмечено как невыполненное. Попадёт в вечерний отчёт.</i>")
    elif finalized:
        lines.append("<i>Принято, спасибо! Записал в отчёт.</i>")
    elif items:
        lines.append("<i>Отметьте выполненные пункты и нажмите «Готово».</i>")
    else:
        lines.append("<i>Нажмите «Выполнено», когда сделаете.</i>")
    return "\n".join(lines)


def render_nudge(title: str, scheduled_time: str) -> str:
    return (
        f"⏰ <b>Напоминание ещё не закрыто</b>\n\n"
        f"«{escape(title)}» на {scheduled_time} — вы пока не отметились.\n"
        f"<i>Откройте сообщение выше и поставьте галочки.</i>"
    )


def render_subscription_card(sub: aiosqlite.Row, items: Sequence[aiosqlite.Row]) -> str:
    kind = "🏢 Общее напоминание" if sub["scope"] == "global" else "👤 Личное напоминание"
    if sub["scope"] == "global" and sub["is_mandatory"]:
        kind += " · обязательное"

    lines = [
        f"<b>{escape(sub['title'])}</b>",
        kind,
        "",
        f"🕐 Время: <b>{sub['time']}</b>",
        f"📅 Дни: <b>{format_days(sub['days'] or sub['reminder_days'])}</b>",
        f"🔔 Статус: <b>{'активно' if sub['is_active'] else 'приостановлено'}</b>",
    ]
    if sub["description"]:
        lines += ["", escape(sub["description"])]
    if items:
        lines += ["", "<b>Чек-лист:</b>"]
        lines += [f"{index}. {escape(item['text'])}" for index, item in enumerate(items, 1)]
    return "\n".join(lines)


def render_reminder_card(
    reminder: aiosqlite.Row, items: Sequence[aiosqlite.Row], subscribers: int | None = None
) -> str:
    kind = "🔒 обязательное для всех" if reminder["is_mandatory"] else "🔓 по желанию"
    lines = [
        f"<b>{escape(reminder['title'])}</b>",
        kind,
        "",
        f"🕐 Время по умолчанию: <b>{reminder['default_time']}</b>",
        f"📅 Дни: <b>{format_days(reminder['days'])}</b>",
    ]
    if subscribers is not None:
        lines.append(f"👥 Подписано сотрудников: <b>{subscribers}</b>")
    if reminder["description"]:
        lines += ["", escape(reminder["description"])]
    if items:
        lines += ["", "<b>Чек-лист:</b>"]
        lines += [f"{index}. {escape(item['text'])}" for index, item in enumerate(items, 1)]
    else:
        lines += ["", "<i>Без чек-листа — одна кнопка «Выполнено».</i>"]
    return "\n".join(lines)
