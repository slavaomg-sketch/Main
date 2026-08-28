"""Базовый коннектор маркетплейса.

Контракт простой: `fetch(period)` возвращает `MarketplaceReport`.
Реализация обязана не падать — любая ошибка сети или ключей превращается
в отчёт с флагом `error`, чтобы одна упавшая площадка не гасила панель.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import MarketplaceCredentials, settings
from ..models import MarketplaceReport, Period

log = logging.getLogger(__name__)


class MarketplaceConnector:
    code: str = ""
    title: str = ""

    def __init__(self, credentials: MarketplaceCredentials) -> None:
        self.credentials = credentials

    @property
    def configured(self) -> bool:
        return self.credentials.configured

    async def fetch(self, period: Period) -> MarketplaceReport:
        """Собрать отчёт за период. Переопределяется в наследниках."""
        raise NotImplementedError

    def empty_report(self, *, error: str = "", demo: bool = False) -> MarketplaceReport:
        return MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=self.configured and not error,
            demo=demo,
            error=error,
        )

    async def safe_fetch(self, period: Period) -> MarketplaceReport:
        try:
            return await self.fetch(period)
        except httpx.HTTPStatusError as exc:
            message = f"HTTP {exc.response.status_code} от {self.title}"
            log.warning("%s: %s", message, exc.response.text[:300])
            return self.empty_report(error=message)
        except httpx.HTTPError as exc:
            log.warning("Сеть недоступна для %s: %s", self.title, exc)
            return self.empty_report(error=f"Нет связи с {self.title}")
        except Exception as exc:  # noqa: BLE001 — падение площадки не должно ронять панель
            log.exception("Ошибка коннектора %s", self.code)
            return self.empty_report(error=f"{type(exc).__name__}: {exc}")


class HttpConnector(MarketplaceConnector):
    """Коннектор поверх HTTP API с общими настройками клиента."""

    base_url: str = ""

    def headers(self) -> dict[str, str]:
        return {"Accept": "application/json"}

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    @staticmethod
    def as_list(payload: Any, *keys: str) -> list[dict[str, Any]]:
        """Достать список из ответа, каким бы ни была его обёртка."""
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if not isinstance(payload, dict):
            return []
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = HttpConnector.as_list(value, *keys)
                if nested:
                    return nested
        return []

    @staticmethod
    def to_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def to_int(value: Any, default: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default
