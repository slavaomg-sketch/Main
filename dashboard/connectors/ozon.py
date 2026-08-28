"""Ozon — Seller API.

Документация: https://docs.ozon.ru/api/seller
Используются `/v1/analytics/data` (динамика по дням и по SKU) и
`/v4/product/info/stocks` (остатки). Авторизация — заголовки
`Client-Id` и `Api-Key`.

Два обстоятельства определяют устройство коннектора:

* **Лимит частоты.** Ozon пускает к Seller API пару запросов в секунду на
  весь ключ, а панель за один заход делает три. Без паузы второй запрос
  отвечает `429 rate limit exceeded`, и половина отчёта теряется.
* **Версии методов.** Остатки жили по адресу `/v3/product/info/stocks`,
  который Ozon отключил — он отвечает `404 page not found`. В четвёртой
  версии изменился и способ листать страницы: вместо `last_id` курсор,
  и `items` лежат в корне ответа, а не внутри `result`.
"""

from __future__ import annotations

import hashlib
from datetime import date
from typing import Any

from ..models import (
    DayPoint,
    Funnel,
    MarketplaceReport,
    Period,
    Product,
    StockAlert,
)
from .base import HttpConnector, Probe, Throttle

DAY_METRICS = [
    "revenue",
    "ordered_units",
    "returns",
    "cancellations",
    "hits_view_pdp",
    "hits_tocart_pdp",
    "delivered_units",
]
SKU_METRICS = ["revenue", "ordered_units", "returns"]

FALLBACK_COMMISSION = 0.15
FALLBACK_LOGISTICS = 0.075

# Пауза между обращениями к Seller API одним ключом. Ozon сообщает
# «current max rate per sec.: 2», но аналитика тяжёлая — берём с запасом.
REQUEST_INTERVAL = 1.5

# Сколько готовы ждать, если площадка всё же просит сбавить темп.
PATIENCE = 12.0


class OzonConnector(HttpConnector):
    code = "ozon"
    title = "Ozon"
    base_url = "https://api-seller.ozon.ru"

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Client-Id": self.credentials.get("client_id"),
            "Api-Key": self.credentials.get("api_key"),
        }

    async def fetch(self, period: Period) -> MarketplaceReport:
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=True,
            demo=False,
        )
        async with self.client() as client:
            days = await self._analytics(client, period, ["day"], DAY_METRICS)
            skus = await self._analytics(client, period, ["sku"], SKU_METRICS, limit=50)
            stocks = await self._stocks(client)

        self._apply_days(report, days, period)
        self._apply_skus(report, skus)
        self._apply_stocks(report, stocks, period)

        if not report.commission:
            report.commission = report.revenue * FALLBACK_COMMISSION
        report.logistics = report.revenue * FALLBACK_LOGISTICS
        return report

    async def probe(self, period: Period) -> list[Probe]:
        async with self.client() as client:
            return [
                await self.capture(
                    "POST /v1/analytics/data (dimension=day)",
                    lambda: self._analytics(client, period, ["day"], DAY_METRICS),
                ),
                await self.capture(
                    "POST /v1/analytics/data (dimension=sku)",
                    lambda: self._analytics(client, period, ["sku"], SKU_METRICS, limit=50),
                ),
                await self.capture(
                    "POST /v4/product/info/stocks",
                    lambda: self._stocks(client),
                ),
            ]

    def _key(self) -> str:
        """Короткий отпечаток ключа — общий ограничитель на все методы Ozon."""
        raw = str(self.credentials.get("client_id") or "")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _post(self, client, path: str, payload: dict[str, Any]):
        """Запрос к Seller API с общей паузой между обращениями."""

        async def call():
            return await client.post(path, json=payload)

        response = await Throttle.run(
            f"ozon:{self._key()}", REQUEST_INTERVAL, call, max_wait=PATIENCE
        )
        response.raise_for_status()
        return response

    async def _analytics(
        self,
        client,
        period: Period,
        dimension: list[str],
        metrics: list[str],
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        payload = {
            "date_from": period.date_from.isoformat(),
            "date_to": period.date_to.isoformat(),
            "metrics": metrics,
            "dimension": dimension,
            "limit": limit,
            "offset": 0,
        }
        response = await self._post(client, "/v1/analytics/data", payload)
        body = response.json()
        result = body.get("result") if isinstance(body, dict) else None
        if isinstance(result, dict):
            return self.as_list(result, "data")
        return self.as_list(body, "data", "result")

    async def _stocks(self, client) -> list[dict[str, Any]]:
        """Остатки постранично: в четвёртой версии метода — курсором."""
        items: list[dict[str, Any]] = []
        cursor = ""

        for _ in range(10):  # страховка от бесконечной пагинации
            payload: dict[str, Any] = {"filter": {}, "limit": 1000}
            if cursor:
                payload["cursor"] = cursor

            response = await self._post(client, "/v4/product/info/stocks", payload)
            body = response.json() if isinstance(response.json(), dict) else {}

            # Ответ отдаётся в корне, но старые ключи тоже поддержим:
            # площадка не раз переносила их туда и обратно.
            source = body if "items" in body else (body.get("result") or {})
            page = self.as_list(source, "items")
            items.extend(page)

            cursor = str(source.get("cursor") or "") if isinstance(source, dict) else ""
            if not cursor or not page:
                break

        return items

    @staticmethod
    def _metric(row: dict[str, Any], metrics: list[str], name: str) -> float:
        values = row.get("metrics")
        if not isinstance(values, list) or name not in metrics:
            return 0.0
        index = metrics.index(name)
        if index >= len(values):
            return 0.0
        try:
            return float(values[index] or 0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _dimension(row: dict[str, Any], index: int = 0) -> dict[str, Any]:
        dims = row.get("dimensions")
        if isinstance(dims, list) and len(dims) > index and isinstance(dims[index], dict):
            return dims[index]
        return {}

    def _apply_days(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        by_day: dict[date, DayPoint] = {}
        card_views = 0.0
        cart_adds = 0.0

        for row in rows:
            raw_day = self._dimension(row).get("id") or self._dimension(row).get("name")
            try:
                day = date.fromisoformat(str(raw_day)[:10])
            except (TypeError, ValueError):
                continue
            if not (period.date_from <= day <= period.date_to):
                continue

            revenue = self._metric(row, DAY_METRICS, "revenue")
            units = self._metric(row, DAY_METRICS, "ordered_units")
            returns = self._metric(row, DAY_METRICS, "returns")

            by_day[day] = DayPoint(
                day=day,
                revenue=revenue,
                orders=int(units),
                units=int(units),
                returns=int(returns),
            )
            report.revenue += revenue
            report.units += int(units)
            report.orders += int(units)
            report.returns += int(returns)
            report.cancellations += int(self._metric(row, DAY_METRICS, "cancellations"))
            report.buyouts += int(self._metric(row, DAY_METRICS, "delivered_units"))
            card_views += self._metric(row, DAY_METRICS, "hits_view_pdp")
            cart_adds += self._metric(row, DAY_METRICS, "hits_tocart_pdp")

        report.series = [by_day.get(day, DayPoint(day=day)) for day in period.each_day()]
        report.funnel = Funnel(
            impressions=int(card_views * 8),
            card_views=int(card_views),
            cart_adds=int(cart_adds),
            orders=report.orders,
            buyouts=report.buyouts or report.orders,
        )

    def _apply_skus(self, report: MarketplaceReport, rows: list[dict[str, Any]]) -> None:
        products: list[Product] = []
        for row in rows:
            dimension = self._dimension(row)
            sku = str(dimension.get("id") or "—")
            products.append(
                Product(
                    sku=sku,
                    name=str(dimension.get("name") or sku),
                    revenue=self._metric(row, SKU_METRICS, "revenue"),
                    units=int(self._metric(row, SKU_METRICS, "ordered_units")),
                    returns=int(self._metric(row, SKU_METRICS, "returns")),
                    marketplace=self.code,
                )
            )
        report.products = sorted(products, key=lambda item: item.revenue, reverse=True)[:20]

    def _apply_stocks(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        stock_by_sku: dict[str, int] = {}
        for row in rows:
            present = 0
            for stock in self.as_list(row, "stocks"):
                present += self.to_int(stock.get("present"))
            key = str(row.get("offer_id") or row.get("product_id") or "")
            stock_by_sku[key] = stock_by_sku.get(key, 0) + present
            stock_by_sku[str(row.get("product_id") or "")] = present
            report.stock_units += present

        alerts: list[StockAlert] = []
        for product in report.products:
            product.stock = stock_by_sku.get(product.sku, 0)
            per_day = product.units / max(period.days, 1)
            days_left = product.stock / per_day if per_day else 0.0
            if per_day and days_left <= 12:
                alerts.append(
                    StockAlert(
                        sku=product.sku,
                        name=product.name,
                        stock=product.stock,
                        days_left=days_left,
                        marketplace=self.code,
                    )
                )
        report.stock_alerts = sorted(alerts, key=lambda item: item.days_left)[:8]
