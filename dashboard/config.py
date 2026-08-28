"""Настройки панели: читаются из окружения (.env), без обязательных значений.

Панель обязана запускаться «из коробки»: если ключей маркетплейсов нет,
соответствующие коннекторы работают в демонстрационном режиме и честно
сообщают об этом в интерфейсе.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on", "да"}


@dataclass(frozen=True)
class MarketplaceCredentials:
    """Ключи одного маркетплейса. Пустые поля означают демо-режим."""

    code: str
    title: str
    values: dict[str, str] = field(default_factory=dict)
    required: tuple[str, ...] = ()

    @property
    def configured(self) -> bool:
        return all(self.values.get(key) for key in self.required)

    def get(self, key: str, default: str = "") -> str:
        return self.values.get(key) or default


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    db_path: Path
    password: str
    session_secret: str
    cache_ttl: int
    request_timeout: int
    force_demo: bool
    default_currency: str
    marketplaces: dict[str, MarketplaceCredentials]

    @property
    def auth_enabled(self) -> bool:
        return bool(self.password)


def _marketplaces() -> dict[str, MarketplaceCredentials]:
    return {
        "wildberries": MarketplaceCredentials(
            code="wildberries",
            title="Wildberries",
            values={"token": _env("WB_API_TOKEN")},
            required=("token",),
        ),
        "ozon": MarketplaceCredentials(
            code="ozon",
            title="Ozon",
            values={
                "client_id": _env("OZON_CLIENT_ID"),
                "api_key": _env("OZON_API_KEY"),
            },
            required=("client_id", "api_key"),
        ),
        "yandex": MarketplaceCredentials(
            code="yandex",
            title="Яндекс Маркет",
            values={
                "api_key": _env("YANDEX_API_KEY"),
                "business_id": _env("YANDEX_BUSINESS_ID"),
                "campaign_id": _env("YANDEX_CAMPAIGN_ID"),
            },
            required=("api_key", "campaign_id"),
        ),
        "ali": MarketplaceCredentials(
            code="ali",
            title="AliExpress",
            values={
                "app_key": _env("ALI_APP_KEY"),
                "app_secret": _env("ALI_APP_SECRET"),
                "access_token": _env("ALI_ACCESS_TOKEN"),
            },
            required=("app_key", "app_secret", "access_token"),
        ),
    }


def load_settings() -> Settings:
    db_path = Path(_env("DASHBOARD_DB_PATH", "data/dashboard.db"))
    if not db_path.is_absolute():
        db_path = BASE_DIR / db_path
    return Settings(
        host=_env("DASHBOARD_HOST", "0.0.0.0"),
        port=_env_int("DASHBOARD_PORT", 8080),
        db_path=db_path,
        password=_env("DASHBOARD_PASSWORD"),
        session_secret=_env("DASHBOARD_SECRET", "change-me-in-production"),
        cache_ttl=_env_int("DASHBOARD_CACHE_TTL", 300),
        request_timeout=_env_int("DASHBOARD_HTTP_TIMEOUT", 30),
        force_demo=_env_bool("DASHBOARD_DEMO", False),
        default_currency=_env("DASHBOARD_CURRENCY", "RUB"),
        marketplaces=_marketplaces(),
    )


settings = load_settings()
