"""Ozon — Seller API.

Документация: https://docs.ozon.ru/api/seller
Используются `/v1/analytics/data` (динамика по дням и по SKU) и
`/v3/product/info/stocks` (остатки). Авторизация — заголовки
`Client-Id` и `Api-Key`.
"""

from __future__ import annotations

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
from .base import HttpConnector

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
        response = await client.post("/v1/analytics/data", json=payload)
        response.raise_for_status()
        body = response.json()
        result = body.get("result") if isinstance(body, dict) else None
        if isinstance(result, dict):
            return self.as_list(result, "data")
        return self.as_list(body, "data", "result")

    async def _stocks(self, client) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        last_id = ""
        for _ in range(10):  # страховка от бесконечной пагинации
            payload = {"filter": {"visibility": "ALL"}, "last_id": last_id, "limit": 1000}
            response = await client.post("/v3/product/info/stocks", json=payload)
            response.raise_for_status()
            body = response.json()
            result = body.get("result") if isinstance(body, dict) else {}
            page = self.as_list(result, "items")
            items.extend(page)
            last_id = str(result.get("last_id") or "") if isinstance(result, dict) else ""
            if not last_id or not page:
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
