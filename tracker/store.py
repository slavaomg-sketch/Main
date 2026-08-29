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

    def load(self) -> list[Trip]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        trips: list[Trip] = []
        for item in raw.get("trips", []):
            try:
                trips.append(Trip.from_dict(item))
            except (KeyError, TypeError, ValueError):
                continue
        return trips

    def save(self, trips: list[Trip]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {"trips": [trip.to_dict() for trip in trips]}, ensure_ascii=False, indent=2
        )
        # Пишем через временный файл, чтобы не потерять список при обрыве.
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.path.parent, delete=False
        ) as tmp:
            tmp.write(payload + "\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(self.path)

    def add(self, trip: Trip) -> Trip:
        """Добавляет поездку; если такая ссылка уже отслеживается — обновляет настройки."""
        trips = self.load()
        for index, existing in enumerate(trips):
            if existing.key == trip.key:
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

    def active(self) -> list[Trip]:
        return [trip for trip in self.load() if not trip.done]

    def prune(self) -> int:
        """Убирает завершённые поездки. Возвращает, сколько удалено."""
        trips = self.load()
        alive = [trip for trip in trips if not trip.done]
        if len(alive) != len(trips):
            self.save(alive)
        return len(trips) - len(alive)
