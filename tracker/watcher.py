"""Главный цикл: опрашивает Яндекс и решает, когда пора напомнить."""

from __future__ import annotations

import sys
import time
from datetime import datetime

from .eta import humanize
from .models import (
    ARRIVED,
    EVENT_ALERT,
    EVENT_ARRIVED,
    EVENT_FINISHED,
    FINISHED,
    Event,
    Trip,
    TripState,
    now_utc,
)
from .notifiers import Notifier
from .providers import TrackerError, YandexDeliveryProvider
from .store import TripStore

# Когда до ближайшего порога совсем немного, опрашиваем чаще.
NEAR_THRESHOLD_MINUTES = 2.0
NEAR_POLL_SECONDS = 10.0
IDLE_POLL_SECONDS = 60.0


def _details(trip: Trip, state: TripState) -> str:
    lines = []
    if state.summary:
        lines.append(state.summary)
    if state.destination:
        lines.append(f"Адрес: {state.destination}")
    if state.performer or state.vehicle:
        lines.append(
            "Курьер: " + " · ".join(part for part in (state.performer, state.vehicle) if part)
        )
    arrival = state.arrival_at
    if arrival:
        lines.append(f"Прибытие ~{arrival.astimezone().strftime('%H:%M')}")
    lines.append(trip.url)
    return "\n".join(lines)


def evaluate(trip: Trip, state: TripState, moment: datetime | None = None) -> list[Event]:
    """Что нужно сообщить по этому состоянию. Ничего не меняет — удобно тестировать."""
    moment = moment or now_utc()

    if state.status == FINISHED:
        if trip.done:
            return []
        return [
            Event(
                kind=EVENT_FINISHED,
                title=f"{trip.title}: заказ завершён",
                body=_details(trip, state),
                trip=trip,
                state=state,
            )
        ]

    if state.status == ARRIVED:
        if trip.arrived_notified:
            return []
        return [
            Event(
                kind=EVENT_ARRIVED,
                title=f"{trip.title}: курьер на месте",
                body=_details(trip, state),
                trip=trip,
                state=state,
            )
        ]

    left = state.minutes_left(moment)
    if left is None:
        return []

    # Из всех несработавших порогов берём самый близкий к текущему остатку:
    # если подключиться, когда осталось 3 минуты, не нужно сыпать «за 15» и «за 5».
    matched = [alert for alert in trip.pending_alerts() if left <= alert]
    if not matched:
        return []

    return [
        Event(
            kind=EVENT_ALERT,
            title=f"{trip.title}: курьер через {humanize(left)}",
            body=_details(trip, state),
            trip=trip,
            state=state,
            alert_minutes=min(matched),
        )
    ]


def apply_events(trip: Trip, events: list[Event], state: TripState) -> None:
    """Отмечает в поездке, о чём уже сообщили."""
    for event in events:
        if event.kind == EVENT_ALERT and event.alert_minutes is not None:
            for alert in trip.alerts:
                if alert >= event.alert_minutes and alert not in trip.fired:
                    trip.fired.append(alert)
        elif event.kind == EVENT_ARRIVED:
            trip.arrived_notified = True
        elif event.kind == EVENT_FINISHED:
            trip.done = True
    trip.last_summary = state.summary
    trip.scheduled_arrival = state.arrival_at


def next_delay(trip: Trip, state: TripState, moment: datetime | None = None) -> float:
    """Через сколько секунд имеет смысл опросить эту поездку снова."""
    left = state.minutes_left(moment or now_utc())
    if left is None:
        return max(state.poll_after, IDLE_POLL_SECONDS)

    # Ближайший порог, который ещё впереди: до него и считаем запас.
    upcoming = [alert for alert in trip.pending_alerts() if alert < left]
    if not upcoming:
        return state.poll_after
    if left - max(upcoming) <= NEAR_THRESHOLD_MINUTES:
        return NEAR_POLL_SECONDS
    return state.poll_after


class Watcher:
    """Крутит опрос по всем активным поездкам."""

    def __init__(
        self,
        store: TripStore,
        notifiers: list[Notifier],
        provider=None,
        sleep=time.sleep,
        log=None,
    ) -> None:
        self.store = store
        self.notifiers = notifiers
        self.provider = provider or YandexDeliveryProvider()
        self.sleep = sleep
        self.log = log or (lambda message: print(message, file=sys.stderr))

    def tick(self) -> float:
        """Один проход по всем поездкам. Возвращает паузу до следующего прохода."""
        trips = self.store.active()
        if not trips:
            return IDLE_POLL_SECONDS

        delays = []
        for trip in trips:
            try:
                state = self.provider.fetch(trip.key)
            except TrackerError as exc:
                self.log(f"{trip.title}: {exc}")
                delays.append(IDLE_POLL_SECONDS)
                continue

            for notifier in self.notifiers:
                notifier.sync(trip, state)

            events = evaluate(trip, state)
            for event in events:
                for notifier in self.notifiers:
                    notifier.push(event)

            apply_events(trip, events, state)
            if trip.done:
                for notifier in self.notifiers:
                    notifier.cancel(trip)

            self.store.update(trip)
            delays.append(next_delay(trip, state))

        return min(delays) if delays else IDLE_POLL_SECONDS

    def run(self, iterations: int | None = None) -> None:
        """Бесконечный (или ограниченный) цикл опроса."""
        done = 0
        while iterations is None or done < iterations:
            delay = self.tick()
            done += 1
            if iterations is not None and done >= iterations:
                break
            if not self.store.active():
                break
            self.sleep(delay)
