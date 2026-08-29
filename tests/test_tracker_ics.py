"""Календарный файл с будильниками."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tracker.models import IN_PROGRESS, Trip, TripState
from tracker.notifiers.icsfile import IcsNotifier, build_ics

ARRIVAL = datetime(2026, 8, 29, 9, 38, tzinfo=timezone.utc)
KEY = "e90be707-1875-4406-b66a-4a6fc1e6955e"
URL = f"https://dostavka.yandex.ru/route/{KEY}"


def sample(**overrides) -> str:
    params = {
        "uid": "abc123@taxi-tracker",
        "title": "Доставка: прибытие курьера",
        "description": "Адрес: Сколковская улица, 7Б",
        "url": URL,
        "arrival": ARRIVAL,
        "alerts": [15, 5],
        "created": ARRIVAL - timedelta(minutes=33),
    }
    params.update(overrides)
    return build_ics(**params)


def test_event_times_and_alarms():
    text = sample()

    assert "BEGIN:VCALENDAR" in text and text.rstrip().endswith("END:VCALENDAR")
    assert "DTSTART:20260829T093800Z" in text
    assert "DTEND:20260829T095300Z" in text
    assert text.count("BEGIN:VALARM") == 2
    assert "TRIGGER:-PT15M" in text
    assert "TRIGGER:-PT5M" in text


def test_duplicate_alerts_collapse():
    text = sample(alerts=[5, 5, 5])
    assert text.count("BEGIN:VALARM") == 1


def test_special_characters_are_escaped():
    text = sample(description="Адрес: Сколковская, 7Б; подъезд 3\nвторой этаж")
    assert "\\;" in text and "\\," in text and "\\n" in text


def test_long_lines_are_folded_to_75_octets():
    text = sample(description="очень длинный адрес " * 20)
    for line in text.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75


def test_crlf_line_endings():
    text = sample()
    assert "\r\n" in text
    assert "\n" not in text.replace("\r\n", ""), "одиночных \\n в .ics быть не должно"


def test_notifier_writes_file_and_rewrites_it(tmp_path):
    notifier = IcsNotifier(tmp_path)
    trip = Trip(key=KEY, url=URL, label="Продукты", alerts=[10])
    state = TripState(key=KEY, status=IN_PROGRESS, summary="~20 мин", eta_minutes=20)

    notifier.sync(trip, state)

    path = tmp_path / f"{trip.id}.ics"
    assert path.exists()
    assert "Продукты" in path.read_text(encoding="utf-8")
    assert trip.external["ics:path"] == str(path)

    later = TripState(key=KEY, status=IN_PROGRESS, summary="~5 мин", eta_minutes=5)
    notifier.sync(trip, later)
    assert path.read_text(encoding="utf-8").count("BEGIN:VEVENT") == 1


def test_notifier_skips_when_eta_unknown(tmp_path):
    notifier = IcsNotifier(tmp_path)
    trip = Trip(key=KEY, url=URL)
    notifier.sync(trip, TripState(key=KEY, status=IN_PROGRESS))
    assert list(tmp_path.glob("*.ics")) == []
