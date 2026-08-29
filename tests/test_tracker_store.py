"""Хранилище поездок и мелочи моделей."""

from __future__ import annotations

import pytest

from tracker.models import ARRIVED, FINISHED, IN_PROGRESS, Trip, TripState, now_utc
from tracker.store import TripStore

KEY = "e90be707-1875-4406-b66a-4a6fc1e6955e"
URL = f"https://dostavka.yandex.ru/route/{KEY}"


def trip(**overrides) -> Trip:
    data = {"key": KEY, "url": URL, "label": "Доставка", "alerts": [15, 5]}
    data.update(overrides)
    return Trip(**data)


@pytest.fixture
def store(tmp_path) -> TripStore:
    return TripStore(tmp_path / "trips.json")


def test_trip_survives_json_round_trip(store):
    original = trip(alerts=[30, 10], notifiers=["ics", "telegram"])
    original.external["ics:path"] = "data/ics/x.ics"
    original.fired.append(30)
    store.add(original)

    restored = store.load()[0]

    assert restored.id == original.id
    assert restored.alerts == [30, 10]
    assert restored.notifiers == ["ics", "telegram"]
    assert restored.fired == [30]
    assert restored.external == {"ics:path": "data/ics/x.ics"}


def test_adding_same_link_twice_updates_settings(store):
    store.add(trip(alerts=[5]))
    store.add(trip(alerts=[20, 5], label="Продукты"))

    trips = store.load()
    assert len(trips) == 1
    assert trips[0].alerts == [20, 5]
    assert trips[0].label == "Продукты"


def test_remove_by_url_and_by_id(store):
    store.add(trip())
    assert store.remove(URL) is not None
    assert store.load() == []

    added = store.add(trip())
    assert store.remove(added.id) is not None
    assert store.load() == []


def test_remove_unknown_returns_none(store):
    assert store.remove("нет такого") is None


def test_prune_drops_only_finished(store):
    alive = store.add(trip())
    done = trip(label="Старая")
    done.key = "11111111-1111-1111-1111-111111111111"
    done.done = True
    store.add(done)

    assert store.prune() == 1
    assert [t.id for t in store.load()] == [alive.id]


def test_store_survives_broken_file(tmp_path):
    path = tmp_path / "trips.json"
    path.write_text("{ это не json", encoding="utf-8")
    assert TripStore(path).load() == []


def test_store_skips_broken_records(tmp_path):
    path = tmp_path / "trips.json"
    path.write_text('{"trips": [{"url": "без ключа"}, ' '{"key": "k", "url": "u"}]}', encoding="utf-8")
    trips = TripStore(path).load()
    assert [t.key for t in trips] == ["k"]


def test_pending_alerts_are_sorted_from_far_to_near():
    current = trip(alerts=[5, 30, 15])
    assert current.pending_alerts() == [30, 15, 5]
    current.fired.append(30)
    assert current.pending_alerts() == [15, 5]


def test_trip_title_falls_back_to_default():
    assert trip(label="").title == "Доставка"
    assert trip(label="Суши").title == "Суши"


def test_state_headline_without_summary():
    assert TripState(key=KEY, status=ARRIVED).headline() == "Курьер на месте"
    assert TripState(key=KEY, status=FINISHED).headline() == "Заказ завершён"


def test_arrival_time_is_none_without_eta():
    state = TripState(key=KEY, status=IN_PROGRESS)
    assert state.arrival_at is None
    assert state.minutes_left(now_utc()) is None
