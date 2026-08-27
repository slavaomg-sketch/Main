"""Сборка текстовых отчётов для администратора и статистики для сотрудника."""

from __future__ import annotations

from collections import defaultdict

import aiosqlite

from bot import repo
from bot.utils import (
    escape,
    format_date,
    format_minutes,
    parse_utc,
    percent,
    progress_bar,
)

STATUS_ICON = {
    "done": "✅",
    "partial": "🟡",
    "missed": "❌",
    "sent": "⏳",
    "failed": "⚠️",
}
STATUS_NAME = {
    "done": "выполнено",
    "partial": "частично",
    "missed": "не отмечено",
    "sent": "ожидает",
    "failed": "не доставлено",
}


def _reaction_minutes(delivery: aiosqlite.Row) -> float | None:
    sent = parse_utc(delivery["sent_at"])
    answered = parse_utc(delivery["first_response_at"])
    if not sent or not answered:
        return None
    return max(0.0, (answered - sent).total_seconds() / 60)


def _avg(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


async def build_daily_report(conn: aiosqlite.Connection, local_date: str) -> str:
    """Итоговый отчёт по всем сотрудникам за один день."""
    deliveries = await repo.deliveries_for_date(conn, local_date)
    header = f"📊 <b>Отчёт за {format_date(local_date)}</b>"

    if not deliveries:
        return f"{header}\n\nЗа этот день напоминаний не отправлялось."

    by_user: dict[int, list[aiosqlite.Row]] = defaultdict(list)
    for delivery in deliveries:
        by_user[delivery["user_id"]].append(delivery)

    total = len(deliveries)
    counters = {"done": 0, "partial": 0, "missed": 0, "sent": 0, "failed": 0}
    reactions: list[float] = []
    items_total = items_done = 0

    for delivery in deliveries:
        counters[delivery["status"]] = counters.get(delivery["status"], 0) + 1
        items_total += delivery["items_total"] or 0
        items_done += delivery["items_done"] or 0
        reaction = _reaction_minutes(delivery)
        if reaction is not None:
            reactions.append(reaction)

    lines = [
        header,
        "",
        f"{progress_bar(counters['done'], total)}  {percent(counters['done'], total)}% выполнено",
        "",
        f"Всего напоминаний: <b>{total}</b>",
        f"✅ Выполнено полностью: <b>{counters['done']}</b>",
    ]
    if counters["partial"]:
        lines.append(f"🟡 Частично: <b>{counters['partial']}</b>")
    if counters["missed"]:
        lines.append(f"❌ Не отмечено: <b>{counters['missed']}</b>")
    if counters["sent"]:
        lines.append(f"⏳ Ещё в работе: <b>{counters['sent']}</b>")
    if counters["failed"]:
        lines.append(f"⚠️ Не доставлено: <b>{counters['failed']}</b>")
    if items_total:
        lines.append(f"☑️ Пунктов чек-листов: <b>{items_done}/{items_total}</b>")
    lines.append(f"⏱ Среднее время реакции: <b>{format_minutes(_avg(reactions))}</b>")

    for user_id, user_deliveries in by_user.items():
        name = escape(user_deliveries[0]["full_name"])
        username = user_deliveries[0]["username"]
        handle = f" (@{escape(username)})" if username else ""

        user_done = sum(1 for d in user_deliveries if d["status"] == "done")
        user_reactions = [
            value for value in (_reaction_minutes(d) for d in user_deliveries) if value is not None
        ]
        user_items_total = sum(d["items_total"] or 0 for d in user_deliveries)
        user_items_done = sum(d["items_done"] or 0 for d in user_deliveries)

        lines.append("")
        lines.append(f"👤 <b>{name}</b>{handle}")
        summary = f"   {user_done}/{len(user_deliveries)} напоминаний"
        if user_items_total:
            summary += f" · пункты {user_items_done}/{user_items_total}"
        summary += f" · реакция {format_minutes(_avg(user_reactions))}"
        lines.append(summary)

        for delivery in user_deliveries:
            icon = STATUS_ICON.get(delivery["status"], "•")
            title = escape(delivery["title"])
            detail = ""
            if delivery["items_total"]:
                detail = f" — {delivery['items_done']}/{delivery['items_total']}"
            elif delivery["status"] in ("missed", "sent"):
                detail = f" — {STATUS_NAME.get(delivery['status'], '')}"
            lines.append(f"   {icon} {delivery['scheduled_time']} {title}{detail}")

            if delivery["status"] in ("partial", "missed") and delivery["items_total"]:
                for item in await repo.undone_items(conn, delivery["id"]):
                    lines.append(f"        ◻️ {escape(item['text'])}")

    idle = [
        employee
        for employee in await repo.list_users(conn, only_active=True)
        if employee["tg_id"] not in by_user
    ]
    if idle:
        lines.append("")
        lines.append("💤 <i>Без напоминаний в этот день:</i>")
        lines.append("   " + ", ".join(escape(e["full_name"]) for e in idle))

    return "\n".join(lines)


async def build_user_summary(conn: aiosqlite.Connection, user_id: int, days: int = 7) -> str:
    """Личная статистика сотрудника за последние N дней."""
    stats = await repo.user_stats(conn, user_id, days)
    total = (stats["total"] if stats else 0) or 0

    if not total:
        return (
            f"📊 <b>Ваша статистика за {days} дн.</b>\n\n"
            "Пока нет ни одного отправленного напоминания."
        )

    done = stats["done"] or 0
    partial = stats["partial"] or 0
    missed = stats["missed"] or 0

    lines = [
        f"📊 <b>Ваша статистика за {days} дн.</b>",
        "",
        f"{progress_bar(done, total)}  {percent(done, total)}%",
        "",
        f"Всего напоминаний: <b>{total}</b>",
        f"✅ Выполнено: <b>{done}</b>",
    ]
    if partial:
        lines.append(f"🟡 Частично: <b>{partial}</b>")
    if missed:
        lines.append(f"❌ Пропущено: <b>{missed}</b>")
    return "\n".join(lines)


def chunk(text: str, limit: int = 3900) -> list[str]:
    """Режет длинный отчёт на сообщения, не разрывая строки."""
    if len(text) <= limit:
        return [text]

    parts: list[str] = []
    current: list[str] = []
    size = 0
    for line in text.split("\n"):
        line = line[:limit]
        if size + len(line) + 1 > limit and current:
            parts.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        parts.append("\n".join(current))
    return parts
