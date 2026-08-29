"""Общая работа с поездками: получить состояние, показать карточку, переключить порог.

Вынесено из обработчиков, чтобы одну и ту же карточку одинаково рисовали
и ответ на сообщение, и фоновый опрос.
"""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError

from tracker.models import Trip, TripState, now_utc
from tracker.providers import TrackerError
from tracker.store import TripStore

from .config import BotConfig
from .keyboards import trip_keyboard
from .texts import trip_card

log = logging.getLogger(__name__)

CARD_CHAT = "card:chat_id"
CARD_MESSAGE = "card:message_id"
CARD_TEXT = "card:text"


async def fetch_state(provider, trip: Trip) -> tuple[TripState | None, str]:
    """Состояние поездки. Сетевой запрос уводим в поток, чтобы не блокировать бота."""
    try:
        state = await asyncio.to_thread(provider.fetch, trip.key)
    except TrackerError as error:
        return None, str(error)
    return state, ""


async def send_card(
    bot: Bot, store: TripStore, config: BotConfig, trip: Trip, state: TripState | None, error: str = ""
) -> None:
    """Присылает карточку поездки и запоминает её, чтобы потом обновлять."""
    text = trip_card(trip, state, config.tz, error)
    message = await bot.send_message(
        trip.chat_id,
        text,
        reply_markup=trip_keyboard(trip),
        disable_web_page_preview=True,
    )
    trip.external[CARD_CHAT] = str(message.chat.id)
    trip.external[CARD_MESSAGE] = str(message.message_id)
    trip.external[CARD_TEXT] = text
    store.update(trip)


async def refresh_card(
    bot: Bot,
    store: TripStore,
    config: BotConfig,
    trip: Trip,
    state: TripState | None,
    error: str = "",
    with_buttons: bool = True,
) -> None:
    """Обновляет карточку на месте. Молча пропускает, если менять нечего."""
    message_id = trip.external.get(CARD_MESSAGE)
    chat_id = trip.external.get(CARD_CHAT) or trip.chat_id
    if not message_id or chat_id is None:
        return

    text = trip_card(trip, state, config.tz, error)
    if text == trip.external.get(CARD_TEXT):
        return

    try:
        await bot.edit_message_text(
            text,
            chat_id=int(chat_id),
            message_id=int(message_id),
            reply_markup=trip_keyboard(trip) if with_buttons else None,
            disable_web_page_preview=True,
        )
    except TelegramBadRequest as error_:
        # Сообщение удалили или текст совпал — не повод падать.
        log.debug("Карточка %s не обновилась: %s", trip.id, error_)
    except TelegramForbiddenError:
        raise
    else:
        trip.external[CARD_TEXT] = text
        store.update(trip)


def toggle_alert(trip: Trip, minutes: int) -> str:
    """Включает или выключает порог. Возвращает короткий ответ для всплывашки."""
    if minutes in trip.alerts:
        trip.alerts = [alert for alert in trip.alerts if alert != minutes]
        trip.fired = [alert for alert in trip.fired if alert != minutes]
        return f"Убрал напоминание за {minutes} мин"

    trip.alerts = sorted(set(trip.alerts) | {minutes}, reverse=True)

    # Если этот момент уже прошёл, сразу помечаем порог отработанным,
    # иначе бот тут же пришлёт «курьер через N минут» задним числом.
    left = _minutes_left(trip)
    if left is not None and left <= minutes and minutes not in trip.fired:
        trip.fired.append(minutes)
        return f"За {minutes} мин уже поздно — этот момент прошёл"
    return f"Напомню за {minutes} мин"


def _minutes_left(trip: Trip) -> float | None:
    if trip.scheduled_arrival is None:
        return None
    return (trip.scheduled_arrival - now_utc()).total_seconds() / 60
