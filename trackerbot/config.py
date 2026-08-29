"""Настройки бота-трекера: читаются из переменных окружения / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from tracker.store import DEFAULT_PATH

load_dotenv()

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
class BotConfig:
    token: str
    state_path: Path = DEFAULT_PATH
    default_alerts: list[int] = field(default_factory=lambda: [5])
    allowed_ids: list[int] = field(default_factory=list)
    poll_seconds: float = 10.0
    tz: str = "Europe/Moscow"

    def is_allowed(self, user_id: int) -> bool:
        """Пустой список — бот открыт всем; иначе только своим."""
        return not self.allowed_ids or user_id in self.allowed_ids

    @classmethod
    def from_env(cls) -> "BotConfig":
        token = os.getenv("TRACKER_BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "Не задан TRACKER_BOT_TOKEN. Создайте отдельного бота у @BotFather "
                "и впишите его токен в .env.\n"
                "Токен бота напоминаний (BOT_TOKEN) сюда не подходит: один токен — "
                "один запущенный бот, иначе Telegram будет рвать соединение."
            )
        if token == os.getenv("BOT_TOKEN", "").strip():
            raise RuntimeError(
                "TRACKER_BOT_TOKEN совпадает с BOT_TOKEN. Нужен отдельный бот от @BotFather: "
                "два процесса с одним токеном будут мешать друг другу."
            )

        try:
            alerts = _int_list(os.getenv("TRACKER_ALERTS", "5")) or [5]
            allowed = _int_list(os.getenv("TRACKER_ALLOWED_IDS", ""))
        except ValueError as error:
            raise RuntimeError(f"Ошибка в настройках трекера: {error}") from None

        bad = [alert for alert in alerts if not 0 <= alert <= MAX_ALERT_MINUTES]
        if bad:
            raise RuntimeError(f"TRACKER_ALERTS: интервал должен быть от 0 до 1440 минут, а не {bad[0]}")

        return cls(
            token=token,
            state_path=Path(os.getenv("TRACKER_STATE", str(DEFAULT_PATH))),
            default_alerts=sorted(set(alerts), reverse=True),
            allowed_ids=allowed,
            poll_seconds=max(5.0, float(os.getenv("TRACKER_POLL_SECONDS", "10"))),
            # Время прибытия показываем в вашем поясе, а не в поясе сервера.
            tz=(os.getenv("TRACKER_TZ") or os.getenv("DEFAULT_TZ") or "Europe/Moscow").strip(),
        )
