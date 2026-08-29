"""Логика напоминаний: когда сработать, когда промолчать."""

from __future__ import annotations

from datetime import timedelta

import pytest

from tracker.models import (
    ARRIVED,
    EVENT_ALERT,
    EVENT_ARRIVED,
    EVENT_FINISHED,
    FINISHED,
    IN_PROGRESS,
    Trip,
    TripState,
)
from tracker.notifiers.base import Notifier
from tracker.providers import TrackerError
from tracker.store import TripStore
from tracker.watcher import NEAR_POLL_SECONDS, Watcher, apply_events, evaluate, next_delay

KEY = "e90be707-1875-4406-b66a-4a6fc1e6955e"
URL = f"https://dostavka.yandex.ru/route/{KEY}"


def trip(**overrides) -> Trip:
    data = {"key": KEY, "url": URL, "label": "Доставка", "alerts": [15, 5]}
    data.update(overrides)
    return Trip(**data)


def state(minutes: float | None, status: str = IN_PROGRESS) -> TripState:
    return TripState(
        key=KEY,
        status=status,
        summary=f"Курьер едет к получателю: ~{minutes} мин" if minutes else "Курьер на месте",
        eta_minutes=minutes,
        destination="Сколковская улица, 7Б",
        performer="Мария",
    )


class RecordingNotifier(Notifier):
    name = "recording"

    def __init__(self) -> None:
        self.pushed = []
        self.synced = []
        self.cancelled = []

    def push(self, event):
        self.pushed.append(event)

    def sync(self, trip_, state_):
        self.synced.append((trip_, state_))

    def cancel(self, trip_):
        self.cancelled.append(trip_)


class FakeProvider:
    def __init__(self, states) -> None:
        self.states = list(states)
        self.calls = 0

    def fetch(self, key):
        self.calls += 1
        item = self.states[min(self.calls - 1, len(self.states) - 1)]
        if isinstance(item, Exception):
            raise item
        return item


def test_no_alert_while_far_away():
    assert evaluate(trip(), state(33)) == []


def test_alert_fires_on_threshold():
    events = evaluate(trip(), state(14))
    assert [event.kind for event in events] == [EVENT_ALERT]
    assert events[0].alert_minutes == 15
    assert "через" in events[0].title


def test_only_the_closest_threshold_fires_at_once():
    """Подключились, когда осталось 3 минуты, — одно сообщение, а не «за 15» и «за 5»."""
    events = evaluate(trip(), state(3))
    assert len(events) == 1
    assert events[0].alert_minutes == 5


def test_alerts_do_not_repeat_but_next_one_still_fires():
    current = trip()
    first = evaluate(current, state(14))
    apply_events(current, first, state(14))

    assert evaluate(current, state(12)) == []  # порог 15 уже отработал

    second = evaluate(current, state(4))
    assert [event.alert_minutes for event in second] == [5]
    apply_events(current, second, state(4))
    assert sorted(current.fired) == [5, 15]
    assert evaluate(current, state(2)) == []


def test_applying_close_alert_marks_larger_thresholds_as_done():
    current = trip()
    events = evaluate(current, state(3))
    apply_events(current, events, state(3))
    assert sorted(current.fired) == [5, 15]


def test_arrival_and_finish_are_announced_once():
    current = trip()
    arrived = state(None, ARRIVED)
    events = evaluate(current, arrived)
    assert [event.kind for event in events] == [EVENT_ARRIVED]
    apply_events(current, events, arrived)
    assert evaluate(current, arrived) == []

    finished = state(None, FINISHED)
    events = evaluate(current, finished)
    assert [event.kind for event in events] == [EVENT_FINISHED]
    apply_events(current, events, finished)
    assert current.done is True
    assert evaluate(current, finished) == []


def test_no_eta_no_alerts():
    assert evaluate(trip(), state(None, IN_PROGRESS)) == []


def test_alert_body_has_address_and_link():
    events = evaluate(trip(), state(4))
    assert "Сколковская улица, 7Б" in events[0].body
    assert URL in events[0].body


def test_zero_alert_means_notify_on_arrival_only():
    current = trip(alerts=[0])
    assert evaluate(current, state(3)) == []
    events = evaluate(current, state(0))
    assert [event.alert_minutes for event in events] == [0]


def test_next_delay_shrinks_near_threshold():
    assert next_delay(trip(), state(30)) == 30.0
    assert next_delay(trip(), state(16)) == NEAR_POLL_SECONDS


def test_minutes_left_counts_down_after_fetch():
    snapshot = state(10)
    later = snapshot.fetched_at + timedelta(minutes=4)
    assert snapshot.minutes_left(later) == pytest.approx(6, abs=0.01)


@pytest.fixture
def store(tmp_path) -> TripStore:
    return TripStore(tmp_path / "trips.json")


def test_watcher_notifies_and_persists(store):
    store.add(trip())
    notifier = RecordingNotifier()
    watcher = Watcher(store, [notifier], provider=FakeProvider([state(4)]), sleep=lambda _: None)

    watcher.tick()

    assert [event.kind for event in notifier.pushed] == [EVENT_ALERT]
    assert notifier.synced, "sync должен вызываться на каждом опросе"
    saved = store.load()[0]
    assert sorted(saved.fired) == [5, 15]
    assert saved.scheduled_arrival is not None


def test_watcher_cancels_scheduled_reminders_when_trip_ends(store):
    store.add(trip())
    notifier = RecordingNotifier()
    watcher = Watcher(
        store, [notifier], provider=FakeProvider([state(None, FINISHED)]), sleep=lambda _: None
    )

    watcher.tick()

    assert notifier.cancelled
    assert store.load()[0].done is True
    assert store.active() == []


def test_watcher_survives_network_errors(store):
    store.add(trip())
    messages = []
    watcher = Watcher(
        store,
        [RecordingNotifier()],
        provider=FakeProvider([TrackerError("нет связи")]),
        sleep=lambda _: None,
        log=messages.append,
    )

    delay = watcher.tick()

    assert delay > 0
    assert messages and "нет связи" in messages[0]
    assert store.active(), "поездка не должна теряться из-за сетевого сбоя"


def test_watcher_stops_when_everything_is_delivered(store):
    store.add(trip())
    sleeps = []
    watcher = Watcher(
        store,
        [RecordingNotifier()],
        provider=FakeProvider([state(4), state(None, FINISHED)]),
        sleep=sleeps.append,
    )

    watcher.run()

    assert store.active() == []
    assert len(sleeps) == 1  # после завершения второго прохода цикл не спит


def test_watcher_does_not_repeat_alert_across_ticks(store):
    store.add(trip())
    notifier = RecordingNotifier()
    watcher = Watcher(
        store,
        [notifier],
        provider=FakeProvider([state(4), state(3), state(2)]),
        sleep=lambda _: None,
    )

    watcher.run(iterations=3)

    assert len([e for e in notifier.pushed if e.kind == EVENT_ALERT]) == 1


