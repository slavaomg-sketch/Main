"""Конфигурация бота: читается из переменных окружения / файла .env."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _int_list(raw: str) -> list[int]:
    result: list[int] = []
    for chunk in raw.replace(";", ",").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            result.append(int(chunk))
        except ValueError:
            raise ValueError(f"ADMIN_IDS: '{chunk}' не является числовым Telegram ID")
    return result


@dataclass(frozen=True)
class Config:
    bot_token: str
    admin_ids: list[int] = field(default_factory=list)
    db_path: Path = Path("data/bot.db")
    default_tz: str = "Europe/Moscow"
    report_time: str = "20:00"
    nudge_after_minutes: int = 60
    catchup_minutes: int = 15

    @classmethod
    def from_env(cls) -> "Config":
        token = os.getenv("BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "Не задан BOT_TOKEN. Скопируйте .env.example в .env и впишите токен от @BotFather."
            )

        admin_ids = _int_list(os.getenv("ADMIN_IDS", ""))
        if not admin_ids:
            raise RuntimeError(
                "Не задан ADMIN_IDS. Укажите хотя бы один Telegram ID администратора "
                "(свой ID можно узнать у @userinfobot)."
            )

        return cls(
            bot_token=token,
            admin_ids=admin_ids,
            db_path=Path(os.getenv("DB_PATH", "data/bot.db")),
            default_tz=os.getenv("DEFAULT_TZ", "Europe/Moscow").strip() or "Europe/Moscow",
            report_time=os.getenv("REPORT_TIME", "20:00").strip() or "20:00",
            nudge_after_minutes=int(os.getenv("NUDGE_AFTER_MINUTES", "60")),
            catchup_minutes=int(os.getenv("CATCHUP_MINUTES", "15")),
        )
