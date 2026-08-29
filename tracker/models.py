"""Модели трекера доставок: отслеживаемая поездка, её состояние и события."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone

# Стадии поездки.
IN_PROGRESS = "in_progress"  # курьер в пути
ARRIVED = "arrived"  # курьер на месте, ждёт получателя
FINISHED = "finished"  # доставлено / отменено — отслеживать больше нечего
UNKNOWN = "unknown"  # ссылка жива, но что происходит — непонятно

# Виды событий, которые трекер отдаёт в уведомления.
EVENT_ALERT = "alert"  # сработало напоминание "за N минут"
EVENT_ARRIVED = "arrived"  # курьер на месте
EVENT_FINISHED = "finished"  # заказ завершён
EVENT_INFO = "info"  # разовое сообщение (например, "взял в отслеживание")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class TripState:
    """Снимок состояния поездки на момент опроса."""

    key: str
    status: str = UNKNOWN
    summary: str = ""
    description: str = ""
    eta_minutes: float | None = None
    performer: str | None = None
    vehicle: str | None = None
    destination: str | None = None
    fetched_at: datetime = field(default_factory=now_utc)
    poll_after: float = 30.0

    @property
    def arrival_at(self) -> datetime | None:
        """Предполагаемое время прибытия. None, если ETA неизвестен."""
        if self.eta_minutes is None:
            return None
        return self.fetched_at + timedelta(minutes=self.eta_minutes)

    @property
    def active(self) -> bool:
        return self.status != FINISHED

    def minutes_left(self, moment: datetime | None = None) -> float | None:
        """Сколько минут осталось с учётом времени, прошедшего после опроса."""
        arrival = self.arrival_at
        if arrival is None:
            return None
        moment = moment or now_utc()
        return (arrival - moment).total_seconds() / 60

    def headline(self) -> str:
        """Короткая строка для заголовка уведомления."""
        return self.summary or {
            ARRIVED: "Курьер на месте",
            FINISHED: "Заказ завершён",
            IN_PROGRESS: "Курьер в пути",
        }.get(self.status, "Доставка")


@dataclass
class Trip:
    """Отслеживаемая поездка: ссылка и настройки напоминаний."""

    key: str
    url: str
    label: str = ""
    alerts: list[int] = field(default_factory=lambda: [5])
    notifiers: list[str] = field(default_factory=lambda: ["console"])
    # Кому в Telegram сообщать. None — поездка заведена из командной строки.
    chat_id: int | None = None
    created_at: datetime = field(default_factory=now_utc)
    fired: list[int] = field(default_factory=list)
    arrived_notified: bool = False
    done: bool = False
    scheduled_arrival: datetime | None = None
    last_summary: str = ""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    # Служебные пометки уведомлялок: id созданного напоминания, uid события и т.п.
    external: dict[str, str] = field(default_factory=dict)

    @property
    def title(self) -> str:
        return self.label or "Доставка"

    def pending_alerts(self) -> list[int]:
        """Ещё не сработавшие пороги, от большего к меньшему."""
        return sorted((a for a in self.alerts if a not in self.fired), reverse=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "key": self.key,
            "url": self.url,
            "label": self.label,
            "alerts": list(self.alerts),
            "notifiers": list(self.notifiers),
            "chat_id": self.chat_id,
            "created_at": self.created_at.isoformat(),
            "fired": list(self.fired),
            "arrived_notified": self.arrived_notified,
            "done": self.done,
            "scheduled_arrival": (
                self.scheduled_arrival.isoformat() if self.scheduled_arrival else None
            ),
            "last_summary": self.last_summary,
            "external": dict(self.external),
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "Trip":
        scheduled = raw.get("scheduled_arrival")
        return cls(
            key=raw["key"],
            url=raw["url"],
            label=raw.get("label", ""),
            alerts=[int(a) for a in raw.get("alerts", [5])],
            notifiers=list(raw.get("notifiers", ["console"])),
            chat_id=int(raw["chat_id"]) if raw.get("chat_id") is not None else None,
            created_at=_parse_dt(raw.get("created_at")) or now_utc(),
            fired=[int(a) for a in raw.get("fired", [])],
            arrived_notified=bool(raw.get("arrived_notified", False)),
            done=bool(raw.get("done", False)),
            scheduled_arrival=_parse_dt(scheduled),
            last_summary=raw.get("last_summary", ""),
            id=raw.get("id") or uuid.uuid4().hex[:12],
            external={str(k): str(v) for k, v in (raw.get("external") or {}).items()},
        )

    def copy(self, **changes) -> "Trip":
        return replace(self, **changes)


@dataclass(frozen=True)
class Event:
    """Что именно нужно сообщить пользователю."""

    kind: str
    title: str
    body: str
    trip: Trip
    state: TripState
    alert_minutes: int | None = None


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed
