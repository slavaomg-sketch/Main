"""AliExpress — Open Platform (шлюз /sync).

Документация: https://openservice.aliexpress.com
Запрос подписывается HMAC-SHA256: системные и бизнес-параметры сортируются
по имени, склеиваются как `ключзначение` и подписываются секретом приложения.

Методы: `aliexpress.solution.order.get` (заказы за период) и
`aliexpress.solution.product.list.get` (товары и остатки).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from collections import defaultdict
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
from .base import HttpConnector, Probe
from .dates import parse_day

FALLBACK_COMMISSION = 0.08
FALLBACK_LOGISTICS = 0.09
MAX_PAGES = 10
PAGE_SIZE = 50


class AliExpressConnector(HttpConnector):
    code = "ali"
    title = "AliExpress"
    base_url = "https://api-sg.aliexpress.com"

    def headers(self) -> dict[str, str]:
        return {"Accept": "application/json"}

    def sign(self, params: dict[str, str]) -> str:
        """Подпись запроса: HMAC-SHA256 от склеенных отсортированных пар."""
        payload = "".join(f"{key}{params[key]}" for key in sorted(params))
        digest = hmac.new(
            self.credentials.get("app_secret").encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return digest.upper()

    async def call(self, client, method: str, business: dict[str, Any]) -> dict[str, Any]:
        params: dict[str, str] = {
            "app_key": self.credentials.get("app_key"),
            "method": method,
            "session": self.credentials.get("access_token"),
            "timestamp": str(int(time.time() * 1000)),
            "sign_method": "sha256",
            "format": "json",
            "v": "2.0",
        }
        for key, value in business.items():
            params[key] = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        params["sign"] = self.sign(params)

        response = await client.post("/sync", data=params)
        response.raise_for_status()
        body = response.json()
        if isinstance(body, dict) and body.get("error_response"):
            error = body["error_response"]
            message = error.get("msg") or error.get("sub_msg") or "ошибка AliExpress"
            raise RuntimeError(f"AliExpress: {message}")
        return body if isinstance(body, dict) else {}

    async def fetch(self, period: Period) -> MarketplaceReport:
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=True,
            demo=False,
        )
        async with self.client() as client:
            orders = await self._orders(client, period)
            products = await self._products(client)

        self._apply_orders(report, orders, period)
        self._apply_products(report, products, period)

        if not report.commission:
            report.commission = report.revenue * FALLBACK_COMMISSION
        report.logistics = report.revenue * FALLBACK_LOGISTICS
        return report

    async def probe(self, period: Period) -> list[Probe]:
        async with self.client() as client:
            return [
                await self.capture(
                    "POST /sync aliexpress.solution.order.get",
                    lambda: self._orders(client, period),
                ),
                await self.capture(
                    "POST /sync aliexpress.solution.product.list.get",
                    lambda: self._products(client),
                ),
            ]

    async def _orders(self, client, period: Period) -> list[dict[str, Any]]:
        collected: list[dict[str, Any]] = []
        for page in range(1, MAX_PAGES + 1):
            query = {
                "create_date_start": f"{period.date_from.isoformat()} 00:00:00",
                "create_date_end": f"{period.date_to.isoformat()} 23:59:59",
                "page_size": PAGE_SIZE,
                "current_page": page,
            }
            body = await self.call(
                client,
                "aliexpress.solution.order.get",
                {"param_aeop_order_query": query},
            )
            rows = self._unwrap(body, "target_list", "orders", "order_dto_list")
            collected.extend(rows)
            if len(rows) < PAGE_SIZE:
                break
        return collected

    async def _products(self, client) -> list[dict[str, Any]]:
        body = await self.call(
            client,
            "aliexpress.solution.product.list.get",
            {
                "aeop_a_e_product_list_query": {
                    "current_page": 1,
                    "page_size": PAGE_SIZE,
                    "product_status_type": "onSelling",
                }
            },
        )
        return self._unwrap(body, "aeop_a_e_product_display_dto_list", "products", "target_list")

    def _unwrap(self, body: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
        """Ответы AliExpress вложены на разную глубину — ищем список рекурсивно."""
        stack: list[Any] = [body]
        seen = 0
        while stack and seen < 200:
            seen += 1
            node = stack.pop()
            if isinstance(node, dict):
                for key in keys:
                    value = node.get(key)
                    if isinstance(value, list) and value:
                        return [item for item in value if isinstance(item, dict)]
                    if isinstance(value, dict):
                        stack.append(value)
                stack.extend(node.values())
        return []

    def _apply_orders(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        by_day: dict[date, DayPoint] = {}
        by_sku: dict[str, Product] = {}

        for row in rows:
            day = parse_day(row.get("gmt_create") or row.get("create_date"))
            if not day or not (period.date_from <= day <= period.date_to):
                continue

            status = str(row.get("order_status") or "").upper()
            if "CANCEL" in status or "CLOSED" in status:
                report.cancellations += 1
                continue

            amount = self.to_float(
                (row.get("order_amount") or {}).get("amount")
                if isinstance(row.get("order_amount"), dict)
                else row.get("order_amount")
            )
            point = by_day.setdefault(day, DayPoint(day=day))
            point.orders += 1
            point.revenue += amount
            report.orders += 1
            report.revenue += amount
            if "FINISH" in status or "DELIVER" in status:
                report.buyouts += 1

            for item in self._unwrap(row, "child_order_list", "product_list", "item_list"):
                count = self.to_int(item.get("product_count"), 1)
                sku = str(item.get("product_id") or item.get("sku_code") or "—")
                product = by_sku.setdefault(
                    sku,
                    Product(
                        sku=sku,
                        name=str(item.get("product_name") or sku),
                        marketplace=self.code,
                    ),
                )
                product.units += count
                product.revenue += self.to_float(item.get("total_product_amount")) or amount
                point.units += count
                report.units += count

        if not report.units:
            report.units = report.orders

        report.series = [by_day.get(day, DayPoint(day=day)) for day in period.each_day()]
        report.products = sorted(by_sku.values(), key=lambda item: item.revenue, reverse=True)[:20]
        report.funnel = Funnel(orders=report.orders, buyouts=report.buyouts or report.orders)

    def _apply_products(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        stock_by_sku: dict[str, int] = defaultdict(int)
        names: dict[str, str] = {}
        for row in rows:
            sku = str(row.get("product_id") or row.get("id") or "—")
            quantity = self.to_int(row.get("product_unit") or row.get("ipm_sku_stock"))
            for variant in self._unwrap(row, "aeop_ae_product_s_k_us", "sku_list"):
                quantity += self.to_int(variant.get("ipm_sku_stock") or variant.get("sku_stock"))
            stock_by_sku[sku] += quantity
            report.stock_units += quantity
            names[sku] = str(row.get("subject") or row.get("product_name") or sku)

        alerts: list[StockAlert] = []
        for product in report.products:
            product.stock = stock_by_sku.get(product.sku, 0)
            per_day = product.units / max(period.days, 1)
            days_left = product.stock / per_day if per_day else 0.0
            if per_day and days_left <= 12:
                alerts.append(
                    StockAlert(
                        sku=product.sku,
                        name=product.name or names.get(product.sku, product.sku),
                        stock=product.stock,
                        days_left=days_left,
                        marketplace=self.code,
                    )
                )
        report.stock_alerts = sorted(alerts, key=lambda item: item.days_left)[:8]
