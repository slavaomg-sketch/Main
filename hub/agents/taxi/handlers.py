"""Ветка «Доставка»: ссылка, кнопки интервалов, список поездок.

Зависимости названы с приставкой `taxi_`, чтобы ветки не мешали друг другу:
диспетчер подставляет их в обработчики по имени параметра.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from tracker.models import Trip
from tracker.providers import ORIGIN, find_keys
from tracker.store import TripStore

from .callbacks import AlertCb, TripCb
from .config import MAX_ALERT_MINUTES, TaxiConfig
from .service import fetch_state, refresh_card, send_card, toggle_alert
from .texts import ASK_CUSTOM, BAD_CUSTOM, NO_LINK, NOTHING_TRACKED, STOPPED, TRIP_GONE

log = logging.getLogger(__name__)
router = Router(name="agent-taxi")


class Ask(StatesGroup):
    custom_interval = State()


@router.message(Command("list"))
async def cmd_list(
    message: Message,
    taxi_store: TripStore,
    taxi_config: TaxiConfig,
    taxi_provider,
) -> None:
    trips = taxi_store.active(message.chat.id)
    if not trips:
        await message.answer(NOTHING_TRACKED)
        return
    for trip in trips:
        state, error = await fetch_state(taxi_provider, trip)
        await send_card(message.bot, taxi_store, taxi_config, trip, state, error)


@router.message(Ask.custom_interval, F.text)
async def got_custom_interval(
    message: Message,
    state: FSMContext,
    taxi_store: TripStore,
    taxi_config: TaxiConfig,
    taxi_provider,
) -> None:
    raw = (message.text or "").strip()
    if not raw.isdigit() or not 0 <= int(raw) <= MAX_ALERT_MINUTES:
        await message.answer(BAD_CUSTOM)
        return

    data = await state.get_data()
    await state.clear()

    trip = taxi_store.find(data.get("trip_id", ""))
    if trip is None or trip.done:
        await message.answer(TRIP_GONE)
        return

    answer = toggle_alert(trip, int(raw))
    taxi_store.update(trip)
    taxi_store.remember_chat_alerts(trip.chat_id, trip.alerts)

    trip_state, error = await fetch_state(taxi_provider, trip)
    await refresh_card(message.bot, taxi_store, taxi_config, trip, trip_state, error)
    await message.answer(answer)


@router.message(F.text)
async def got_link(
    message: Message,
    state: FSMContext,
    taxi_store: TripStore,
    taxi_config: TaxiConfig,
    taxi_provider,
) -> None:
    keys = find_keys(message.text or "")
    if not keys:
        await message.answer(NO_LINK, disable_web_page_preview=True)
        return

    await state.clear()
    alerts = taxi_store.chat_alerts(message.chat.id) or list(taxi_config.default_alerts)

    for key in keys:
        trip = taxi_store.add(
            Trip(
                key=key,
                url=f"{ORIGIN}/route/{key}",
                alerts=list(alerts),
                notifiers=[],
                chat_id=message.chat.id,
            )
        )
        trip_state, error = await fetch_state(taxi_provider, trip)
        # Карточка и есть подтверждение: в ней сразу видно статус и выбранные интервалы.
        await send_card(message.bot, taxi_store, taxi_config, trip, trip_state, error)


@router.callback_query(AlertCb.filter())
async def on_alert_toggle(
    call: CallbackQuery,
    callback_data: AlertCb,
    taxi_store: TripStore,
    taxi_config: TaxiConfig,
    taxi_provider,
) -> None:
    trip = taxi_store.find(callback_data.trip_id)
    if trip is None or trip.done:
        await call.answer(TRIP_GONE, show_alert=True)
        return

    answer = toggle_alert(trip, callback_data.minutes)
    taxi_store.update(trip)
    taxi_store.remember_chat_alerts(trip.chat_id, trip.alerts)

    trip_state, error = await fetch_state(taxi_provider, trip)
    await refresh_card(call.bot, taxi_store, taxi_config, trip, trip_state, error)
    await call.answer(answer)


@router.callback_query(TripCb.filter(F.action == "custom"))
async def on_custom(
    call: CallbackQuery, callback_data: TripCb, state: FSMContext, taxi_store: TripStore
) -> None:
    trip = taxi_store.find(callback_data.trip_id)
    if trip is None or trip.done:
        await call.answer(TRIP_GONE, show_alert=True)
        return
    await state.set_state(Ask.custom_interval)
    await state.update_data(trip_id=trip.id)
    await call.message.answer(ASK_CUSTOM)
    await call.answer()


@router.callback_query(TripCb.filter(F.action == "stop"))
async def on_stop(call: CallbackQuery, callback_data: TripCb, taxi_store: TripStore) -> None:
    removed = taxi_store.remove(callback_data.trip_id)
    if removed is None:
        await call.answer(TRIP_GONE, show_alert=True)
        return
    await call.message.edit_text(STOPPED, reply_markup=None)
    await call.answer("Убрал")
