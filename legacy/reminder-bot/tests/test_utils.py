"""Проверки разбора времени, дней недели и форматирования."""

import pytest

from bot.utils import (
    days_to_str,
    format_days,
    format_minutes,
    parse_days,
    parse_time,
    percent,
    valid_tz,
)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("9:30", "09:30"),
        ("09:30", "09:30"),
        ("9.30", "09:30"),
        (" 0930 ", "09:30"),
        ("23:59", "23:59"),
        ("00:00", "00:00"),
    ],
)
def test_parse_time_accepts_common_formats(raw, expected):
    assert parse_time(raw) == expected


@pytest.mark.parametrize("raw", ["24:00", "12:60", "abc", "", "1:2", None, "99:99"])
def test_parse_time_rejects_garbage(raw):
    assert parse_time(raw) is None


def test_parse_days_filters_invalid_values():
    assert parse_days("1,2,9,x,5") == [1, 2, 5]


def test_parse_days_defaults_to_every_day():
    assert parse_days("") == [1, 2, 3, 4, 5, 6, 7]
    assert parse_days(None) == [1, 2, 3, 4, 5, 6, 7]


def test_days_round_trip():
    assert parse_days(days_to_str([5, 1, 1, 3])) == [1, 3, 5]


def test_format_days_uses_friendly_names():
    assert format_days("1,2,3,4,5") == "будни"
    assert format_days("1,2,3,4,5,6,7") == "ежедневно"
    assert format_days("6,7") == "выходные"
    assert format_days("1,3") == "пн, ср"


def test_format_minutes():
    assert format_minutes(None) == "—"
    assert format_minutes(7.4) == "7 мин"
    assert format_minutes(90) == "1 ч 30 мин"
    assert format_minutes(120) == "2 ч"


def test_percent_handles_zero_total():
    assert percent(0, 0) == 0
    assert percent(3, 4) == 75


def test_valid_tz():
    assert valid_tz("Europe/Moscow")
    assert not valid_tz("Mars/Olympus")
