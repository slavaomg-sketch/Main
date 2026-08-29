"""Файл .ics с будильниками — универсальный способ попасть в любой календарь.

Полезно, если трекер крутится не на Маке: файл можно открыть на iPhone
(из почты, Телеграма или облака) — событие с сигналами добавится в Календарь.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..models import Trip, TripState, now_utc
from .base import Notifier

DEFAULT_DIR = Path(os.getenv("TRACKER_ICS_DIR", "data/ics"))
EVENT_LENGTH_MINUTES = 15


def _stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _escape(text: str) -> str:
    return (
        (text or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> list[str]:
    """Складывает длинные строки по 75 октетов, как требует RFC 5545."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return [line]
    chunks: list[str] = []
    current = b""
    for char in line:
        encoded = char.encode("utf-8")
        limit = 75 if not chunks else 74  # у продолжений первый символ — пробел
        if len(current) + len(encoded) > limit:
            chunks.append(current.decode("utf-8"))
            current = b""
        current += encoded
    if current:
        chunks.append(current.decode("utf-8"))
    return [chunks[0]] + [" " + chunk for chunk in chunks[1:]]


def build_ics(
    *,
    uid: str,
    title: str,
    description: str,
    url: str,
    arrival: datetime,
    alerts: list[int],
    created: datetime | None = None,
    length_minutes: int = EVENT_LENGTH_MINUTES,
) -> str:
    """Собирает календарное событие «прибытие курьера» с будильниками."""
    created = created or now_utc()
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//taxi-tracker//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_stamp(created)}",
        f"DTSTART:{_stamp(arrival)}",
        f"DTEND:{_stamp(arrival + timedelta(minutes=length_minutes))}",
        f"SUMMARY:{_escape(title)}",
        f"DESCRIPTION:{_escape(description)}",
        f"URL:{_escape(url)}",
        "TRANSP:TRANSPARENT",
    ]
    for alert in sorted({int(a) for a in alerts}, reverse=True):
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"TRIGGER:-PT{max(0, int(alert))}M",
            f"DESCRIPTION:{_escape(title)}",
            "END:VALARM",
        ]
    lines += ["END:VEVENT", "END:VCALENDAR"]

    folded: list[str] = []
    for line in lines:
        folded.extend(_fold(line))
    return "\r\n".join(folded) + "\r\n"


def describe(trip: Trip, state: TripState) -> str:
    parts = []
    if state.summary:
        parts.append(state.summary)
    if state.destination:
        parts.append(f"Адрес: {state.destination}")
    if state.performer or state.vehicle:
        parts.append(
            "Курьер: " + " · ".join(part for part in (state.performer, state.vehicle) if part)
        )
    parts.append(trip.url)
    return "\n".join(parts)


class IcsNotifier(Notifier):
    """На каждом опросе перезаписывает .ics с актуальным временем прибытия."""

    name = "ics"

    def __init__(self, directory: Path | str = DEFAULT_DIR) -> None:
        self.directory = Path(directory)

    def path_for(self, trip: Trip) -> Path:
        return self.directory / f"{trip.id}.ics"

    def sync(self, trip: Trip, state: TripState) -> None:
        arrival = state.arrival_at
        if arrival is None or not state.active:
            return
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.path_for(trip)
        path.write_text(
            build_ics(
                uid=f"{trip.id}@taxi-tracker",
                title=f"{trip.title}: прибытие курьера",
                description=describe(trip, state),
                url=trip.url,
                arrival=arrival,
                alerts=trip.alerts,
                created=trip.created_at,
            ),
            encoding="utf-8",
        )
        trip.external["ics:path"] = str(path)

    def cancel(self, trip: Trip) -> None:
        trip.external.pop("ics:path", None)
