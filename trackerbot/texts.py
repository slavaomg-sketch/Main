"""Тексты сообщений бота-трекера."""

from __future__ import annotations

from datetime import datetime
from html import escape as _escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from tracker.eta import humanize
from tracker.models import (
    ARRIVED,
    EVENT_ALERT,
    EVENT_ARRIVED,
    EVENT_FINISHED,
    FINISHED,
    Event,
    Trip,
    TripState,
)

GREETING = (
    "👋 <b>Я слежу за доставкой и говорю, когда пора выходить.</b>\n\n"
    "Пришлите ссылку отслеживания — такую, какую даёт Яндекс Доставка:\n"
    "<code>https://dostavka.yandex.ru/route/…</code>\n\n"
    "Дальше я сам:\n"
    "• буду обновлять карточку заказа, пока курьер едет;\n"
    "• пришлю отдельное сообщение за столько минут до прибытия, "
    "за сколько попросите (по умолчанию за 5);\n"
    "• скажу, когда курьер будет на месте.\n\n"
    "Интервал меняется кнопками под карточкой — можно выбрать несколько сразу, "
    "например за 15 и за 5 минут."
)

HELP = (
    "<b>Как пользоваться</b>\n\n"
    "1️⃣ Пришлите ссылку отслеживания — я начну следить.\n"
    "2️⃣ Кнопками под карточкой выберите, за сколько минут напомнить. "
    "Кнопки переключаются: можно включить сразу несколько интервалов.\n"
    "3️⃣ «⏱ Свой интервал» — если нужного значения нет среди кнопок.\n"
    "4️⃣ «⏹ Не следить» — убрать поездку.\n\n"
    "Выбранные интервалы я запоминаю и в следующий раз поставлю их сам.\n\n"
    "Команды: /list — активные поездки, /help — эта справка."
)

NO_LINK = (
    "Не вижу ссылки отслеживания. Пришлите ссылку вида\n"
    "<code>https://dostavka.yandex.ru/route/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>\n\n"
    "Её можно скопировать в приложении Яндекс Go: «Поделиться поездкой»."
)

NOT_ALLOWED = "Этот бот личный. Если он нужен вам — поднимите свою копию, код открыт."

NOTHING_TRACKED = "Сейчас я ни за чем не слежу. Пришлите ссылку отслеживания."

ASK_CUSTOM = (
    "За сколько минут до прибытия напомнить?\n"
    "Пришлите число — например <code>7</code>. От 0 до 1440."
)

BAD_CUSTOM = "Нужно число минут от 0 до 1440. Например: <code>7</code>"

STOPPED = "⏹ Больше не слежу за этой поездкой."

TRIP_GONE = "Эта поездка уже не отслеживается."


def escape(text: str | None) -> str:
    return _escape(str(text or ""), quote=False)


def local_time(moment: datetime | None, tz: str) -> str:
    """Время в поясе пользователя: сервер обычно живёт в UTC."""
    if moment is None:
        return ""
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        zone = None
    return (moment.astimezone(zone) if zone else moment.astimezone()).strftime("%H:%M")


def alerts_line(alerts: list[int]) -> str:
    if not alerts:
        return "напоминаний нет — выберите интервал кнопкой"
    return ", ".join(humanize(alert) if alert else "в момент прибытия" for alert in sorted(alerts, reverse=True))


def trip_card(trip: Trip, state: TripState | None, tz: str, error: str = "") -> str:
    """Карточка поездки — её бот обновляет, пока курьер едет."""
    lines = [f"🚕 <b>{escape(trip.title)}</b>"]

    if error:
        lines.append(f"\n⚠️ {escape(error)}")
    elif state is None:
        lines.append("\nСтатус пока неизвестен.")
    else:
        lines.append(escape(state.headline()))
        if state.destination:
            lines.append(f"\n📍 {escape(state.destination)}")
        who = " · ".join(part for part in (state.performer, state.vehicle) if part)
        if who:
            lines.append(f"🚗 {escape(who)}")
        if state.status not in (ARRIVED, FINISHED) and state.arrival_at:
            lines.append(f"🕒 Прибытие ~{local_time(state.arrival_at, tz)}")

    # Завершённому заказу обещать напоминания незачем.
    if state is None or state.status != FINISHED:
        lines.append(f"\n🔔 Напомню за: {escape(alerts_line(trip.alerts))}")
    lines.append(f'<a href="{escape(trip.url)}">Открыть отслеживание</a>')
    return "\n".join(lines)


def event_message(event: Event, tz: str) -> str:
    """Отдельное сообщение — именно оно даёт push-уведомление на телефон."""
    state = event.state
    if event.kind == EVENT_ARRIVED:
        head = f"🚗 <b>{escape(event.trip.title)}: курьер на месте</b>"
    elif event.kind == EVENT_FINISHED:
        head = f"✅ <b>{escape(event.trip.title)}: заказ завершён</b>"
    elif event.kind == EVENT_ALERT:
        left = state.minutes_left()
        head = f"🔔 <b>{escape(event.trip.title)}: курьер через {humanize(left)}</b>"
    else:
        head = f"ℹ️ <b>{escape(event.trip.title)}</b>"

    lines = [head]
    if event.kind == EVENT_ALERT:
        if state.destination:
            lines.append(f"📍 {escape(state.destination)}")
        who = " · ".join(part for part in (state.performer, state.vehicle) if part)
        if who:
            lines.append(f"🚗 {escape(who)}")
        if state.arrival_at:
            lines.append(f"🕒 Прибытие ~{local_time(state.arrival_at, tz)}")
        lines.append("\nПора выходить 🙂")
    elif event.kind == EVENT_ARRIVED:
        if state.destination:
            lines.append(f"📍 {escape(state.destination)}")
        who = " · ".join(part for part in (state.performer, state.vehicle) if part)
        if who:
            lines.append(f"🚗 {escape(who)}")
    return "\n".join(lines)
