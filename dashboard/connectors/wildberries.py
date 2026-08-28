"""Wildberries — Statistics API и Analytics API.

Документация: https://dev.wildberries.ru

Продажи и заказы берутся из статистики (`statistics-api.wildberries.ru`),
остатки — из аналитики (`seller-analytics-api.wildberries.ru`): старый метод
`supplier/stocks` Wildberries отключил, вместо него теперь
`POST /api/analytics/v1/stocks-report/wb-warehouses`.

Глубина у этих источников разная, и это определяет устройство отчёта:

* **Статистика** отвечает быстро и в реальном времени, но хранится около
  полугода. Из неё берутся свежие дни: сегодня, вчера, неделя, месяц.
* **Отчёт реализации** (`finance-api.wildberries.ru`) хранится с 29 января
  2024 года — именно из него приложение Wildberries показывает год. Он же
  даёт точную сумму «К перечислению». Взамен площадка пускает к нему раз в
  минуту, поэтому он качается только в фоне и только на ту глубину, до
  которой статистика уже не достаёт.

Токен передаётся заголовком `Authorization`. Для остатков в токене нужна
категория «Аналитика» — если её нет, площадка ответит 401/403, и панель
покажет это отдельным предупреждением, не теряя продажи и заказы.

Два обстоятельства определяют устройство этого коннектора:

* **Лимит частоты.** К статистике WB пускает примерно раз в минуту на метод.
  Панель же за один заход считает текущий период и прошлый — это было бы два
  обращения подряд. Поэтому ответы кэшируются: статистика отдаёт всё от даты
  `dateFrom`, значит ответ за прошлый период содержит и текущий, и второй
  запрос не нужен.
* **Частичные сбои.** Если остатки недоступны, а заказы пришли — отчёт всё
  равно должен показывать заказы. Каждая ручка обрабатывается отдельно.
"""

from __future__ import annotations

import hashlib
import time
from collections import defaultdict
from datetime import date
from typing import Any

import httpx

from ..config import settings
from ..models import (
    DayPoint,
    Funnel,
    MarketplaceReport,
    Period,
    Product,
    RegionSales,
    StockAlert,
)
from .base import HttpConnector, Probe, RateLimited, Throttle
from .dates import parse_moment

# Ставки, по которым считается юнит-экономика, если API их не отдал.
FALLBACK_COMMISSION = 0.17
FALLBACK_LOGISTICS = 0.065

STATISTICS_URL = "https://statistics-api.wildberries.ru"
ANALYTICS_URL = "https://seller-analytics-api.wildberries.ru"
FINANCE_URL = "https://finance-api.wildberries.ru"

SALES_PATH = "/api/v1/supplier/sales"
ORDERS_PATH = "/api/v1/supplier/orders"
STOCKS_PATH = "/api/analytics/v1/stocks-report/wb-warehouses"
FINANCE_PATH = "/api/finance/v1/sales-reports/detailed"

# Пауза между обращениями к одному методу одним токеном.
STATISTICS_INTERVAL = 20.0
ANALYTICS_INTERVAL = 20.0

# Сколько держать ответ статистики, чтобы не ходить за ним дважды подряд.
RESPONSE_TTL = 150.0

# Сколько готовы ждать, если площадка просит сбавить темп.
# Фоновой выгрузке спешить некуда, а вот кнопка «Проверить связь» должна
# отвечать быстро — поэтому терпение задаётся вызывающей стороной.
PATIENCE_INTERACTIVE = 10.0
PATIENCE_BACKGROUND = 120.0

STOCKS_PAGE = 100_000

# Отчёт реализации: площадка пускает к нему раз в минуту на аккаунт,
# поэтому пауза и терпение здесь свои, гораздо большие.
FINANCE_INTERVAL = 65.0
FINANCE_PATIENCE = 200.0
FINANCE_PAGE = 50_000
# Страница отчёта за несколько месяцев весит десятки мегабайт — обычного
# таймаута панели на неё не хватает.
FINANCE_TIMEOUT = 300.0
# Предохранитель: сколько страниц готовы выкачать за один заход. Если
# истории оказалось больше, следующая выгрузка продолжит с того же места.
FINANCE_PAGES = 12

# Раньше этой даты Wildberries детализацию отчётов реализации не отдаёт.
FINANCE_SINCE = date(2024, 1, 29)

# Просим только нужные колонки: полная строка отчёта — это под сотню полей,
# а строк за год набегают сотни тысяч.
FINANCE_FIELDS = (
    "rrdId",
    "rrDate",
    "saleDt",
    "docTypeName",
    "quantity",
    # Цены и выручка
    "retailPrice",
    "retailPriceWithDisc",
    "retailAmount",
    "spp",
    # Что удерживает площадка
    "forPay",
    "ppvzSalesCommission",
    "ppvzReward",
    "acquiringFee",
    "kvw",
    "penalty",
    "deduction",
    "paidStorage",
    "paidAcceptance",
    "rebillLogisticCost",
    "deliveryAmount",
    "returnAmount",
    # Товар
    "nmId",
    "vendorCode",
    "subjectName",
    "brandName",
)

# Меняется вместе с набором полей выше и с тем, как строки раскладываются
# по дням. Если в базе лежит выгрузка, сделанная по старым правилам, её
# нужно повторить целиком — иначе старые месяцы останутся как были.
FINANCE_FIELDS_VERSION = 3

# Ответ статистики: (дата начала выборки, когда получен, строки)
_responses: dict[tuple[str, str], tuple[date, float, list[dict[str, Any]]]] = {}


def _token_key(token: str) -> str:
    """Короткий отпечаток токена — чтобы не держать сам токен ключом словаря."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


def reset_cache() -> None:
    """Забыть накопленные ответы. Нужно тестам и смене ключей."""
    _responses.clear()


class WildberriesConnector(HttpConnector):
    code = "wildberries"
    title = "Wildberries"
    base_url = STATISTICS_URL

    def __init__(self, credentials) -> None:  # type: ignore[no-untyped-def]
        super().__init__(credentials)
        # Связка «номенклатура WB → артикул продавца», нужна для остатков.
        self._articles: dict[str, str] = {}

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": self.credentials.get("token"),
        }

    def client(self, base_url: str | None = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    # --- обращения к API -----------------------------------------------------

    async def statistics(
        self, path: str, date_from: date, max_wait: float = PATIENCE_INTERACTIVE
    ) -> list[dict[str, Any]]:
        """Строки статистики от указанной даты, по возможности из кэша.

        Ответ за более раннюю дату содержит в себе и более поздние периоды,
        поэтому такой ответ переиспользуется вместо повторного запроса.
        """
        key = (_token_key(self.credentials.get("token")), path)
        cached = _responses.get(key)
        if cached:
            cached_from, fetched_at, rows = cached
            if cached_from <= date_from and time.monotonic() - fetched_at < RESPONSE_TTL:
                return rows

        async def call() -> httpx.Response:
            async with self.client(STATISTICS_URL) as client:
                return await client.get(
                    path, params={"dateFrom": f"{date_from.isoformat()}T00:00:00"}
                )

        response = await Throttle.run(
            f"wb:{key[0]}:{path}", STATISTICS_INTERVAL, call, max_wait=max_wait
        )
        response.raise_for_status()
        rows = self.as_list(response.json(), "data", "result")
        _responses[key] = (date_from, time.monotonic(), rows)
        return rows

    async def stocks(self, max_wait: float = PATIENCE_INTERACTIVE) -> list[dict[str, Any]]:
        """Остатки на складах Wildberries через Analytics API."""

        async def call() -> httpx.Response:
            async with self.client(ANALYTICS_URL) as client:
                return await client.post(
                    STOCKS_PATH, json={"limit": STOCKS_PAGE, "offset": 0}
                )

        key = _token_key(self.credentials.get("token"))
        response = await Throttle.run(
            f"wb:{key}:stocks", ANALYTICS_INTERVAL, call, max_wait=max_wait
        )
        response.raise_for_status()
        return self.as_list(response.json(), "items", "data", "result")

    async def finance(
        self,
        date_from: date,
        date_to: date,
        max_wait: float = FINANCE_PATIENCE,
    ) -> list[dict[str, Any]]:
        """Детализация отчёта реализации за период, постранично.

        Строки отдаются порциями: в следующем запросе передаём `rrdId`
        последней полученной строки и повторяем, пока площадка не ответит
        `204` («больше нет») или не пришлёт неполную страницу.
        """
        if date_from < FINANCE_SINCE:
            date_from = FINANCE_SINCE
        if date_to < date_from:
            return []

        key = _token_key(self.credentials.get("token"))
        rows: list[dict[str, Any]] = []
        rrd_id = 0

        for _ in range(FINANCE_PAGES):
            body = {
                "dateFrom": date_from.isoformat(),
                "dateTo": date_to.isoformat(),
                "limit": FINANCE_PAGE,
                "rrdId": rrd_id,
                "period": "daily",
                "fields": list(FINANCE_FIELDS),
            }

            async def call(payload: dict[str, Any] = body) -> httpx.Response:
                async with self.client(FINANCE_URL) as client:
                    return await client.post(
                        FINANCE_PATH, json=payload, timeout=FINANCE_TIMEOUT
                    )

            response = await Throttle.run(
                f"wb:{key}:finance", FINANCE_INTERVAL, call, max_wait=max_wait
            )
            if response.status_code == 204:
                break
            response.raise_for_status()

            page = self.as_list(response.json(), "data", "result")
            if not page:
                break
            rows.extend(page)

            last = self.to_int(page[-1].get("rrdId"))
            if not last or len(page) < FINANCE_PAGE:
                break
            rrd_id = last

        return rows

    # --- сборка отчёта -------------------------------------------------------

    async def collect_raw(
        self, date_from: date, max_wait: float = PATIENCE_INTERACTIVE
    ) -> dict[str, Any]:
        """Скачать сырые строки с площадки за период от указанной даты.

        Отделено от разбора намеренно: строки складываются в хранилище на
        сервере, а отчёт за любой период считается уже из них, без обращения
        к Wildberries.
        """
        sales, sales_error = await self._try(
            self.statistics(SALES_PATH, date_from, max_wait)
        )
        orders, orders_error = await self._try(
            self.statistics(ORDERS_PATH, date_from, max_wait)
        )
        stock_rows, stocks_error = await self._try(
            self.stocks(max_wait),
            denied_hint="в токене Wildberries нужна категория «Аналитика»",
        )

        return {
            "sales": sales,
            "orders": orders,
            "stocks": stock_rows,
            "errors": {
                "sales": sales_error,
                "orders": orders_error,
                "stocks": stocks_error,
            },
        }

    async def collect_finance(
        self,
        date_from: date,
        date_to: date,
        max_wait: float = FINANCE_PATIENCE,
    ) -> dict[str, Any]:
        """Скачать детализацию отчёта реализации за отрезок дат.

        Отдельно от `collect_raw`: у отчёта реализации свой темп (раз в
        минуту) и своя глубина, поэтому и выгружается он своим заходом.
        """
        rows, error = await self._try(
            self.finance(date_from, date_to, max_wait),
            denied_hint="в токене Wildberries нужна категория «Статистика»",
        )
        return {"finance": rows, "errors": {"finance": error}}

    def build(
        self,
        rows: dict[str, Any],
        period: Period,
        errors: dict[str, str] | None = None,
    ) -> MarketplaceReport:
        """Собрать отчёт за период из уже полученных строк."""
        errors = errors if errors is not None else rows.get("errors", {}) or {}
        report = MarketplaceReport(
            marketplace=self.code,
            title=self.title,
            connected=True,
            demo=False,
        )

        # Продажи и заказы — основа отчёта. Если не пришло ни то, ни другое,
        # показывать нечего: это ошибка площадки, а не частичный сбой.
        if errors.get("sales") and errors.get("orders"):
            return self.empty_report(error=f"{self.title}: {errors['sales']}")

        self._articles = {}
        self._apply_sales(report, rows.get("sales") or [], period)
        self._apply_orders(report, rows.get("orders") or [], period)
        self._apply_finance(
            report,
            rows.get("finance") or [],
            period,
            rows.get("statisticsFrom"),
        )
        self._apply_stocks(report, rows.get("stocks") or [], period)

        # Ставки считаются в последнюю очередь: к этому моменту выручка уже
        # собрана из обоих источников.
        if not report.commission:
            report.commission = report.revenue * FALLBACK_COMMISSION
        report.logistics = report.revenue * FALLBACK_LOGISTICS

        for source, human in (
            ("sales", "продажи"),
            ("orders", "заказы"),
            ("stocks", "остатки"),
            ("finance", "отчёт реализации"),
        ):
            if errors.get(source):
                report.warnings.append(f"{human} не получены — {errors[source]}")

        return report

    async def fetch(self, period: Period) -> MarketplaceReport:
        rows = await self.collect_raw(period.date_from)
        return self.build(rows, period)

    async def _try(self, coro, denied_hint: str = "") -> tuple[list[dict[str, Any]], str]:
        """Выполнить запрос, вернув либо строки, либо причину неудачи."""
        try:
            return await coro, ""
        except RateLimited as exc:
            return [], str(exc)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403) and denied_hint:
                return [], denied_hint
            detail = ""
            try:
                body = exc.response.json()
                detail = str(body.get("detail") or body.get("title") or "")
            except Exception:  # noqa: BLE001 — тело может быть не JSON
                detail = ""
            message = f"HTTP {exc.response.status_code}"
            return [], f"{message}: {self.redact(detail)}" if detail else message
        except httpx.HTTPError as exc:
            return [], self.redact(f"нет связи ({type(exc).__name__})")

    async def probe(self, period: Period) -> list[Probe]:
        return [
            await self.capture(
                f"GET {SALES_PATH}", lambda: self.statistics(SALES_PATH, period.date_from)
            ),
            await self.capture(
                f"GET {ORDERS_PATH}", lambda: self.statistics(ORDERS_PATH, period.date_from)
            ),
            await self.capture(f"POST {STOCKS_PATH}", lambda: self.stocks()),
        ]

    # --- продажи: выручка, возвраты, регионы, товары -------------------------

    def _apply_sales(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        by_day: dict[date, DayPoint] = {}
        by_sku: dict[str, Product] = {}
        by_region: dict[str, RegionSales] = defaultdict(lambda: RegionSales(region=""))

        for row in rows:
            moment = parse_moment(row.get("date") or row.get("lastChangeDate"))
            if not moment or not period.covers(moment):
                continue
            day = moment.date()

            self._remember_article(row)

            # saleID начинается с "S" у продажи и с "R" у возврата.
            sale_id = str(row.get("saleID") or "")
            is_return = sale_id.startswith("R") or self.to_float(row.get("finishedPrice")) < 0
            amount = self._price(row)
            for_pay = abs(self.to_float(row.get("forPay")))

            # Возврат уменьшает выручку того дня, когда он произошёл:
            # «выручка» в панели — это чистые продажи, а не валовые выкупы.
            sign = -1 if is_return else 1

            point = by_day.setdefault(day, DayPoint(day=day))
            point.revenue += sign * amount
            point.units += sign
            report.revenue += sign * amount
            # Валовые выкупы и сумма возвратов хранятся порознь: в личном
            # кабинете Wildberries показывают именно выкупы, без вычета
            # возвратов, и панель должна давать возможность сверить цифры.
            if is_return:
                report.returns_amount += amount
            else:
                report.gross_revenue += amount
                report.seller_revenue += self._seller_price(row)
            report.units += sign
            report.payout += sign * for_pay
            if for_pay:
                report.commission += sign * max(amount - for_pay, 0.0)

            if is_return:
                point.returns += 1
                report.returns += 1
            else:
                report.buyouts += 1

            sku = self._sku(row)
            product = by_sku.setdefault(
                sku,
                Product(
                    sku=sku,
                    name=str(row.get("subject") or row.get("brand") or sku),
                    marketplace=self.code,
                ),
            )
            product.revenue += sign * amount
            product.units += sign
            if is_return:
                product.returns += 1

            region_name = str(row.get("regionName") or row.get("oblastOkrugName") or "Не указан")
            region = by_region[region_name]
            region.region = region_name
            region.revenue += sign * amount
            region.orders += sign

        report.series = [by_day.get(day, DayPoint(day=day)) for day in period.each_day()]
        report.products = sorted(
            (product for product in by_sku.values() if product.revenue > 0),
            key=lambda item: item.revenue,
            reverse=True,
        )[:20]
        report.regions = sorted(
            (region for region in by_region.values() if region.revenue > 0),
            key=lambda item: item.revenue,
            reverse=True,
        )

    # --- заказы: количество, отмены, воронка --------------------------------

    def _apply_orders(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        orders_by_day: dict[date, int] = defaultdict(int)
        for row in rows:
            moment = parse_moment(row.get("date") or row.get("lastChangeDate"))
            if not moment or not period.covers(moment):
                continue
            day = moment.date()
            self._remember_article(row)
            if row.get("isCancel"):
                report.cancellations += 1
                continue
            orders_by_day[day] += 1
            report.orders += 1

        for point in report.series:
            point.orders = orders_by_day.get(point.day, 0)

        report.funnel = Funnel(orders=report.orders, buyouts=report.buyouts)

    # --- отчёт реализации: глубина за пределами статистики --------------------

    def _apply_finance(
        self,
        report: MarketplaceReport,
        rows: list[dict[str, Any]],
        period: Period,
        statistics_from: date | None,
    ) -> None:
        """Добрать дни, до которых статистика Wildberries уже не достаёт.

        Статистика хранится около полугода, отчёт реализации — с 2024 года.
        Поэтому квартал, полугодие и год складываются из двух источников:
        свежие дни — из статистики, всё, что раньше `statistics_from`, — из
        финансового отчёта. Шов проходит там, где статистики просто нет,
        поэтому цифры за уже показанные периоды не меняются.

        Заказов финансовый отчёт не содержит: в нём только то, что дошло до
        расчётов. Поэтому за глубокие дни заказы приравниваются к выкупам,
        и панель говорит об этом вслух.
        """
        if not rows:
            return

        edge = statistics_from
        by_day: dict[date, DayPoint] = {}
        by_sku: dict[str, Product] = {}
        earliest: date | None = None

        for row in rows:
            moment = parse_moment(row.get("rrDate") or row.get("saleDt"))
            if not moment or not period.covers(moment):
                continue
            day = moment.date()
            if edge is not None and day >= edge:
                continue  # этот день уже посчитан по статистике

            doc = str(row.get("docTypeName") or "")
            if "озврат" in doc:
                sign = -1
            elif "родаж" in doc:
                sign = 1
            else:
                continue  # логистика, хранение, штрафы — это не продажа

            quantity = max(self.to_int(row.get("quantity"), 1), 1)
            # Сверка показала соответствие колонок один в один:
            # `retailAmount` — это `finishedPrice` статистики (деньги
            # покупателя), `retailPriceWithDisc` — её `priceWithDisc`
            # (цена продавца). Считаем по тем же базам, что и свежие дни.
            amount = abs(self.to_float(row.get("retailAmount")))
            seller = abs(self.to_float(row.get("retailPriceWithDisc"))) * quantity
            for_pay = abs(self.to_float(row.get("forPay")))

            earliest = day if earliest is None else min(earliest, day)

            point = by_day.setdefault(day, DayPoint(day=day))
            point.revenue += sign * amount
            point.units += sign * quantity
            point.orders += quantity if sign > 0 else 0
            if sign < 0:
                point.returns += quantity

            report.revenue += sign * amount
            if sign < 0:
                report.returns_amount += amount
            else:
                report.gross_revenue += amount
                report.seller_revenue += seller or amount
            report.units += sign * quantity
            report.payout += sign * for_pay
            if for_pay:
                report.commission += sign * max(amount - for_pay, 0.0)
            if sign > 0:
                report.buyouts += quantity
                report.orders += quantity
            else:
                report.returns += quantity

            sku = str(row.get("vendorCode") or row.get("nmId") or "—")
            product = by_sku.setdefault(
                sku,
                Product(
                    sku=sku,
                    name=str(row.get("subjectName") or row.get("brandName") or sku),
                    marketplace=self.code,
                ),
            )
            product.revenue += sign * amount
            product.units += sign * quantity
            if sign < 0:
                product.returns += quantity

        if not by_day:
            return

        for point in report.series:
            filled = by_day.get(point.day)
            if filled:
                point.revenue += filled.revenue
                point.units += filled.units
                point.orders += filled.orders
                point.returns += filled.returns

        merged = {product.sku: product for product in report.products}
        for sku, product in by_sku.items():
            known = merged.get(sku)
            if known:
                known.revenue += product.revenue
                known.units += product.units
                known.returns += product.returns
            else:
                merged[sku] = product
        report.products = sorted(
            (product for product in merged.values() if product.revenue > 0),
            key=lambda item: item.revenue,
            reverse=True,
        )[:20]

        report.funnel = Funnel(orders=report.orders, buyouts=report.buyouts)

        border = edge or period.date_to
        report.notes.append(
            f"до {border.strftime('%d.%m.%Y')} цифры взяты из финансового отчёта "
            f"Wildberries: выручка и «К перечислению» точные, заказы посчитаны "
            f"по выкупам — статистику заказов площадка глубже не хранит"
        )

    # --- остатки -------------------------------------------------------------

    def _price(self, row: dict[str, Any]) -> float:
        """Деньги, которые реально пришли за товар.

        Wildberries отдаёт по каждой продаже три цены:

        * `totalPrice` — до всех скидок;
        * `priceWithDisc` — со скидкой продавца, **до** скидки площадки;
        * `finishedPrice` — сколько заплатил покупатель, то есть после
          скидки Wildberries (СПП).

        Сверка с отчётом реализации показала, что «К перечислению» площадка
        считает именно от `finishedPrice`: скидку покупателю она не
        компенсирует. Поэтому денежная часть отчёта — выручка, комиссия,
        «К перечислению» — считается от неё. Цена продавца показывается
        отдельно, как оборот: см. `_seller_price`.
        """
        for field_name in ("finishedPrice", "priceWithDisc", "totalPrice"):
            value = abs(self.to_float(row.get(field_name)))
            if value:
                return value
        return 0.0

    def _seller_price(self, row: dict[str, Any]) -> float:
        """Цена продавца — оборот до скидки площадки.

        Эту сумму показывает приложение Wildberries в «Выкупах», по ней же
        руководитель привык оценивать масштаб продаж. Денег она не отражает:
        разницу с `_price` площадка удерживает как свою скидку покупателю.
        """
        for field_name in ("priceWithDisc", "finishedPrice", "totalPrice"):
            value = abs(self.to_float(row.get(field_name)))
            if value:
                return value
        return 0.0

    def _sku(self, row: dict[str, Any]) -> str:
        return str(row.get("supplierArticle") or row.get("nmId") or "—")

    def _remember_article(self, row: dict[str, Any]) -> None:
        """Запомнить, какой артикул продавца соответствует номенклатуре WB.

        Продажи и заказы содержат оба идентификатора, а остатки приходят
        только с `nmId` — без этой связки их не к чему привязать.
        """
        nm_id = row.get("nmId")
        article = row.get("supplierArticle")
        if nm_id and article:
            self._articles[str(nm_id)] = str(article)

    def _apply_stocks(
        self, report: MarketplaceReport, rows: list[dict[str, Any]], period: Period
    ) -> None:
        stock_by_sku: dict[str, int] = defaultdict(int)
        warehouse_by_sku: dict[str, str] = {}

        for row in rows:
            quantity = self.to_int(row.get("quantity"))
            if not quantity:
                continue
            nm_id = str(row.get("nmId") or "")
            sku = self._articles.get(nm_id, nm_id or "—")
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
