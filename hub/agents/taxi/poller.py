"""Фоновый опрос: обновляет карточки и присылает напоминания."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError, TelegramRetryAfter

from tracker.models import FINISHED, Trip, TripState
from tracker.providers import YandexDeliveryProvider
from tracker.store import TripStore
from tracker.watcher import apply_events, evaluate, next_delay

from .config import TaxiConfig
from .service import fetch_state, refresh_card
from .texts import event_message

log = logging.getLogger(__name__)

IDLE_SECONDS = 30.0
MIN_SECONDS = 5.0


class TripPoller:
    """Раз в несколько секунд обходит активные поездки всех чатов."""

    def __init__(
        self,
        bot: Bot,
        store: TripStore,
        config: TaxiConfig,
        provider=None,
        sleep=asyncio.sleep,
    ) -> None:
        self.bot = bot
        self.store = store
        self.config = config
        self.provider = provider or YandexDeliveryProvider()
        self.sleep = sleep
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="tracker-poller")

    async def shutdown(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                delay = await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - фоновая задача не должна умирать
                log.exception("Сбой при опросе поездок")
                delay = IDLE_SECONDS
            await self.sleep(delay)

    async def tick(self) -> float:
        """Один проход. Возвращает паузу до следующего."""
        trips = [trip for trip in self.store.active() if trip.chat_id is not None]
        if not trips:
            return max(self.config.poll_seconds, IDLE_SECONDS)

        delays: list[float] = []
        for trip in trips:
            state, error = await fetch_state(self.provider, trip)
            if state is None:
                log.info("Поездка %s: %s", trip.id, error)
                delays.append(max(self.config.poll_seconds, IDLE_SECONDS))
                continue

            events = evaluate(trip, state)
            try:
                # Сначала само напоминание — отдельным сообщением, чтобы прилетел push.
                for event in events:
                    await self.bot.send_message(
                        trip.chat_id,
                        event_message(event, self.config.tz),
                        disable_web_page_preview=True,
                    )
            except TelegramForbiddenError:
                # Бота заблокировали или удалили из чата — следить больше не для кого.
                log.info("Чат %s недоступен, снимаю поездку %s", trip.chat_id, trip.id)
                self._retire(trip)
                continue
            except TelegramRetryAfter as error_:
                # Напоминание не ушло: ничего не помечаем и повторим после паузы.
                log.warning("Telegram просит подождать %s с", error_.retry_after)
                return float(error_.retry_after)
            except TelegramAPIError as error_:
                log.warning("Telegram отказал по поездке %s: %s", trip.id, error_)

            # Помечаем сразу после отправки, чтобы сбой на карточке не задвоил напоминание.
            apply_events(trip, events, state)
            self.store.update(trip)

            try:
                await refresh_card(
                    self.bot,
                    self.store,
                    self.config,
                    trip,
                    state,
                    with_buttons=state.status != FINISHED,
                )
            except TelegramForbiddenError:
                self._retire(trip)
                continue
            except TelegramAPIError as error_:
                log.warning("Карточка поездки %s не обновилась: %s", trip.id, error_)

            delays.append(self._delay_for(trip, state))

        return max(min(delays), MIN_SECONDS) if delays else IDLE_SECONDS

    def _delay_for(self, trip: Trip, state: TripState) -> float:
        if trip.done:
            return max(self.config.poll_seconds, IDLE_SECONDS)
        # poll_seconds — нижняя граница: чаще не ходим, даже если порог совсем близко.
        return max(next_delay(trip, state), self.config.poll_seconds)

    def _retire(self, trip: Trip) -> None:
        trip.done = True
        self.store.update(trip)
