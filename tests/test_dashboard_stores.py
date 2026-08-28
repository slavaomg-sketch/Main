"""Несколько магазинов на одной площадке: сведение отчётов и разбивка."""

from datetime import date

import pytest

from dashboard import connections as conn
from dashboard import db
from dashboard.aggregator import build_totals, collect, merge_reports
from dashboard.config import settings
from dashboard.connectors import REAL_CONNECTORS
from dashboard.connectors.base import MarketplaceConnector
from dashboard.models import (
    DayPoint,
    Funnel,
    MarketplaceReport,
    Period,
    Product,
    RegionSales,
    Review,
    StockAlert,
)


def period() -> Period:
    return Period(date_from=date(2025, 3, 1), date_to=date(2025, 3, 2))


def store_report(title: str, revenue: float, orders: int, sku: str) -> MarketplaceReport:
    report = MarketplaceReport(
        marketplace="wildberries", title="Wildberries",
        account_id=title, account_title=title, connected=True, demo=False,
    )
    report.revenue = revenue
    report.orders = orders
    report.units = orders
    report.returns = 2
    report.buyouts = orders - 1
    report.commission = revenue * 0.15
    report.logistics = revenue * 0.05
    report.ad_spend = revenue * 0.10
    report.cost_price = revenue * 0.40
    report.stock_units = 100
    report.series = [
        DayPoint(day=date(2025, 3, 1), revenue=revenue / 2, orders=orders // 2, units=orders // 2),
        DayPoint(day=date(2025, 3, 2), revenue=revenue / 2, orders=orders - orders // 2,
                 units=orders - orders // 2),
    ]
    report.products = [Product(sku=sku, name="Товар " + sku, revenue=revenue, units=orders,
                               stock=50, marketplace="wildberries", account=title)]
    report.regions = [RegionSales(region="Москва", revenue=revenue, orders=orders)]
    report.stock_alerts = [StockAlert(sku=sku, name="Товар", stock=5, days_left=2,
                                      marketplace="wildberries", account=title)]
    report.reviews = [Review(sku=sku, name="Товар", rating=5, text="Хорошо",
                             created_at="2025-03-0" + ("1" if title.endswith("1") else "2"),
                             marketplace="wildberries", account=title)]
    report.funnel = Funnel(impressions=1000, card_views=200, cart_adds=50,
                           orders=orders, buyouts=orders - 1)
    return report


# --- сведение отчётов ----------------------------------------------------------


def test_merge_sums_money_and_orders():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "A"),
        store_report("Магазин 2", 500, 5, "B"),
    ], period())

    assert merged.revenue == 1500
    assert merged.orders == 15
    assert merged.returns == 4
    assert merged.stock_units == 200
    assert merged.profit == pytest.approx(1500 * 0.30)


def test_merge_keeps_per_store_breakdown():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "A"),
        store_report("Магазин 2", 500, 5, "B"),
    ], period())

    assert [account.title for account in merged.accounts] == ["Магазин 1", "Магазин 2"]
    assert [account.revenue for account in merged.accounts] == [1000, 500]
    assert merged.accounts[0].to_dict()["avgCheck"] == 100


def test_merge_adds_series_day_by_day():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "A"),
        store_report("Магазин 2", 500, 5, "B"),
    ], period())

    assert len(merged.series) == 2
    assert sum(point.revenue for point in merged.series) == 1500
    assert merged.series[0].revenue == 750


def test_merge_series_covers_whole_period_even_if_store_is_silent():
    quiet = MarketplaceReport(marketplace="wildberries", title="Wildberries")
    merged = merge_reports("wildberries", "Wildberries", [quiet], period())
    assert [point.day for point in merged.series] == period().each_day()


def test_merge_combines_same_product_from_two_stores():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "SAME"),
        store_report("Магазин 2", 500, 5, "SAME"),
    ], period())

    assert len(merged.products) == 1
    assert merged.products[0].revenue == 1500
    assert merged.products[0].units == 15
    assert merged.products[0].account == "несколько магазинов"


def test_merge_keeps_different_products_apart():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "A"),
        store_report("Магазин 2", 500, 5, "B"),
    ], period())
    assert {product.sku for product in merged.products} == {"A", "B"}


def test_merge_orders_products_by_revenue():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Малый", 200, 2, "SMALL"),
        store_report("Большой", 900, 9, "BIG"),
    ], period())
    assert merged.products[0].sku == "BIG"


def test_merge_joins_regions_and_alerts():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "A"),
        store_report("Магазин 2", 500, 5, "B"),
    ], period())

    assert len(merged.regions) == 1
    assert merged.regions[0].revenue == 1500
    assert len(merged.stock_alerts) == 2
    assert {alert.account for alert in merged.stock_alerts} == {"Магазин 1", "Магазин 2"}


def test_merge_sums_funnel():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 1000, 10, "A"),
        store_report("Магазин 2", 500, 5, "B"),
    ], period())
    assert merged.funnel.impressions == 2000
    assert merged.funnel.orders == 15


def test_merge_weighs_rating_by_number_of_reviews():
    big = store_report("Большой", 1000, 10, "A")
    big.rating, big.reviews_count = 4.0, 900
    small = store_report("Малый", 100, 1, "B")
    small.rating, small.reviews_count = 5.0, 100

    merged = merge_reports("wildberries", "Wildberries", [big, small], period())
    assert merged.rating == pytest.approx(4.1)
    assert merged.reviews_count == 1000


def test_merge_collects_errors_without_repeating_them():
    first = store_report("Магазин 1", 0, 0, "A")
    first.error = "HTTP 401 от Wildberries"
    second = store_report("Магазин 2", 0, 0, "B")
    second.error = "HTTP 401 от Wildberries"

    merged = merge_reports("wildberries", "Wildberries", [first, second], period())
    assert merged.error == "HTTP 401 от Wildberries"


def test_merged_marketplace_is_demo_only_if_every_store_is():
    live = store_report("Живой", 100, 1, "A")
    demo = store_report("Демо", 100, 1, "B")
    demo.demo = True
    assert merge_reports("wildberries", "WB", [live, demo], period()).demo is False
    assert merge_reports("wildberries", "WB", [demo], period()).demo is True


# --- разбивка в своде -----------------------------------------------------------


def test_totals_expose_accounts_with_shares():
    merged = merge_reports("wildberries", "Wildberries", [
        store_report("Магазин 1", 750, 10, "A"),
        store_report("Магазин 2", 250, 5, "B"),
    ], period())

    totals = build_totals([merged])
    shares = {item["title"]: item["share"] for item in totals["accounts"]}
    assert shares == {"Магазин 1": 75.0, "Магазин 2": 25.0}


# --- опрос нескольких магазинов --------------------------------------------------


class StubConnector(MarketplaceConnector):
    """Отдаёт выручку, зависящую от ключа, — видно, чей это магазин.

    Взят Ozon, а не Wildberries: данные Wildberries панель читает из
    выгрузки, а здесь проверяется опрос площадки напрямую.
    """

    code = "ozon"
    title = "Ozon"

    async def fetch(self, period: Period) -> MarketplaceReport:
        token = self.credentials.get("api_key")
        report = MarketplaceReport(
            marketplace="ozon", title="Ozon", connected=True, demo=False
        )
        report.revenue = 1000 if token.endswith("1") else 300
        report.orders = 10 if token.endswith("1") else 3
        report.series = [DayPoint(day=day, revenue=report.revenue / 2) for day in period.each_day()]
        report.products = [
            Product(sku="SKU-" + token[-1], name="Товар", revenue=report.revenue,
                    units=report.orders, marketplace="ozon")
        ]
        report.stock_alerts = [
            StockAlert(sku="SKU-" + token[-1], name="Товар", stock=3, days_left=1,
                       marketplace="ozon")
        ]
        return report


class BrokenConnector(MarketplaceConnector):
    """Магазин, до которого не достучаться."""

    code = "yandex"
    title = "Яндекс Маркет"

    async def fetch(self, period: Period) -> MarketplaceReport:
        raise RuntimeError("ключ отклонён")


@pytest.fixture
async def stub(monkeypatch, dashboard_db):
    await db.init_db()
    monkeypatch.setitem(REAL_CONNECTORS, "ozon", StubConnector)
    monkeypatch.setitem(REAL_CONNECTORS, "yandex", BrokenConnector)
    return dashboard_db


async def test_collect_queries_every_store_and_sums_them(stub):
    first = await conn.create("ozon", "Магазин 1")
    await conn.save_values(first.id, {"client_id": "1", "api_key": "key-1"})
    second = await conn.create("ozon", "Магазин 2")
    await conn.save_values(second.id, {"client_id": "2", "api_key": "key-2"})

    reports = await collect(period(), ("ozon",), settings, await conn.load())

    assert len(reports) == 1
    assert reports[0].revenue == 1300
    assert [account.title for account in reports[0].accounts] == ["Магазин 1", "Магазин 2"]
    assert [account.revenue for account in reports[0].accounts] == [1000, 300]


async def test_disabled_store_is_not_queried(stub):
    first = await conn.create("ozon", "Магазин 1")
    await conn.save_values(first.id, {"client_id": "1", "api_key": "key-1"})
    second = await conn.create("ozon", "Магазин 2")
    await conn.save_values(second.id, {"client_id": "2", "api_key": "key-2"})
    await conn.update(second.id, enabled=False)

    reports = await collect(period(), ("ozon",), settings, await conn.load())
    assert reports[0].revenue == 1000
    assert len(reports[0].accounts) == 1


async def test_marketplace_without_stores_shows_nothing(stub):
    reports = await collect(period(), ("wildberries",), settings, await conn.load())
    assert reports[0].demo is False
    assert reports[0].connected is False
    assert reports[0].revenue == 0


async def test_products_and_alerts_carry_the_store_they_came_from(stub):
    first = await conn.create("ozon", "Магазин 1")
    await conn.save_values(first.id, {"client_id": "1", "api_key": "key-1"})
    second = await conn.create("ozon", "Магазин 2")
    await conn.save_values(second.id, {"client_id": "2", "api_key": "key-2"})

    reports = await collect(period(), ("ozon",), settings, await conn.load())

    assert {product.account for product in reports[0].products} == {"Магазин 1", "Магазин 2"}
    assert {alert.account for alert in reports[0].stock_alerts} == {"Магазин 1", "Магазин 2"}


async def test_broken_store_does_not_break_the_marketplace_report(stub):
    good = await conn.create("ozon", "Рабочий")
    await conn.save_values(good.id, {"client_id": "1", "api_key": "key-1"})
    broken = await conn.create("yandex", "Яндекс с плохим ключом")
    await conn.save_values(broken.id, {"api_key": "нерабочий", "campaign_id": "7"})

    reports = await collect(period(), ("ozon", "yandex"), settings, await conn.load())
    by_code = {report.marketplace: report for report in reports}

    assert by_code["ozon"].revenue == 1000
    assert by_code["yandex"].accounts[0].title == "Яндекс с плохим ключом"
    assert "ключ отклонён" in by_code["yandex"].error


# --- частичные сбои при нескольких магазинах ------------------------------------


def test_merge_collects_warnings_from_every_store():
    first = store_report("Магазин 1", 1000, 10, "A")
    first.warnings = ["остатки не получены — HTTP 404"]
    second = store_report("Магазин 2", 500, 5, "B")
    second.warnings = ["остатки не получены — HTTP 404", "продажи не получены — лимит"]

    merged = merge_reports("wildberries", "Wildberries", [first, second], period())

    # Одинаковые предупреждения не повторяются, разные — сохраняются.
    assert merged.warnings == [
        "остатки не получены — HTTP 404",
        "продажи не получены — лимит",
    ]
    assert merged.error == ""
    assert merged.revenue == 1500


def test_warnings_reach_json():
    report = store_report("Магазин 1", 100, 1, "A")
    report.warnings = ["остатки не получены"]
    merged = merge_reports("wildberries", "Wildberries", [report], period())
    assert merged.to_dict()["warnings"] == ["остатки не получены"]


# --- «К перечислению» -----------------------------------------------------------


def test_payout_is_summed_across_stores_and_marketplaces():
    first = store_report("Магазин 1", 1000, 10, "A")
    first.payout = 700
    second = store_report("Магазин 2", 500, 5, "B")
    second.payout = 340

    merged = merge_reports("wildberries", "Wildberries", [first, second], period())

    assert merged.payout == 1040
    assert [account.payout for account in merged.accounts] == [700, 340]
    assert merged.to_dict()["payout"] == 1040


def test_totals_show_payout_share_of_revenue():
    report = store_report("Магазин 1", 1000, 10, "A")
    report.payout = 700
    totals = build_totals([merge_reports("wildberries", "WB", [report], period())])

    assert totals["payout"] == 700
    assert totals["payoutShare"] == 70.0


def test_payout_share_survives_zero_revenue():
    report = store_report("Магазин 1", 0, 0, "A")
    totals = build_totals([merge_reports("wildberries", "WB", [report], period())])
    assert totals["payoutShare"] == 0.0


def test_notes_are_merged_and_kept_apart_from_warnings():
    """Пояснение «откуда взяты цифры» — не сбой: панель не должна из-за него
    писать «часть данных не пришла»."""
    first = store_report("ВБ Вячеслав", 1000, 10, "A")
    first.notes = ["до 01.03.2026 цифры взяты из финансового отчёта"]
    second = store_report("ВБ Наталья", 500, 5, "B")
    second.notes = ["до 01.03.2026 цифры взяты из финансового отчёта"]
    second.warnings = ["остатки не получены — HTTP 404"]

    merged = merge_reports("wildberries", "Wildberries", [first, second], period())

    assert merged.notes == ["до 01.03.2026 цифры взяты из финансового отчёта"]
    assert merged.warnings == ["остатки не получены — HTTP 404"]
    assert merged.to_dict()["notes"] == merged.notes


def test_parents_are_merged_across_stores():
    """Один и тот же родитель может продаваться из двух кабинетов —
    в разрезе он должен остаться одной строкой."""
    from dashboard.models import ParentSales

    first = store_report("ВБ Вячеслав", 1000, 10, "A")
    first.parents = [ParentSales(article="TC-TC-1M", orders=10, orders_amount=5000)]
    second = store_report("ВБ Наталья", 500, 5, "B")
    second.parents = [
        ParentSales(article="TC-TC-1M", orders=5, orders_amount=2500),
        ParentSales(article="TC-TC-2M", orders=2, orders_amount=3000),
    ]

    merged = merge_reports("wildberries", "Wildberries", [first, second], period())
    by_article = {parent.article: parent for parent in merged.parents}

    assert by_article["TC-TC-1M"].orders == 15
    assert by_article["TC-TC-1M"].orders_amount == 7500
    assert by_article["TC-TC-1M"].avg_check == 500
    assert by_article["TC-TC-2M"].orders == 2
