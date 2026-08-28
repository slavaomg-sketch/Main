"""Базовый коннектор маркетплейса.

Контракт простой: `fetch(period)` возвращает `MarketplaceReport`.
Реализация обязана не падать — любая ошибка сети или ключей превращается
в отчёт с флагом `error`, чтобы одна упавшая площадка не гасила панель.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx

from ..config import MarketplaceCredentials, settings
from ..models import MarketplaceReport, Period

log = logging.getLogger(__name__)


@dataclass
class Probe:
    """Результат одного запроса к API площадки — для самодиагностики.

    Хранит сырой ответ, но наружу отдаётся только его структура:
    код ответа, число строк и имена полей.
    """

    label: str
    status: int | None = None
    error: str = ""
    payload: Any = None
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.error and (self.status is None or 200 <= self.status < 300)


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

    def redact(self, text: str) -> str:
        """Вымарать ключи из текста.

        Ответ площадки с ошибкой уходит и в лог, и в интерфейс, а в нём
        вполне может оказаться сам ключ — тогда он утечёт туда же.
        """
        if not self.credentials:
            return text
        for value in self.credentials.values.values():
            if value and len(value) >= 6:
                text = text.replace(value, "••••" + value[-4:])
        return text

    def empty_report(self, *, error: str = "", demo: bool = False) -> MarketplaceReport:
        return MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=self.configured and not error,
            demo=demo,
            error=error,
        )

    async def probe(self, period: Period) -> list[Probe]:
        """Повторить запросы коннектора и вернуть сырые ответы.

        Используется командой `python -m dashboard.diagnose`, чтобы понять,
        что именно отдаёт площадка на боевых ключах.
        """
        return []

    async def capture(self, label: str, call: Callable[[], Awaitable[Any]]) -> Probe:
        """Выполнить запрос и завернуть любой сбой в результат, а не в исключение.

        Текст ошибки проходит через redact — площадка может вернуть ключ
        в теле ответа, а отчёт диагностики предполагается пересылать.
        """
        try:
            return Probe(label=label, status=200, payload=await call())
        except httpx.HTTPStatusError as exc:
            return Probe(
                label=label,
                status=exc.response.status_code,
                error=self.redact(exc.response.text[:300]) or f"HTTP {exc.response.status_code}",
            )
        except httpx.HTTPError as exc:
            return Probe(label=label, error=self.redact(f"нет связи: {exc}"))
        except Exception as exc:  # noqa: BLE001 — диагностика не должна падать
            return Probe(label=label, error=self.redact(f"{type(exc).__name__}: {exc}"))

    async def safe_fetch(self, period: Period) -> MarketplaceReport:
        try:
            return await self.fetch(period)
        except httpx.HTTPStatusError as exc:
            message = f"HTTP {exc.response.status_code} от {self.title}"
            log.warning("%s: %s", message, self.redact(exc.response.text[:300]))
            return self.empty_report(error=message)
        except httpx.HTTPError as exc:
            log.warning("Сеть недоступна для %s: %s", self.title, self.redact(str(exc)))
            return self.empty_report(error=f"Нет связи с {self.title}")
        except Exception as exc:  # noqa: BLE001 — падение площадки не должно ронять панель
            log.warning("Ошибка коннектора %s: %s", self.code, self.redact(str(exc)))
            return self.empty_report(error=self.redact(f"{type(exc).__name__}: {exc}"))


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
