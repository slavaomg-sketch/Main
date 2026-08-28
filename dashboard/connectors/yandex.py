"""Яндекс Маркет — Partner API.

Документация: https://yandex.ru/dev/market/partner-api
Используются `/campaigns/{campaignId}/stats/orders` (заказы за период,
постранично) и `/campaigns/{campaignId}/offers/stocks` (остатки).
Авторизация — заголовок `Api-Key`.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from ..models import (
    DayPoint,
    Funnel,
    MarketplaceReport,
    Period,
    Product,
    RegionSales,
    StockAlert,
)
from .base import HttpConnector
from .dates import parse_day

FALLBACK_COMMISSION = 0.13
FALLBACK_LOGISTICS = 0.055
MAX_PAGES = 20


class YandexConnector(HttpConnector):
    code = "yandex"
    title = "Яндекс Маркет"
    base_url = "https://api.partner.market.yandex.ru"

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Api-Key": self.credentials.get("api_key"),
        }

    @property
    def campaign_id(self) -> str:
        return self.credentials.get("campaign_id")

    async def fetch(self, period: Period) -> MarketplaceReport:
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=True,
            demo=False,
        )
        async with self.client() as client:
            orders = await self._orders(client, period)
            stocks = await self._stocks(client)

        self._apply_orders(report, orders, period)
        self._apply_stocks(report, stocks, period)

        if not report.commission:
            report.commission = report.revenue * FALLBACK_COMMISSION
        report.logistics = report.revenue * FALLBACK_LOGISTICS
        return report

    async def _orders(self, client, period: Period) -> list[dict[str, Any]]:
        path = f"/campaigns/{self.campaign_id}/stats/orders"
        payload = {
            "dateFrom": period.date_from.isoformat(),
            "dateTo": period.date_to.isoformat(),
        }
        collected: list[dict[str, Any]] = []
        page_token = ""
        for _ in range(MAX_PAGES):
            params = {"limit": 200}
            if page_token:
                params["page_token"] = page_token
            response = await client.post(path, json=payload, params=params)
            response.raise_for_status()
            body = response.json()
            result = body.get("result") if isinstance(body, dict) else {}
            collected.extend(self.as_list(result, "orders"))
            paging = result.get("paging") if isinstance(result, dict) else None
            page_token = str(paging.get("nextPageToken") or "") if isinstance(paging, dict) else ""
            if not page_token:
                break
        return collected

    async def _stocks(self, client) -> list[dict[str, Any]]:
        path = f"/campaigns/{self.campaign_id}/offers/stocks"
        response = await client.post(path, json={})
        response.raise_for_status()
        body = response.json()
        result = body.get("result") if isinstance(body, dict) else {}
        offers: list[dict[str, Any]] = []
        for warehouse in self.as_list(result, "warehouses"):
            for offer in self.as_list(warehouse, "offers"):
                offer = dict(offer)
                offer["_warehouse"] = warehouse.get("name") or warehouse.get("warehouseId")
                offers.append(offer)
        return offers

    def _apply_orders(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        by_day: dict[date, DayPoint] = {}
        by_sku: dict[str, Product] = {}
        by_region: dict[str, RegionSales] = defaultdict(lambda: RegionSales(region=""))

        for row in rows:
            day = parse_day(row.get("creationDate") or row.get("statusUpdateDate"))
            if not day or not (period.date_from <= day <= period.date_to):
                continue

            status = str(row.get("status") or "").upper()
            if status in {"CANCELLED", "CANCELED"}:
                report.cancellations += 1
                continue

            point = by_day.setdefault(day, DayPoint(day=day))
            point.orders += 1
            report.orders += 1
            if status == "DELIVERED":
                report.buyouts += 1

            order_revenue = 0.0
            for item in self.as_list(row, "items"):
                count = self.to_int(item.get("count"), 1)
                price = self.to_float(item.get("price") or item.get("bidFee"))
                amount = price * count
                order_revenue += amount
                point.units += count
                report.units += count

                sku = str(item.get("shopSku") or item.get("marketSku") or "—")
                product = by_sku.setdefault(
                    sku,
                    Product(sku=sku, name=str(item.get("offerName") or sku), marketplace=self.code),
                )
                product.revenue += amount
                product.units += count

                for commission in self.as_list(item, "commissions"):
                    report.commission += self.to_float(commission.get("actual"))

            if not order_revenue:
                order_revenue = self.to_float(row.get("total") or row.get("itemsTotal"))
            point.revenue += order_revenue
            report.revenue += order_revenue

            delivery = row.get("delivery") if isinstance(row.get("delivery"), dict) else {}
            region_block = delivery.get("region") if isinstance(delivery, dict) else None
            region_name = "Не указан"
            if isinstance(region_block, dict):
                region_name = str(region_block.get("name") or region_name)
            region = by_region[region_name]
            region.region = region_name
            region.revenue += order_revenue
            region.orders += 1

        report.series = [by_day.get(day, DayPoint(day=day)) for day in period.each_day()]
        report.products = sorted(by_sku.values(), key=lambda item: item.revenue, reverse=True)[:20]
        report.regions = sorted(by_region.values(), key=lambda item: item.revenue, reverse=True)
        report.funnel = Funnel(orders=report.orders, buyouts=report.buyouts or report.orders)

    def _apply_stocks(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        stock_by_sku: dict[str, int] = defaultdict(int)
        warehouse_by_sku: dict[str, str] = {}
        for row in rows:
            sku = str(row.get("shopSku") or row.get("offerId") or "—")
            available = 0
            for stock in self.as_list(row, "stocks"):
                if str(stock.get("type") or "").upper() in {"AVAILABLE", "FIT"}:
                    available += self.to_int(stock.get("count"))
            stock_by_sku[sku] += available
            report.stock_units += available
            warehouse_by_sku.setdefault(sku, str(row.get("_warehouse") or ""))

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
                        warehouse=warehouse_by_sku.get(product.sku, ""),
                    )
                )
        report.stock_alerts = sorted(alerts, key=lambda item: item.days_left)[:8]
