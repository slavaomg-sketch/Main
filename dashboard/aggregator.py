"""Сборка данных со всех площадок в один срез.

Площадки опрашиваются параллельно: одна медленная не задерживает остальные.
Результат кладётся в кэш на `DASHBOARD_CACHE_TTL` секунд, чтобы обновление
страницы не било по лимитам API маркетплейсов.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import replace
from datetime import date
from typing import Any, Iterable

from .config import Settings, settings
from .connections import Connection
from .connectors import MARKETPLACE_ORDER, build_connector
from .models import DayPoint, MarketplaceReport, Period, Product, RegionSales, Snapshot

log = logging.getLogger(__name__)


def _sum(reports: Iterable[MarketplaceReport], attr: str) -> float:
    return sum(getattr(report, attr, 0) or 0 for report in reports)


def merge_reports(
    code: str, title: str, reports: list[MarketplaceReport], period: Period
) -> MarketplaceReport:
    """Свести отчёты нескольких магазинов одной площадки в один.

    У руководителя может быть два магазина на Wildberries — в графиках и
    таблицах площадка должна оставаться одной строкой, но с разбивкой
    по магазинам внутри.
    """
    merged = MarketplaceReport(
        marketplace=code,
        title=title,
        connected=any(report.connected for report in reports),
        demo=all(report.demo for report in reports) if reports else True,
    )
    errors = [report.error for report in reports if report.error]
    merged.error = "; ".join(dict.fromkeys(errors))
    merged.warnings = list(
        dict.fromkeys(warning for report in reports for warning in report.warnings)
    )
    merged.notes = list(
        dict.fromkeys(note for report in reports for note in report.notes)
    )
    # Глубина данных площадки — по худшему из магазинов.
    depths = [report.data_from for report in reports if report.data_from]
    merged.data_from = max(depths) if depths else None
    merged.accounts = [report.to_account_summary() for report in reports]

    for attr in (
        "revenue", "gross_revenue", "returns_amount",
        "orders", "units", "returns", "cancellations", "buyouts",
        "commission", "payout", "logistics", "ad_spend", "cost_price",
        "reviews_count", "stock_units",
    ):
        setattr(merged, attr, _sum(reports, attr))

    # Рейтинг — средневзвешенный по числу отзывов, иначе магазин с тремя
    # отзывами перевесил бы магазин с тремя тысячами.
    weighted = sum(report.rating * max(report.reviews_count, 1) for report in reports if report.rating)
    weights = sum(max(report.reviews_count, 1) for report in reports if report.rating)
    merged.rating = weighted / weights if weights else 0.0

    days: dict[date, DayPoint] = {day: DayPoint(day=day) for day in period.each_day()}
    for report in reports:
        for point in report.series:
            bucket = days.get(point.day)
            if bucket is None:
                continue
            bucket.revenue += point.revenue
            bucket.orders += point.orders
            bucket.units += point.units
            bucket.returns += point.returns
    merged.series = [days[day] for day in period.each_day()]

    products: dict[str, Product] = {}
    for report in reports:
        for product in report.products:
            existing = products.get(product.sku)
            if existing is None:
                products[product.sku] = replace(product)
                continue
            existing.revenue += product.revenue
            existing.units += product.units
            existing.stock += product.stock
            existing.returns += product.returns
            existing.rating = max(existing.rating, product.rating)
            if existing.account != product.account:
                existing.account = "несколько магазинов"
    merged.products = sorted(products.values(), key=lambda item: item.revenue, reverse=True)[:20]

    regions: dict[str, RegionSales] = {}
    for report in reports:
        for region in report.regions:
            existing = regions.setdefault(region.region, RegionSales(region=region.region))
            existing.revenue += region.revenue
            existing.orders += region.orders
    merged.regions = sorted(regions.values(), key=lambda item: item.revenue, reverse=True)

    alerts = [alert for report in reports for alert in report.stock_alerts]
    merged.stock_alerts = sorted(alerts, key=lambda item: item.days_left)[:8]

    reviews = [review for report in reports for review in report.reviews]
    merged.reviews = sorted(reviews, key=lambda item: item.created_at, reverse=True)[:8]

    for attr in ("impressions", "card_views", "cart_adds", "orders", "buyouts"):
        setattr(
            merged.funnel,
            attr,
            int(sum(getattr(report.funnel, attr, 0) for report in reports)),
        )

    return merged


def build_totals(reports: list[MarketplaceReport]) -> dict[str, Any]:
    """Свод по всем площадкам плюс общий дневной ряд."""
    revenue = _sum(reports, "revenue")
    gross_revenue = _sum(reports, "gross_revenue")
    returns_amount = _sum(reports, "returns_amount")
    orders = int(_sum(reports, "orders"))
    units = int(_sum(reports, "units"))
    returns = int(_sum(reports, "returns"))
    buyouts = int(_sum(reports, "buyouts"))
    commission = _sum(reports, "commission")
    payout = _sum(reports, "payout")
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
        # Выручка = выкупы − возвраты. Обе половины отдаются наружу, чтобы
        # цифру можно было сверить с личным кабинетом площадки.
        "grossRevenue": round(gross_revenue, 2),
        "returnsAmount": round(returns_amount, 2),
        "returnsShare": round(returns_amount / gross_revenue * 100, 1) if gross_revenue else 0.0,
        "orders": orders,
        "units": units,
        "returns": returns,
        "buyouts": buyouts,
        "cancellations": int(_sum(reports, "cancellations")),
        "commission": round(commission, 2),
        "payout": round(payout, 2),
        "payoutShare": round(payout / revenue * 100, 1) if revenue else 0.0,
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
        # Разбивка по магазинам: у площадки их может быть несколько.
        "accounts": [
            dict(account.to_dict(), share=round(account.revenue / revenue * 100, 1) if revenue else 0.0)
            for account in sorted(
                (account for report in reports for account in report.accounts),
                key=lambda item: item.revenue,
                reverse=True,
            )
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
        "grossRevenue",
        "returnsAmount",
        "orders",
        "units",
        "profit",
        "avgCheck",
        "payout",
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

    def _key(self, period: Period, codes: tuple[str, ...], scope: str = "") -> str:
        return f"{period.date_from}:{period.date_to}:{','.join(codes)}:{scope}"

    async def get(
        self, period: Period, codes: tuple[str, ...], scope: str = ""
    ) -> Snapshot | None:
        async with self._lock:
            item = self._items.get(self._key(period, codes, scope))
            if not item:
                return None
            stored_at, snapshot = item
            if time.monotonic() - stored_at > self.ttl:
                return None
            return snapshot

    async def put(
        self, period: Period, codes: tuple[str, ...], snapshot: Snapshot, scope: str = ""
    ) -> None:
        async with self._lock:
            self._items[self._key(period, codes, scope)] = (time.monotonic(), snapshot)

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


def normalize_stores(raw: str | None, connections: list[Connection]) -> tuple[str, ...]:
    """Разобрать фильтр магазинов из строки запроса.

    Пустая строка или «all» — смотрим все кабинеты вместе, как раньше.
    Иначе остаются только перечисленные: у одной площадки может быть
    несколько магазинов, и руководителю нужно видеть каждый отдельно.
    """
    if not raw or raw.strip().lower() in {"all", "*", "все"}:
        return ()
    wanted = {item.strip() for item in raw.split(",") if item.strip()}
    picked = tuple(
        connection.id for connection in connections if connection.id in wanted
    )
    return picked


def _tag_account(report: MarketplaceReport, title: str) -> MarketplaceReport:
    """Проставить название магазина всему, что он принёс."""
    report.account_title = title
    for product in report.products:
        product.account = title
    for alert in report.stock_alerts:
        alert.account = title
    for review in report.reviews:
        review.account = title
    return report


async def collect(
    period: Period,
    codes: tuple[str, ...],
    config: Settings | None = None,
    connections: list[Connection] | None = None,
) -> list[MarketplaceReport]:
    """Опросить все магазины параллельно и свести их по площадкам.

    Магазины опрашиваются одновременно — два кабинета Wildberries не ждут
    друг друга. Площадка без настроенных магазинов отдаёт демо-данные.
    """
    config = config or settings
    connections = connections or []

    from . import warehouse  # локальный импорт: хранилище знает про коннекторы

    plan: list[tuple[str, str, Any]] = []  # (код площадки, название магазина, что запустить)
    for code in codes:
        stores = [
            connection
            for connection in connections
            if connection.marketplace == code and connection.enabled and connection.configured
        ]
        if stores and not config.force_demo:
            for store in stores:
                if code in warehouse.STORED:
                    # Данные уже выгружены на сервер — считаем отчёт из базы.
                    plan.append((code, store.title, warehouse.report_for(store, period, config)))
                else:
                    connector = build_connector(code, config, store.credentials(config))
                    plan.append((code, store.title, connector.safe_fetch(period)))
        else:
            connector = build_connector(code, config)
            plan.append((code, config.marketplaces[code].title, connector.safe_fetch(period)))

    fetched = await asyncio.gather(*(task for _, _, task in plan), return_exceptions=True)

    by_code: dict[str, list[MarketplaceReport]] = {code: [] for code in codes}
    for (code, title, _), report in zip(plan, fetched):
        if isinstance(report, BaseException):
            log.warning("Отчёт %s не собрался: %s", title, report)
            report = MarketplaceReport(
                marketplace=code,
                title=config.marketplaces[code].title,
                connected=True,
                demo=False,
                error="не удалось собрать отчёт",
            )
        by_code[code].append(_tag_account(report, title))

    return [
        merge_reports(code, config.marketplaces[code].title, by_code[code], period)
        for code in codes
    ]


async def build_snapshot(
    period: Period,
    codes: tuple[str, ...],
    *,
    compare: bool = True,
    use_cache: bool = True,
    config: Settings | None = None,
    connections: list[Connection] | None = None,
    scope: str = "",
) -> Snapshot:
    """Срез за период. `scope` — какие магазины выбраны, входит в ключ кэша:
    иначе «все магазины» и «только Наталья» делили бы один ответ."""
    config = config or settings
    if use_cache:
        cached = await cache.get(period, codes, scope)
        if cached is not None:
            return cached

    # Прошлый период считаем первым: Wildberries отдаёт статистику «от даты»,
    # поэтому более широкая выборка закрывает и текущий период — второй запрос
    # к площадке не понадобится и лимит частоты не сработает.
    previous: list[MarketplaceReport] = []
    previous_period = period.previous() if compare else None
    if previous_period is not None:
        previous = await collect(previous_period, codes, config, connections)
    reports = await collect(period, codes, config, connections)

    snapshot = Snapshot(
        period=period,
        reports=reports,
        previous=previous,
        previous_period=previous_period,
        currency=config.default_currency,
    )
    if use_cache:
        await cache.put(period, codes, snapshot, scope)
    return snapshot
