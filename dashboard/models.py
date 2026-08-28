"""Единая модель данных.

Каждый маркетплейс отдаёт свои поля и свою терминологию. Коннекторы
приводят их к общим структурам ниже — дальше по коду разницы уже нет.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any


def _round(value: float, digits: int = 2) -> float:
    return round(float(value or 0), digits)


# Периоды, которые считаются от начала календарного отрезка. Сравнивать их
# нужно с тем же отрезком предыдущего месяца, квартала, полугодия или года,
# а не со «сдвигом на столько же дней назад».
# «Месяц» — календарный: с 1 числа по сегодня, как его понимает бухгалтерия.
CALENDAR_PRESETS = {"month"}

# Квартал, полугодие и год — скользящие окна: последние 3, 6 и 12 месяцев.
# Календарными их делать нельзя: с июля по сентябрь «текущий квартал» и
# «текущее полугодие» — это один и тот же отрезок, и панель показывала бы
# по ним одинаковые цифры.
ROLLING_MONTHS = {"quarter": 3, "half": 6, "year": 12}

MONTHS_BACK = {"month": 1, **ROLLING_MONTHS}


def shift_months(day: date, months: int) -> date:
    """Сдвинуть дату на несколько месяцев назад, не выходя за длину месяца."""
    month_index = (day.year * 12 + day.month - 1) - months
    year, month = divmod(month_index, 12)
    month += 1
    last_day = monthrange(year, month)[1]
    return date(year, month, min(day.day, last_day))


@dataclass
class Period:
    """Отчётный период (границы включительно).

    `until` отсекает незавершённый день: сегодняшние данные обрываются
    текущим часом, поэтому и вчерашние для сравнения нужно обрезать тем же
    часом — иначе неполные сутки сопоставлялись бы с полными.
    """

    date_from: date
    date_to: date
    preset: str = "custom"
    until: datetime | None = None

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def covers(self, moment: datetime) -> bool:
        """Попадает ли момент времени в период с учётом отсечки."""
        if not (self.date_from <= moment.date() <= self.date_to):
            return False
        return self.until is None or moment <= self.until

    def previous(self, now: datetime | None = None) -> "Period":
        """Сопоставимый предыдущий период — для расчёта динамики.

        Календарный «Месяц» сравнивается с тем же отрезком прошлого месяца:
        «1–28 августа» с «1–28 июля», а не с «4–31 июля». Скользящие окна —
        неделя, квартал, полгода, год — сдвигаются на свою длину назад.
        """
        now = now or datetime.now()

        if self.preset in CALENDAR_PRESETS:
            start = shift_months(self.date_from, MONTHS_BACK[self.preset])
            end = start + timedelta(days=self.days - 1)
        else:
            length = timedelta(days=self.days)
            start = self.date_from - length
            end = self.date_to - length

        # Если период упирается в сегодня, он неполный — обрезаем и прошлый.
        until = None
        if self.date_to >= now.date():
            until = datetime.combine(end, now.time())

        return Period(date_from=start, date_to=end, preset=f"prev:{self.preset}", until=until)

    def each_day(self) -> list[date]:
        return [self.date_from + timedelta(days=i) for i in range(self.days)]

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.date_from.isoformat(),
            "to": self.date_to.isoformat(),
            "preset": self.preset,
            "days": self.days,
            "until": self.until.isoformat() if self.until else "",
        }

    @classmethod
    def from_preset(cls, preset: str, today: date | None = None) -> "Period":
        today = today or date.today()

        # Квартал, полугодие и год отсчитываются назад от сегодня: «Квартал» —
        # последние три месяца, «Полгода» — шесть, «Год» — двенадцать. Так они
        # всегда разной длины и всегда показывают полный отрезок, а не огрызок
        # календарного периода.
        def months_back(months: int) -> date:
            return shift_months(today, months) + timedelta(days=1)

        presets: dict[str, tuple[date, date]] = {
            "today": (today, today),
            "yesterday": (today - timedelta(days=1), today - timedelta(days=1)),
            "7d": (today - timedelta(days=6), today),
            "14d": (today - timedelta(days=13), today),
            "30d": (today - timedelta(days=29), today),
            "90d": (today - timedelta(days=89), today),
            "month": (today.replace(day=1), today),
            "quarter": (months_back(ROLLING_MONTHS["quarter"]), today),
            "half": (months_back(ROLLING_MONTHS["half"]), today),
            "year": (months_back(ROLLING_MONTHS["year"]), today),
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
class ParentSales:
    """Продажи по родительскому артикулу.

    У продавца артикул задаёт «родителя»: кабель TC-TC-1M и TC-TC-2M —
    разные товары, а их размеры и цвета висят под одним артикулом. Средний
    чек по родителям показывает, какой товар тянет корзину вверх.
    """

    article: str
    name: str = ""
    orders: int = 0
    orders_amount: float = 0.0
    units: int = 0
    revenue: float = 0.0
    marketplace: str = ""

    @property
    def avg_check(self) -> float:
        return self.orders_amount / self.orders if self.orders else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "article": self.article,
            "name": self.name,
            "orders": int(self.orders),
            "ordersAmount": _round(self.orders_amount),
            "units": int(self.units),
            "revenue": _round(self.revenue),
            "avgCheck": _round(self.avg_check),
            "marketplace": self.marketplace,
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
    payout: float = 0.0
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
            "payout": _round(self.payout),
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

    # Пояснения к цифрам: откуда они взяты, как посчитаны. Это не сбой —
    # панель не должна из-за них поднимать тревогу «часть данных не пришла».
    notes: list[str] = field(default_factory=list)

    # С какой даты у нас вообще есть данные. Площадки хранят статистику
    # ограниченный срок: Wildberries — около полугода. Если запросить период
    # глубже, цифры будут неполными, и об этом нужно сказать вслух.
    data_from: date | None = None

    # Выручка — чистая: выкупы за вычетом возвратов. Обе половины хранятся
    # отдельно, чтобы цифру можно было сверить с личным кабинетом площадки:
    # там показывают валовые выкупы, без вычета возвратов.
    revenue: float = 0.0
    gross_revenue: float = 0.0
    returns_amount: float = 0.0
    # Сколько заплатили покупатели — то есть уже после скидки площадки.
    # На доход продавца не влияет: разницу площадка берёт на себя.
    buyer_paid: float = 0.0
    orders: int = 0
    # Заказы в деньгах — по цене до скидки продавца и вместе с отменёнными:
    # так их показывает приложение Wildberries, и владелец сверяется с ним.
    # Отдельно живёт `orders` — принятые заказы, по ним считается выкуп.
    orders_placed: int = 0
    orders_amount: float = 0.0
    units: int = 0
    returns: int = 0
    cancellations: int = 0
    buyouts: int = 0

    commission: float = 0.0
    logistics: float = 0.0
    ad_spend: float = 0.0
    cost_price: float = 0.0

    # Сколько площадка фактически перечислит продавцу: у Wildberries это
    # сумма поля forPay, то есть цена за вычетом её комиссии. Точные данные
    # площадки, а не расчёт.
    payout: float = 0.0

    rating: float = 0.0
    reviews_count: int = 0
    stock_units: int = 0

    # Баланс кабинета: сколько на нём сейчас, сколько доступно к выводу и
    # насколько он вырос за период. Прирост — это и есть деньги, которые
    # площадка начислила за период, уже за вычетом всех своих расходов.
    # Итоги ежедневных отчётов реализации — как их считает сам Wildberries.
    # «Итого к оплате» это и есть сумма, которая уходит на расчётный счёт.
    bank_payment: float = 0.0
    report_sale: float = 0.0
    report_for_pay: float = 0.0
    delivery_cost: float = 0.0
    storage_cost: float = 0.0
    acceptance_cost: float = 0.0
    penalty_sum: float = 0.0
    deduction_sum: float = 0.0
    reports_count: int = 0

    balance_current: float = 0.0
    balance_for_withdraw: float = 0.0
    balance_delta: float = 0.0
    balance_delta_known: bool = False
    balance_at: str = ""

    series: list[DayPoint] = field(default_factory=list)
    products: list[Product] = field(default_factory=list)
    parents: list[ParentSales] = field(default_factory=list)
    stock_alerts: list[StockAlert] = field(default_factory=list)
    regions: list[RegionSales] = field(default_factory=list)
    reviews: list[Review] = field(default_factory=list)
    funnel: Funnel = field(default_factory=Funnel)
    accounts: list[AccountSummary] = field(default_factory=list)

    @property
    def avg_check(self) -> float:
        """Средняя сумма заказа. Считается по заказам, а не по выкупам:
        выкуп — уже другое событие, случившееся днями позже."""
        placed = self.orders_placed or self.orders
        return self.orders_amount / placed if placed else 0.0

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
            payout=self.payout,
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
            "notes": list(self.notes),
            "dataFrom": self.data_from.isoformat() if self.data_from else "",
            "revenue": _round(self.revenue),
            "grossRevenue": _round(self.gross_revenue),
            "returnsAmount": _round(self.returns_amount),
            "buyerPaid": _round(self.buyer_paid),
            "orders": int(self.orders),
            "ordersPlaced": int(self.orders_placed),
            "ordersAmount": _round(self.orders_amount),
            "units": int(self.units),
            "returns": int(self.returns),
            "cancellations": int(self.cancellations),
            "buyouts": int(self.buyouts),
            "commission": _round(self.commission),
            "payout": _round(self.payout),
            "logistics": _round(self.logistics),
            "adSpend": _round(self.ad_spend),
            "costPrice": _round(self.cost_price),
            "rating": _round(self.rating, 2),
            "reviewsCount": int(self.reviews_count),
            "stockUnits": int(self.stock_units),
            "bankPayment": _round(self.bank_payment),
            "reportSale": _round(self.report_sale),
            "reportForPay": _round(self.report_for_pay),
            "deliveryCost": _round(self.delivery_cost),
            "storageCost": _round(self.storage_cost),
            "acceptanceCost": _round(self.acceptance_cost),
            "penaltySum": _round(self.penalty_sum),
            "deductionSum": _round(self.deduction_sum),
            "reportsCount": int(self.reports_count),
            "balanceCurrent": _round(self.balance_current),
            "balanceForWithdraw": _round(self.balance_for_withdraw),
            "balanceDelta": _round(self.balance_delta),
            "balanceDeltaKnown": self.balance_delta_known,
            "balanceAt": self.balance_at,
            "avgCheck": _round(self.avg_check),
            "profit": _round(self.profit),
            "margin": _round(self.margin, 1),
            "buyoutRate": _round(self.buyout_rate, 1),
            "returnRate": _round(self.return_rate, 1),
            "drr": _round(self.drr, 1),
            "stockDays": _round(self.stock_days, 1),
            "series": [point.to_dict() for point in self.series],
            "products": [product.to_dict() for product in self.products],
            "parents": [parent.to_dict() for parent in self.parents],
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
    previous_period: Period | None = None
    generated_at: datetime = field(default_factory=datetime.utcnow)
    currency: str = "RUB"

    def to_dict(self) -> dict[str, Any]:
        from .aggregator import build_totals, build_deltas

        return {
            "period": self.period.to_dict(),
            "comparedTo": self.previous_period.to_dict() if self.previous_period else None,
            "currency": self.currency,
            "generatedAt": self.generated_at.replace(microsecond=0).isoformat() + "Z",
            "totals": build_totals(self.reports),
            "deltas": build_deltas(self.reports, self.previous),
            "marketplaces": [report.to_dict() for report in self.reports],
        }


def dataclass_to_dict(value: Any) -> dict[str, Any]:
    return asdict(value)
