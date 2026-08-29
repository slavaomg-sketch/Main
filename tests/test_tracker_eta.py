"""Разбор ETA из текста, который отдаёт Яндекс."""

from __future__ import annotations

import pytest

from tracker.eta import humanize, looks_arrived, looks_finished, parse_eta_minutes


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Курьер едет к получателю:  ~33 мин", 33),
        ("Курьер едет к получателю: ~18 мин", 18),
        ("~1 ч 5 мин", 65),
        ("≈2 ч", 120),
        ("осталось 7 минут", 7),
        ("10–15 мин", 10),  # из диапазона берём раннюю границу
        ("10-15 мин", 10),
        ("Courier is on the way: ~12 min", 12),
        ("1 h 30 min", 90),
        ("меньше минуты", 0),
        ("Курьер на месте", None),
        ("", None),
        ("Заказ доставлен", None),
    ],
)
def test_parse_eta_minutes(text, expected):
    assert parse_eta_minutes(text) == expected


def test_nbsp_and_tilde_do_not_break_parsing():
    assert parse_eta_minutes("Курьер едет: ~ 8 мин") == 8


def test_vehicle_number_is_not_parsed_as_eta():
    # Номер машины С479СО797 встречается в описании, но не в summary — на всякий случай.
    assert parse_eta_minutes("белый LADA (ВАЗ) Granta") is None


def test_status_markers():
    assert looks_arrived("Курьер на месте")
    assert looks_arrived("Курьер ожидает вас")
    assert not looks_arrived("Курьер едет к получателю: ~5 мин")

    assert looks_finished("Заказ доставлен")
    assert looks_finished("Заказ отменён")
    assert not looks_finished("Курьер едет к получателю")


@pytest.mark.parametrize(
    "minutes, expected",
    [
        (None, "время неизвестно"),
        (0, "меньше минуты"),
        (-3, "меньше минуты"),
        (5, "5 мин"),
        (60, "1 ч"),
        (85, "1 ч 25 мин"),
    ],
)
def test_humanize(minutes, expected):
    assert humanize(minutes) == expected
