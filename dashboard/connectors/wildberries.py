"""Wildberries — Statistics API.

Документация: https://openapi.wildberries.ru
Используются методы `supplier/sales`, `supplier/orders`, `supplier/stocks`.
Токен передаётся заголовком `Authorization`.

Статистика WB отдаёт «сырые» строки продаж от даты `dateFrom`, поэтому
фильтрация по правой границе периода делается на нашей стороне.
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
from .base import HttpConnector, Probe
from .dates import parse_day

# Ставки, по которым считается юнит-экономика, если API их не отдал.
FALLBACK_COMMISSION = 0.17
FALLBACK_LOGISTICS = 0.065


class WildberriesConnector(HttpConnector):
    code = "wildberries"
    title = "Wildberries"
    base_url = "https://statistics-api.wildberries.ru"

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": self.credentials.get("token"),
        }

    async def fetch(self, period: Period) -> MarketplaceReport:
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=True,
            demo=False,
        )
        date_from = f"{period.date_from.isoformat()}T00:00:00"

        async with self.client() as client:
            sales = await self._get(client, "/api/v1/supplier/sales", {"dateFrom": date_from})
            orders = await self._get(client, "/api/v1/supplier/orders", {"dateFrom": date_from})
            stocks = await self._get(client, "/api/v1/supplier/stocks", {"dateFrom": date_from})

        self._apply_sales(report, sales, period)
        self._apply_orders(report, orders, period)
        self._apply_stocks(report, stocks, period)
        return report

    async def probe(self, period: Period) -> list[Probe]:
        date_from = f"{period.date_from.isoformat()}T00:00:00"
        async with self.client() as client:
            return [
                await self.capture(
                    "GET /api/v1/supplier/sales",
                    lambda: self._get(client, "/api/v1/supplier/sales", {"dateFrom": date_from}),
                ),
                await self.capture(
                    "GET /api/v1/supplier/orders",
                    lambda: self._get(client, "/api/v1/supplier/orders", {"dateFrom": date_from}),
                ),
                await self.capture(
                    "GET /api/v1/supplier/stocks",
                    lambda: self._get(client, "/api/v1/supplier/stocks", {"dateFrom": date_from}),
                ),
            ]

    async def _get(self, client, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        response = await client.get(path, params=params)
        response.raise_for_status()
        return self.as_list(response.json(), "data", "result")

    # --- продажи: выручка, возвраты, регионы, товары -------------------------

    def _apply_sales(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        by_day: dict[date, DayPoint] = {}
        by_sku: dict[str, Product] = {}
        by_region: dict[str, RegionSales] = defaultdict(lambda: RegionSales(region=""))

        for row in rows:
            day = parse_day(row.get("date") or row.get("lastChangeDate"))
            if not day or not (period.date_from <= day <= period.date_to):
                continue

            # saleID начинается с "S" у продажи и с "R" у возврата.
            sale_id = str(row.get("saleID") or "")
            is_return = sale_id.startswith("R") or self.to_float(row.get("finishedPrice")) < 0
            amount = abs(self.to_float(row.get("finishedPrice") or row.get("totalPrice")))
            for_pay = abs(self.to_float(row.get("forPay")))

            point = by_day.setdefault(day, DayPoint(day=day))
            if is_return:
                point.returns += 1
                report.returns += 1
                continue

            point.revenue += amount
            point.units += 1
            report.revenue += amount
            report.units += 1
            report.buyouts += 1
            if for_pay:
                report.commission += max(amount - for_pay, 0.0)

            sku = str(row.get("supplierArticle") or row.get("nmId") or "—")
            product = by_sku.setdefault(
                sku,
                Product(
                    sku=sku,
                    name=str(row.get("subject") or row.get("brand") or sku),
                    marketplace=self.code,
                ),
            )
            product.revenue += amount
            product.units += 1

            region_name = str(row.get("regionName") or row.get("oblastOkrugName") or "Не указан")
            region = by_region[region_name]
            region.region = region_name
            region.revenue += amount
            region.orders += 1

        report.series = [by_day.get(day, DayPoint(day=day)) for day in period.each_day()]
        report.products = sorted(by_sku.values(), key=lambda item: item.revenue, reverse=True)[:20]
        report.regions = sorted(by_region.values(), key=lambda item: item.revenue, reverse=True)

        if not report.commission:
            report.commission = report.revenue * FALLBACK_COMMISSION
        report.logistics = report.revenue * FALLBACK_LOGISTICS

    # --- заказы: количество, отмены, воронка --------------------------------

    def _apply_orders(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        orders_by_day: dict[date, int] = defaultdict(int)
        for row in rows:
            day = parse_day(row.get("date") or row.get("lastChangeDate"))
            if not day or not (period.date_from <= day <= period.date_to):
                continue
            if row.get("isCancel"):
                report.cancellations += 1
                continue
            orders_by_day[day] += 1
            report.orders += 1

        for point in report.series:
            point.orders = orders_by_day.get(point.day, 0)

        report.funnel = Funnel(orders=report.orders, buyouts=report.buyouts)

    # --- остатки -------------------------------------------------------------

    def _apply_stocks(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        stock_by_sku: dict[str, int] = defaultdict(int)
        warehouse_by_sku: dict[str, str] = {}
        for row in rows:
            quantity = self.to_int(row.get("quantity"))
            sku = str(row.get("supplierArticle") or row.get("nmId") or "—")
            stock_by_sku[sku] += quantity
            report.stock_units += quantity
            warehouse_by_sku.setdefault(sku, str(row.get("warehouseName") or ""))

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
