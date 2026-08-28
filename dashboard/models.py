"""Единая модель данных.

Каждый маркетплейс отдаёт свои поля и свою терминологию. Коннекторы
приводят их к общим структурам ниже — дальше по коду разницы уже нет.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Any


def _round(value: float, digits: int = 2) -> float:
    return round(float(value or 0), digits)


@dataclass
class Period:
    """Отчётный период (границы включительно)."""

    date_from: date
    date_to: date
    preset: str = "custom"

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def previous(self) -> "Period":
        """Сопоставимый предыдущий период — для расчёта динамики."""
        length = timedelta(days=self.days)
        return Period(
            date_from=self.date_from - length,
            date_to=self.date_to - length,
            preset=f"prev:{self.preset}",
        )

    def each_day(self) -> list[date]:
        return [self.date_from + timedelta(days=i) for i in range(self.days)]

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.date_from.isoformat(),
            "to": self.date_to.isoformat(),
            "preset": self.preset,
            "days": self.days,
        }

    @classmethod
    def from_preset(cls, preset: str, today: date | None = None) -> "Period":
        today = today or date.today()

        # Квартал, полугодие и год — календарные: считаются от начала периода,
        # как их считает бухгалтерия, а не «последние N дней».
        quarter_start = today.replace(month=(today.month - 1) // 3 * 3 + 1, day=1)
        half_start = today.replace(month=1 if today.month <= 6 else 7, day=1)

        presets: dict[str, tuple[date, date]] = {
            "today": (today, today),
            "yesterday": (today - timedelta(days=1), today - timedelta(days=1)),
            "7d": (today - timedelta(days=6), today),
            "14d": (today - timedelta(days=13), today),
            "30d": (today - timedelta(days=29), today),
            "90d": (today - timedelta(days=89), today),
            "month": (today.replace(day=1), today),
            "quarter": (quarter_start, today),
            "half": (half_start, today),
            "year": (today.replace(month=1, day=1), today),
        }
        if preset not in presets:
            preset = "30d"
        date_from, date_to = presets[preset]
        return cls(date_from=date_from, date_to=date_to, preset=preset)


@dataclass
class DayPoint:
    """Одна точка на графике динамики."""

    day: date
    revenue: float = 0.0
    orders: int = 0
    units: int = 0
    returns: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "day": self.day.isoformat(),
            "revenue": _round(self.revenue),
            "orders": int(self.orders),
            "units": int(self.units),
            "returns": int(self.returns),
        }


@dataclass
class Product:
    """Товар в разрезе продаж."""

    sku: str
    name: str
    revenue: float = 0.0
    units: int = 0
    stock: int = 0
    returns: int = 0
    rating: float = 0.0
    marketplace: str = ""
    account: str = ""
    image: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku": self.sku,
            "name": self.name,
            "revenue": _round(self.revenue),
            "units": int(self.units),
            "stock": int(self.stock),
            "returns": int(self.returns),
            "rating": _round(self.rating, 1),
            "marketplace": self.marketplace,
            "account": self.account,
            "image": self.image,
        }


@dataclass
class StockAlert:
    """Предупреждение об остатках: товар скоро закончится."""

    sku: str
    name: str
    stock: int
    days_left: float
    marketplace: str = ""
    account: str = ""
    warehouse: str = ""

    @property
    def severity(self) -> str:
        if self.days_left <= 3:
            return "critical"
        if self.days_left <= 7:
            return "warning"
        return "ok"

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku": self.sku,
            "name": self.name,
            "stock": int(self.stock),
            "daysLeft": _round(self.days_left, 1),
            "marketplace": self.marketplace,
            "account": self.account,
            "warehouse": self.warehouse,
            "severity": self.severity,
        }


@dataclass
class RegionSales:
    region: str
    revenue: float = 0.0
    orders: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "region": self.region,
            "revenue": _round(self.revenue),
            "orders": int(self.orders),
        }


@dataclass
class Review:
    sku: str
    name: str
    rating: float
    text: str
    created_at: str = ""
    marketplace: str = ""
    account: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku": self.sku,
            "name": self.name,
            "rating": _round(self.rating, 1),
            "text": self.text,
            "createdAt": self.created_at,
            "marketplace": self.marketplace,
            "account": self.account,
        }


@dataclass
class Funnel:
    """Воронка от показа карточки до выкупа."""

    impressions: int = 0
    card_views: int = 0
    cart_adds: int = 0
    orders: int = 0
    buyouts: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "impressions": int(self.impressions),
            "cardViews": int(self.card_views),
            "cartAdds": int(self.cart_adds),
            "orders": int(self.orders),
            "buyouts": int(self.buyouts),
        }


@dataclass
class AccountSummary:
    """Короткая сводка по одному магазину внутри площадки."""

    id: str
    title: str
    marketplace: str
    revenue: float = 0.0
    orders: int = 0
    units: int = 0
    profit: float = 0.0
    returns: int = 0
    stock_units: int = 0
    demo: bool = True
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "marketplace": self.marketplace,
            "revenue": _round(self.revenue),
            "orders": int(self.orders),
            "units": int(self.units),
            "profit": _round(self.profit),
            "returns": int(self.returns),
            "stockUnits": int(self.stock_units),
            "avgCheck": _round(self.revenue / self.orders if self.orders else 0.0),
            "demo": self.demo,
            "error": self.error,
        }


@dataclass
class MarketplaceReport:
    """Отчёт одного маркетплейса за период, приведённый к общему виду.

    У площадки может быть несколько магазинов: тогда отчёт — это их сумма,
    а разбивка лежит в `accounts`.
    """

    marketplace: str
    title: str
    connected: bool = False
    demo: bool = True
    error: str = ""

    account_id: str = ""
    account_title: str = ""

    # Частичные проблемы: часть данных пришла, часть нет.
    # В отличие от `error`, отчёт при этом остаётся пригодным.
    warnings: list[str] = field(default_factory=list)

    # С какой даты у нас вообще есть данные. Площадки хранят статистику
    # ограниченный срок: Wildberries — около полугода. Если запросить период
    # глубже, цифры будут неполными, и об этом нужно сказать вслух.
    data_from: date | None = None

    revenue: float = 0.0
    orders: int = 0
    units: int = 0
    returns: int = 0
    cancellations: int = 0
    buyouts: int = 0

    commission: float = 0.0
    logistics: float = 0.0
    ad_spend: float = 0.0
    cost_price: float = 0.0

    rating: float = 0.0
    reviews_count: int = 0
    stock_units: int = 0

    series: list[DayPoint] = field(default_factory=list)
    products: list[Product] = field(default_factory=list)
    stock_alerts: list[StockAlert] = field(default_factory=list)
    regions: list[RegionSales] = field(default_factory=list)
    reviews: list[Review] = field(default_factory=list)
    funnel: Funnel = field(default_factory=Funnel)
    accounts: list[AccountSummary] = field(default_factory=list)

    @property
    def avg_check(self) -> float:
        return self.revenue / self.orders if self.orders else 0.0

    @property
    def profit(self) -> float:
        return self.revenue - self.commission - self.logistics - self.ad_spend - self.cost_price

    @property
    def margin(self) -> float:
        return (self.profit / self.revenue * 100) if self.revenue else 0.0

    @property
    def buyout_rate(self) -> float:
        return (self.buyouts / self.orders * 100) if self.orders else 0.0

    @property
    def return_rate(self) -> float:
        return (self.returns / self.orders * 100) if self.orders else 0.0

    @property
    def drr(self) -> float:
        """Доля рекламных расходов в выручке, %."""
        return (self.ad_spend / self.revenue * 100) if self.revenue else 0.0

    @property
    def stock_days(self) -> float:
        """На сколько дней хватит остатков при текущей скорости продаж."""
        days = len(self.series) or 1
        per_day = self.units / days
        return (self.stock_units / per_day) if per_day else 0.0

    def to_account_summary(self) -> AccountSummary:
        return AccountSummary(
            id=self.account_id,
            title=self.account_title or self.title,
            marketplace=self.marketplace,
            revenue=self.revenue,
            orders=self.orders,
            units=self.units,
            profit=self.profit,
            returns=self.returns,
            stock_units=self.stock_units,
            demo=self.demo,
            error=self.error,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "marketplace": self.marketplace,
            "title": self.title,
            "connected": self.connected,
            "demo": self.demo,
            "error": self.error,
            "warnings": list(self.warnings),
            "dataFrom": self.data_from.isoformat() if self.data_from else "",
            "revenue": _round(self.revenue),
            "orders": int(self.orders),
            "units": int(self.units),
            "returns": int(self.returns),
            "cancellations": int(self.cancellations),
            "buyouts": int(self.buyouts),
            "commission": _round(self.commission),
            "logistics": _round(self.logistics),
            "adSpend": _round(self.ad_spend),
            "costPrice": _round(self.cost_price),
            "rating": _round(self.rating, 2),
            "reviewsCount": int(self.reviews_count),
            "stockUnits": int(self.stock_units),
            "avgCheck": _round(self.avg_check),
            "profit": _round(self.profit),
            "margin": _round(self.margin, 1),
            "buyoutRate": _round(self.buyout_rate, 1),
            "returnRate": _round(self.return_rate, 1),
            "drr": _round(self.drr, 1),
            "stockDays": _round(self.stock_days, 1),
            "series": [point.to_dict() for point in self.series],
            "products": [product.to_dict() for product in self.products],
            "stockAlerts": [alert.to_dict() for alert in self.stock_alerts],
            "regions": [region.to_dict() for region in self.regions],
            "reviews": [review.to_dict() for review in self.reviews],
            "funnel": self.funnel.to_dict(),
            "accounts": [account.to_dict() for account in self.accounts],
        }


@dataclass
class Snapshot:
    """Свод по всем выбранным маркетплейсам за период."""

    period: Period
    reports: list[MarketplaceReport]
    previous: list[MarketplaceReport] = field(default_factory=list)
    generated_at: datetime = field(default_factory=datetime.utcnow)
    currency: str = "RUB"

    def to_dict(self) -> dict[str, Any]:
        from .aggregator import build_totals, build_deltas

        return {
            "period": self.period.to_dict(),
            "currency": self.currency,
            "generatedAt": self.generated_at.replace(microsecond=0).isoformat() + "Z",
            "totals": build_totals(self.reports),
            "deltas": build_deltas(self.reports, self.previous),
            "marketplaces": [report.to_dict() for report in self.reports],
        }


def dataclass_to_dict(value: Any) -> dict[str, Any]:
    return asdict(value)
