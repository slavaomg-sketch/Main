"""Демо-данные.

Работают, пока не подключены реальные ключи, и нужны для показа панели
руководителю до интеграции. Данные детерминированы: один и тот же день
всегда даёт одно и то же число, поэтому графики не «прыгают» при обновлении
страницы, но выглядят как настоящие продажи — с недельной сезонностью,
трендом и шумом.
"""

from __future__ import annotations

import hashlib
import math
from datetime import date

from ..models import (
    DayPoint,
    Funnel,
    MarketplaceReport,
    Period,
    Product,
    RegionSales,
    Review,
    StockAlert,
)
from .base import MarketplaceConnector

# Профиль площадки: масштаб выручки, средний чек, качество, доля рекламы.
PROFILES: dict[str, dict[str, float]] = {
    "wildberries": {"scale": 1.00, "check": 2450, "buyout": 0.72, "ad": 0.086, "rating": 4.7},
    "ozon": {"scale": 0.68, "check": 3120, "buyout": 0.83, "ad": 0.071, "rating": 4.8},
    "yandex": {"scale": 0.31, "check": 3890, "buyout": 0.88, "ad": 0.054, "rating": 4.6},
    "ali": {"scale": 0.17, "check": 1780, "buyout": 0.79, "ad": 0.038, "rating": 4.5},
}

CATALOG: list[tuple[str, str]] = [
    ("SKU-10241", "Термокружка Stelo 450 мл, сталь"),
    ("SKU-10388", "Органайзер для кухни, бамбук"),
    ("SKU-10455", "Плед-покрывало Nordic 200×220"),
    ("SKU-10512", "Набор контейнеров 5 шт, стекло"),
    ("SKU-10677", "Лампа настольная Aura, USB-C"),
    ("SKU-10704", "Коврик для йоги 6 мм, TPE"),
    ("SKU-10836", "Рюкзак городской 20 л, водоотталкивающий"),
    ("SKU-10902", "Массажный пистолет Pulse mini"),
    ("SKU-11033", "Кофемолка ручная, жернова"),
    ("SKU-11149", "Постельное бельё сатин, евро"),
    ("SKU-11207", "Увлажнитель воздуха 4 л"),
    ("SKU-11318", "Ножи кухонные, набор 6 предметов"),
]

REGIONS: list[tuple[str, float]] = [
    ("Москва и область", 0.31),
    ("Санкт-Петербург", 0.15),
    ("Краснодарский край", 0.09),
    ("Свердловская область", 0.07),
    ("Татарстан", 0.06),
    ("Новосибирская область", 0.05),
    ("Ростовская область", 0.05),
    ("Прочие регионы", 0.22),
]

REVIEW_TEXTS: list[tuple[float, str]] = [
    (5.0, "Пришло быстро, упаковано плотно. Качество лучше, чем ожидал за эти деньги."),
    (5.0, "Второй заказ уже. Всё как в описании, беру в подарок."),
    (4.0, "Хорошо, но упаковка помялась при доставке. Товар не пострадал."),
    (3.0, "Размер оказался меньше, чем на фото. Стоит указать точнее в карточке."),
    (5.0, "Отличный товар, рекомендую. Продавец ответил на вопрос за час."),
    (2.0, "Пришёл с царапиной, оформил возврат. Деньги вернули быстро."),
    (4.0, "В целом доволен, но хотелось бы больше расцветок."),
]


def _noise(*parts: object) -> float:
    """Псевдослучайное число [0;1) — детерминированное для одинаковых входов."""
    raw = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def _day_factor(day: date) -> float:
    """Недельная сезонность: пик в выходные, провал во вторник-среду."""
    weekday_weights = [0.96, 0.88, 0.90, 1.00, 1.12, 1.24, 1.10]
    return weekday_weights[day.weekday()]


def _trend(day: date) -> float:
    """Плавный сезонный тренд по дню года."""
    return 1.0 + 0.12 * math.sin((day.timetuple().tm_yday / 365) * 2 * math.pi)


class DemoConnector(MarketplaceConnector):
    """Генератор правдоподобных данных для одной площадки."""

    def __init__(self, code: str, title: str, credentials=None) -> None:  # type: ignore[no-untyped-def]
        super().__init__(credentials)  # type: ignore[arg-type]
        self.code = code
        self.title = title

    @property
    def configured(self) -> bool:
        return False

    async def fetch(self, period: Period) -> MarketplaceReport:
        return self.build(period)

    def build(self, period: Period, *, note: str = "") -> MarketplaceReport:
        profile = PROFILES.get(self.code, PROFILES["wildberries"])
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=False,
            demo=True,
            error=note,
        )

        base_orders = 118 * profile["scale"]
        for day in period.each_day():
            wobble = 0.82 + 0.36 * _noise(self.code, day.isoformat())
            orders = max(1, round(base_orders * _day_factor(day) * _trend(day) * wobble))
            check = profile["check"] * (0.92 + 0.16 * _noise(self.code, "check", day))
            units = round(orders * (1.08 + 0.25 * _noise(self.code, "units", day)))
            returns = round(orders * (0.04 + 0.05 * _noise(self.code, "ret", day)))
            report.series.append(
                DayPoint(
                    day=day,
                    revenue=orders * check,
                    orders=orders,
                    units=units,
                    returns=returns,
                )
            )

        report.revenue = sum(point.revenue for point in report.series)
        report.orders = sum(point.orders for point in report.series)
        report.units = sum(point.units for point in report.series)
        report.returns = sum(point.returns for point in report.series)
        report.cancellations = round(report.orders * 0.03)
        report.buyouts = round(report.orders * profile["buyout"])

        report.commission = report.revenue * (0.155 + 0.03 * _noise(self.code, "comm"))
        report.logistics = report.revenue * (0.061 + 0.02 * _noise(self.code, "log"))
        report.ad_spend = report.revenue * profile["ad"]
        report.cost_price = report.revenue * (0.42 + 0.06 * _noise(self.code, "cost"))

        report.rating = round(profile["rating"] - 0.15 * _noise(self.code, "rating"), 2)
        report.reviews_count = round(report.orders * 0.11)
        report.products = self._products(report, period)
        report.stock_units = sum(product.stock for product in report.products)
        report.stock_alerts = self._stock_alerts(report, period)
        report.regions = self._regions(report)
        report.reviews = self._reviews(period)
        report.funnel = self._funnel(report)
        return report

    def _products(self, report: MarketplaceReport, period: Period) -> list[Product]:
        weights = [1 / (index + 1.35) for index in range(len(CATALOG))]
        total_weight = sum(weights)
        products: list[Product] = []
        for index, (sku, name) in enumerate(CATALOG):
            share = weights[index] / total_weight * (0.85 + 0.3 * _noise(self.code, sku))
            revenue = report.revenue * share
            units = max(1, round(report.units * share))
            # Остаток задаём через запас в днях — так часть товаров честно
            # попадает в блок «заканчиваются остатки».
            per_day = units / max(period.days, 1)
            cover_days = 2.0 + 46.0 * _noise(self.code, sku, "cover")
            products.append(
                Product(
                    sku=sku,
                    name=name,
                    revenue=revenue,
                    units=units,
                    stock=max(0, round(per_day * cover_days)),
                    returns=round(units * (0.03 + 0.06 * _noise(self.code, sku, "ret"))),
                    rating=round(4.2 + 0.8 * _noise(self.code, sku, "rating"), 1),
                    marketplace=self.code,
                )
            )
        products.sort(key=lambda item: item.revenue, reverse=True)
        return products

    def _stock_alerts(self, report: MarketplaceReport, period: Period) -> list[StockAlert]:
        warehouses = ["Коледино", "Хоругвино", "Казань", "Екатеринбург", "Софьино"]
        alerts: list[StockAlert] = []
        for product in report.products:
            per_day = product.units / max(period.days, 1)
            days_left = product.stock / per_day if per_day else 99.0
            if days_left <= 12:
                warehouse = warehouses[int(_noise(self.code, product.sku, "wh") * len(warehouses))]
                alerts.append(
                    StockAlert(
                        sku=product.sku,
                        name=product.name,
                        stock=product.stock,
                        days_left=days_left,
                        marketplace=self.code,
                        warehouse=warehouse,
                    )
                )
        alerts.sort(key=lambda item: item.days_left)
        return alerts[:8]

    def _regions(self, report: MarketplaceReport) -> list[RegionSales]:
        regions: list[RegionSales] = []
        for name, share in REGIONS:
            adjusted = share * (0.9 + 0.2 * _noise(self.code, name))
            regions.append(
                RegionSales(
                    region=name,
                    revenue=report.revenue * adjusted,
                    orders=round(report.orders * adjusted),
                )
            )
        regions.sort(key=lambda item: item.revenue, reverse=True)
        return regions

    def _reviews(self, period: Period) -> list[Review]:
        # Каждая площадка начинает список с своего места и ставит отзывы
        # на свои даты — иначе в общей ленте четыре раза подряд шёл бы
        # один и тот же текст.
        offset = int(_noise(self.code, "rev-offset") * len(REVIEW_TEXTS))
        reviews: list[Review] = []
        for index in range(len(REVIEW_TEXTS)):
            rating, text = REVIEW_TEXTS[(index + offset) % len(REVIEW_TEXTS)]
            sku, name = CATALOG[int(_noise(self.code, "rev", index) * len(CATALOG))]
            day = period.date_to.toordinal() - index * 3 - offset
            reviews.append(
                Review(
                    sku=sku,
                    name=name,
                    rating=rating,
                    text=text,
                    created_at=date.fromordinal(max(day, period.date_from.toordinal())).isoformat(),
                    marketplace=self.code,
                )
            )
        return reviews

    def _funnel(self, report: MarketplaceReport) -> Funnel:
        card_views = round(report.orders * (24 + 12 * _noise(self.code, "views")))
        return Funnel(
            impressions=round(card_views * (7.5 + 2.5 * _noise(self.code, "imp"))),
            card_views=card_views,
            cart_adds=round(report.orders * (2.4 + 0.8 * _noise(self.code, "cart"))),
            orders=report.orders,
            buyouts=report.buyouts,
        )
