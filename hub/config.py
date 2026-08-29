"""Настройки хаба: токен, доступ, часовой пояс. Настройки веток — у самих веток."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from .state import DEFAULT_PATH

load_dotenv()


def int_list(raw: str) -> list[int]:
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


def _env(*names: str, default: str = "") -> str:
    """Первое непустое значение из перечисленных переменных."""
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


@dataclass(frozen=True)
class HubConfig:
    token: str
    state_path: Path = DEFAULT_PATH
    allowed_ids: list[int] = field(default_factory=list)
    tz: str = "Europe/Moscow"

    def is_allowed(self, user_id: int) -> bool:
        """Пустой список — бот открыт всем; иначе только своим."""
        return not self.allowed_ids or user_id in self.allowed_ids

    @classmethod
    def from_env(cls) -> "HubConfig":
        token = _env("HUB_BOT_TOKEN", "TRACKER_BOT_TOKEN")
        if not token:
            raise RuntimeError(
                "Не задан HUB_BOT_TOKEN. Создайте отдельного бота у @BotFather "
                "и впишите его токен в .env.\n"
                "Токен бота напоминаний (BOT_TOKEN) сюда не подходит: один токен — "
                "один запущенный бот, иначе Telegram будет рвать соединение."
            )
        if token == os.getenv("BOT_TOKEN", "").strip():
            raise RuntimeError(
                "HUB_BOT_TOKEN совпадает с BOT_TOKEN. Нужен отдельный бот от @BotFather: "
                "два процесса с одним токеном будут мешать друг другу."
            )

        try:
            allowed = int_list(_env("HUB_ALLOWED_IDS", "TRACKER_ALLOWED_IDS"))
        except ValueError as error:
            raise RuntimeError(f"Ошибка в настройках бота: {error}") from None

        return cls(
            token=token,
            state_path=Path(_env("HUB_STATE", default=str(DEFAULT_PATH))),
            allowed_ids=allowed,
            # Время показываем в вашем поясе, а не в поясе сервера.
            tz=_env("HUB_TZ", "TRACKER_TZ", "DEFAULT_TZ", default="Europe/Moscow"),
        )
