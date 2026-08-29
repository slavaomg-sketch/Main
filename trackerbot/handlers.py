"""Обработчики бота-трекера: ссылка, кнопки интервалов, команды."""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from tracker.models import Trip
from tracker.providers import ORIGIN, find_keys
from tracker.store import TripStore

from .callbacks import AlertCb, TripCb
from .config import MAX_ALERT_MINUTES, BotConfig
from .service import fetch_state, refresh_card, send_card, toggle_alert
from .texts import (
    ASK_CUSTOM,
    BAD_CUSTOM,
    GREETING,
    HELP,
    NO_LINK,
    NOTHING_TRACKED,
    STOPPED,
    TRIP_GONE,
)

log = logging.getLogger(__name__)
router = Router(name="tracker-bot")


class Ask(StatesGroup):
    custom_interval = State()


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(GREETING, disable_web_page_preview=True)


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(HELP)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Отменил.")


@router.message(Command("list"))
async def cmd_list(message: Message, store: TripStore, config: BotConfig, provider) -> None:
    trips = store.active(message.chat.id)
    if not trips:
        await message.answer(NOTHING_TRACKED)
        return
    for trip in trips:
        state, error = await fetch_state(provider, trip)
        await send_card(message.bot, store, config, trip, state, error)


@router.message(Ask.custom_interval, F.text)
async def got_custom_interval(
    message: Message, state: FSMContext, store: TripStore, config: BotConfig, provider
) -> None:
    raw = (message.text or "").strip()
    if not raw.isdigit() or not 0 <= int(raw) <= MAX_ALERT_MINUTES:
        await message.answer(BAD_CUSTOM)
        return

    data = await state.get_data()
    await state.clear()

    trip = store.find(data.get("trip_id", ""))
    if trip is None or trip.done:
        await message.answer(TRIP_GONE)
        return

    answer = toggle_alert(trip, int(raw))
    store.update(trip)
    store.remember_chat_alerts(trip.chat_id, trip.alerts)

    trip_state, error = await fetch_state(provider, trip)
    await refresh_card(message.bot, store, config, trip, trip_state, error)
    await message.answer(answer)


@router.message(F.text)
async def got_link(message: Message, state: FSMContext, store: TripStore, config: BotConfig, provider) -> None:
    keys = find_keys(message.text or "")
    if not keys:
        await message.answer(NO_LINK, disable_web_page_preview=True)
        return

    await state.clear()
    alerts = store.chat_alerts(message.chat.id) or list(config.default_alerts)

    for key in keys:
        trip = Trip(
            key=key,
            url=f"{ORIGIN}/route/{key}",
            alerts=list(alerts),
            notifiers=[],
            chat_id=message.chat.id,
        )
        trip = store.add(trip)

        trip_state, error = await fetch_state(provider, trip)
        # Карточка и есть подтверждение: в ней сразу видно статус и выбранные интервалы.
        await send_card(message.bot, store, config, trip, trip_state, error)


@router.callback_query(AlertCb.filter())
async def on_alert_toggle(
    call: CallbackQuery, callback_data: AlertCb, store: TripStore, config: BotConfig, provider
) -> None:
    trip = store.find(callback_data.trip_id)
    if trip is None or trip.done:
        await call.answer(TRIP_GONE, show_alert=True)
        return

    answer = toggle_alert(trip, callback_data.minutes)
    store.update(trip)
    store.remember_chat_alerts(trip.chat_id, trip.alerts)

    trip_state, error = await fetch_state(provider, trip)
    await refresh_card(call.bot, store, config, trip, trip_state, error)
    await call.answer(answer)


@router.callback_query(TripCb.filter(F.action == "custom"))
async def on_custom(call: CallbackQuery, callback_data: TripCb, state: FSMContext, store: TripStore) -> None:
    trip = store.find(callback_data.trip_id)
    if trip is None or trip.done:
        await call.answer(TRIP_GONE, show_alert=True)
        return
    await state.set_state(Ask.custom_interval)
    await state.update_data(trip_id=trip.id)
    await call.message.answer(ASK_CUSTOM)
    await call.answer()


@router.callback_query(TripCb.filter(F.action == "stop"))
async def on_stop(call: CallbackQuery, callback_data: TripCb, store: TripStore) -> None:
    removed = store.remove(callback_data.trip_id)
    if removed is None:
        await call.answer(TRIP_GONE, show_alert=True)
        return
    await call.message.edit_text(STOPPED, reply_markup=None)
    await call.answer("Убрал")
