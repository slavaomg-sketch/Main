"""Разбор ответа API Яндекс Доставки."""

from __future__ import annotations

import pytest

from tracker.models import ARRIVED, FINISHED, IN_PROGRESS, UNKNOWN
from tracker.providers import (
    TrackerError,
    normalize_url,
    parse_key,
    state_from_payload,
)

KEY = "e90be707-1875-4406-b66a-4a6fc1e6955e"


def payload(**overrides) -> dict:
    """Скелет ответа /shared-route/info — поля те же, что у настоящего API."""
    base = {
        "context": {"provider_status": "pickuped", "is_performer_position_available": True},
        "summary": "Курьер едет к получателю:  ~33 мин",
        "description": "белый LADA (ВАЗ) Granta • нужно выйти к машине курьера",
        "route_points": [
            {
                "type": "source",
                "visit_status": "visited",
                "short_text": "улица Октября, 78",
            },
            {
                "type": "destination",
                "visit_status": "pending",
                "short_text": "Сколковская улица, 7Б, подъезд 3",
            },
        ],
        "performer": {
            "name": "Иванова Мария Петровна",
            "short_name": "Мария",
            "vehicle_model": "LADA (ВАЗ) Granta",
            "vehicle_number": "А123ВС777",
        },
    }
    base.update(overrides)
    return base


@pytest.mark.parametrize(
    "value",
    [
        f"https://dostavka.yandex.ru/route/{KEY}",
        f"https://dostavka.yandex.ru/route/#{KEY}",
        f"  https://dostavka.yandex.ru/route/{KEY}?utm=telegram  ",
        KEY,
        KEY.upper(),
    ],
)
def test_parse_key(value):
    assert parse_key(value) == KEY


def test_parse_key_rejects_garbage():
    with pytest.raises(TrackerError):
        parse_key("https://dostavka.yandex.ru/route/")


def test_normalize_url_builds_link_from_bare_key():
    assert normalize_url(KEY) == f"https://dostavka.yandex.ru/route/{KEY}"


def test_state_in_progress():
    state = state_from_payload(KEY, payload(), {"x-refresh-after": "10000"})

    assert state.status == IN_PROGRESS
    assert state.eta_minutes == 33
    assert state.performer == "Мария"
    assert state.vehicle == "LADA (ВАЗ) Granta А123ВС777"
    assert state.destination == "Сколковская улица, 7Б, подъезд 3"
    assert state.poll_after == 10.0
    assert state.active


def test_arrival_time_follows_eta():
    state = state_from_payload(KEY, payload())
    delta = state.arrival_at - state.fetched_at
    assert 32.9 < delta.total_seconds() / 60 < 33.1


def test_state_arrived_by_provider_status():
    state = state_from_payload(
        KEY,
        payload(
            context={"provider_status": "delivery_arrived"},
            summary="Курьер ждёт вас у подъезда",
        ),
    )
    assert state.status == ARRIVED
    assert state.eta_minutes == 0


def test_pickup_arrived_is_still_in_progress():
    state = state_from_payload(
        KEY,
        payload(context={"provider_status": "pickup_arrived"}, summary="Курьер забирает заказ"),
    )
    assert state.status == IN_PROGRESS


def test_state_finished_when_all_points_visited():
    points = [
        {"type": "source", "visit_status": "visited"},
        {"type": "destination", "visit_status": "visited"},
    ]
    state = state_from_payload(
        KEY, payload(route_points=points, summary="Заказ доставлен", context={})
    )
    assert state.status == FINISHED
    assert state.eta_minutes is None
    assert not state.active


def test_state_finished_when_cancelled():
    state = state_from_payload(
        KEY, payload(context={"provider_status": "cancelled_by_user"}, summary="Заказ отменён")
    )
    assert state.status == FINISHED


def test_unknown_payload_does_not_crash():
    state = state_from_payload(KEY, {})
    assert state.status == UNKNOWN
    assert state.eta_minutes is None
    assert state.headline() == "Доставка"


def test_poll_interval_has_floor():
    state = state_from_payload(KEY, payload(), {"x-refresh-after": "1000"})
    assert state.poll_after == 10.0
