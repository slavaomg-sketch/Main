"""Настройки ветки «Доставка». Токен и доступ — не её забота, это дело хаба."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from tracker.store import DEFAULT_PATH

# Кнопки быстрого выбора интервала под карточкой поездки.
ALERT_PRESETS = [3, 5, 10, 15, 30]
MAX_ALERT_MINUTES = 24 * 60


def _int_list(raw: str) -> list[int]:
    result: list[int] = []
    for chunk in (raw or "").replace(";", ",").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            result.append(int(chunk))
        except ValueError:
            raise ValueError(f"'{chunk}' не является числом")
    return result


@dataclass(frozen=True)
class TaxiConfig:
    trips_path: Path = DEFAULT_PATH
    default_alerts: list[int] = field(default_factory=lambda: [5])
    poll_seconds: float = 10.0
    tz: str = "Europe/Moscow"

    @classmethod
    def from_env(cls, tz: str = "Europe/Moscow") -> "TaxiConfig":
        try:
            alerts = _int_list(os.getenv("TRACKER_ALERTS", "5")) or [5]
        except ValueError as error:
            raise RuntimeError(f"Ошибка в настройках трекера: {error}") from None

        bad = [alert for alert in alerts if not 0 <= alert <= MAX_ALERT_MINUTES]
        if bad:
            raise RuntimeError(
                f"TRACKER_ALERTS: интервал должен быть от 0 до 1440 минут, а не {bad[0]}"
            )

        return cls(
            trips_path=Path(os.getenv("TRACKER_STATE", str(DEFAULT_PATH))),
            default_alerts=sorted(set(alerts), reverse=True),
            poll_seconds=max(5.0, float(os.getenv("TRACKER_POLL_SECONDS", "10"))),
            tz=tz,
        )
