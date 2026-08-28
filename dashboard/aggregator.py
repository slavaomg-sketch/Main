"""Сборка данных со всех площадок в один срез.

Площадки опрашиваются параллельно: одна медленная не задерживает остальные.
Результат кладётся в кэш на `DASHBOARD_CACHE_TTL` секунд, чтобы обновление
страницы не било по лимитам API маркетплейсов.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Iterable

from .config import Settings, settings
from .connectors import MARKETPLACE_ORDER, build_connector
from .models import MarketplaceReport, Period, Snapshot

log = logging.getLogger(__name__)


def _sum(reports: Iterable[MarketplaceReport], attr: str) -> float:
    return sum(getattr(report, attr, 0) or 0 for report in reports)


def build_totals(reports: list[MarketplaceReport]) -> dict[str, Any]:
    """Свод по всем площадкам плюс общий дневной ряд."""
    revenue = _sum(reports, "revenue")
    orders = int(_sum(reports, "orders"))
    units = int(_sum(reports, "units"))
    returns = int(_sum(reports, "returns"))
    buyouts = int(_sum(reports, "buyouts"))
    commission = _sum(reports, "commission")
    logistics = _sum(reports, "logistics")
    ad_spend = _sum(reports, "ad_spend")
    cost_price = _sum(reports, "cost_price")
    profit = revenue - commission - logistics - ad_spend - cost_price

    ratings = [report.rating for report in reports if report.rating]
    reviews_count = int(_sum(reports, "reviews_count"))

    series: dict[str, dict[str, float]] = {}
    for report in reports:
        for point in report.series:
            key = point.day.isoformat()
            bucket = series.setdefault(key, {"day": key, "revenue": 0.0, "orders": 0, "units": 0})
            bucket["revenue"] += point.revenue
            bucket["orders"] += point.orders
            bucket["units"] += point.units

    return {
        "revenue": round(revenue, 2),
        "orders": orders,
        "units": units,
        "returns": returns,
        "buyouts": buyouts,
        "cancellations": int(_sum(reports, "cancellations")),
        "commission": round(commission, 2),
        "logistics": round(logistics, 2),
        "adSpend": round(ad_spend, 2),
        "costPrice": round(cost_price, 2),
        "profit": round(profit, 2),
        "margin": round(profit / revenue * 100, 1) if revenue else 0.0,
        "avgCheck": round(revenue / orders, 2) if orders else 0.0,
        "buyoutRate": round(buyouts / orders * 100, 1) if orders else 0.0,
        "returnRate": round(returns / orders * 100, 1) if orders else 0.0,
        "drr": round(ad_spend / revenue * 100, 1) if revenue else 0.0,
        "stockUnits": int(_sum(reports, "stock_units")),
        "rating": round(sum(ratings) / len(ratings), 2) if ratings else 0.0,
        "reviewsCount": reviews_count,
        "series": [series[key] for key in sorted(series)],
        "share": [
            {
                "marketplace": report.marketplace,
                "title": report.title,
                "revenue": round(report.revenue, 2),
                "share": round(report.revenue / revenue * 100, 1) if revenue else 0.0,
            }
            for report in sorted(reports, key=lambda item: item.revenue, reverse=True)
        ],
    }


def _delta(current: float, previous: float) -> dict[str, Any]:
    if not previous:
        return {"value": round(current, 2), "prev": 0.0, "change": None}
    change = (current - previous) / abs(previous) * 100
    return {
        "value": round(current, 2),
        "prev": round(previous, 2),
        "change": round(change, 1),
    }


def build_deltas(
    current: list[MarketplaceReport], previous: list[MarketplaceReport]
) -> dict[str, Any]:
    """Сравнение с предыдущим сопоставимым периодом."""
    if not previous:
        return {}
    now = build_totals(current)
    was = build_totals(previous)
    keys = (
        "revenue",
        "orders",
        "units",
        "profit",
        "avgCheck",
        "returns",
        "returnRate",
        "buyoutRate",
        "adSpend",
        "drr",
        "margin",
    )
    result = {key: _delta(float(now.get(key) or 0), float(was.get(key) or 0)) for key in keys}
    result["byMarketplace"] = {
        report.marketplace: _delta(
            report.revenue,
            next(
                (item.revenue for item in previous if item.marketplace == report.marketplace),
                0.0,
            ),
        )
        for report in current
    }
    return result


class SnapshotCache:
    """Простой кэш в памяти с TTL. Ключ — период плюс набор площадок."""

    def __init__(self, ttl: int) -> None:
        self.ttl = ttl
        self._items: dict[str, tuple[float, Snapshot]] = {}
        self._lock = asyncio.Lock()

    def _key(self, period: Period, codes: tuple[str, ...]) -> str:
        return f"{period.date_from}:{period.date_to}:{','.join(codes)}"

    async def get(self, period: Period, codes: tuple[str, ...]) -> Snapshot | None:
        async with self._lock:
            item = self._items.get(self._key(period, codes))
            if not item:
                return None
            stored_at, snapshot = item
            if time.monotonic() - stored_at > self.ttl:
                return None
            return snapshot

    async def put(self, period: Period, codes: tuple[str, ...], snapshot: Snapshot) -> None:
        async with self._lock:
            self._items[self._key(period, codes)] = (time.monotonic(), snapshot)

    async def clear(self) -> None:
        async with self._lock:
            self._items.clear()


cache = SnapshotCache(settings.cache_ttl)


def normalize_codes(raw: str | None) -> tuple[str, ...]:
    """Разобрать фильтр площадок из строки запроса."""
    if not raw or raw.strip().lower() in {"all", "*", "все"}:
        return MARKETPLACE_ORDER
    codes = [code.strip().lower() for code in raw.split(",") if code.strip()]
    selected = tuple(code for code in MARKETPLACE_ORDER if code in codes)
    return selected or MARKETPLACE_ORDER


async def collect(
    period: Period,
    codes: tuple[str, ...],
    config: Settings | None = None,
) -> list[MarketplaceReport]:
    """Опросить площадки параллельно и вернуть их отчёты в заданном порядке."""
    config = config or settings
    connectors = [build_connector(code, config) for code in codes]
    tasks = [connector.safe_fetch(period) for connector in connectors]
    return list(await asyncio.gather(*tasks))


async def build_snapshot(
    period: Period,
    codes: tuple[str, ...],
    *,
    compare: bool = True,
    use_cache: bool = True,
    config: Settings | None = None,
) -> Snapshot:
    config = config or settings
    if use_cache:
        cached = await cache.get(period, codes)
        if cached is not None:
            return cached

    reports = await collect(period, codes, config)
    previous: list[MarketplaceReport] = []
    if compare:
        previous = await collect(period.previous(), codes, config)

    snapshot = Snapshot(
        period=period,
        reports=reports,
        previous=previous,
        currency=config.default_currency,
    )
    if use_cache:
        await cache.put(period, codes, snapshot)
    return snapshot
