"""Хранилище отслеживаемых поездок — обычный JSON-файл рядом с программой."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .models import Trip

DEFAULT_PATH = Path(os.getenv("TRACKER_STATE", "data/trips.json"))


class TripStore:
    """Список поездок на диске. Никакой базы не нужно — их единицы."""

    def __init__(self, path: Path | str = DEFAULT_PATH) -> None:
        self.path = Path(path)

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def load(self) -> list[Trip]:
        trips: list[Trip] = []
        for item in self._read().get("trips", []):
            try:
                trips.append(Trip.from_dict(item))
            except (KeyError, TypeError, ValueError):
                continue
        return trips

    def save(self, trips: list[Trip], chats: dict | None = None) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = self._read()
        data["trips"] = [trip.to_dict() for trip in trips]
        if chats is not None:
            data["chats"] = chats
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        # Пишем через временный файл, чтобы не потерять список при обрыве.
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.path.parent, delete=False
        ) as tmp:
            tmp.write(payload + "\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(self.path)

    def add(self, trip: Trip) -> Trip:
        """Добавляет поездку.

        Если ту же ссылку уже отслеживает тот же адресат — обновляет её настройки,
        а не заводит вторую. Разные чаты могут следить за одной ссылкой независимо.
        """
        trips = self.load()
        for index, existing in enumerate(trips):
            if existing.key == trip.key and existing.chat_id == trip.chat_id:
                trip.id = existing.id
                trips[index] = trip
                break
        else:
            trips.append(trip)
        self.save(trips)
        return trip

    def update(self, trip: Trip) -> None:
        trips = self.load()
        for index, existing in enumerate(trips):
            if existing.id == trip.id:
                trips[index] = trip
                self.save(trips)
                return
        trips.append(trip)
        self.save(trips)

    def remove(self, needle: str) -> Trip | None:
        """Удаляет поездку по id, ключу или ссылке."""
        trips = self.load()
        for index, trip in enumerate(trips):
            if needle in (trip.id, trip.key, trip.url):
                removed = trips.pop(index)
                self.save(trips)
                return removed
        return None

    def active(self, chat_id: int | None = None) -> list[Trip]:
        trips = [trip for trip in self.load() if not trip.done]
        if chat_id is None:
            return trips
        return [trip for trip in trips if trip.chat_id == chat_id]

    def find(self, trip_id: str) -> Trip | None:
        for trip in self.load():
            if trip.id == trip_id:
                return trip
        return None

    def chat_alerts(self, chat_id: int) -> list[int] | None:
        """Интервалы, которые чат выбирал в прошлый раз. None — ещё не выбирал."""
        saved = (self._read().get("chats") or {}).get(str(chat_id)) or {}
        alerts = saved.get("alerts")
        if not alerts:
            return None
        return sorted({int(alert) for alert in alerts}, reverse=True)

    def remember_chat_alerts(self, chat_id: int, alerts: list[int]) -> None:
        data = self._read()
        chats = data.get("chats") or {}
        chats[str(chat_id)] = {"alerts": sorted({int(a) for a in alerts}, reverse=True)}
        self.save(self.load(), chats=chats)

    def prune(self) -> int:
        """Убирает завершённые поездки. Возвращает, сколько удалено."""
        trips = self.load()
        alive = [trip for trip in trips if not trip.done]
        if len(alive) != len(trips):
            self.save(alive)
        return len(trips) - len(alive)
