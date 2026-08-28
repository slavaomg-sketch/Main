"""Свод по площадкам, сравнение периодов и кэш."""

from datetime import date

import pytest

from dashboard.aggregator import (
    SnapshotCache,
    build_deltas,
    build_snapshot,
    build_totals,
    normalize_codes,
)
from dashboard.connectors import MARKETPLACE_ORDER
from dashboard.models import DayPoint, MarketplaceReport, Period, Snapshot


def make_report(code: str, revenue: float, orders: int) -> MarketplaceReport:
    report = MarketplaceReport(marketplace=code, title=code.title())
    report.revenue = revenue
    report.orders = orders
    report.orders_amount = revenue
    report.units = orders
    report.buyouts = orders // 2
    report.returns = orders // 10
    report.commission = revenue * 0.15
    report.logistics = revenue * 0.05
    report.ad_spend = revenue * 0.10
    report.cost_price = revenue * 0.40
    report.series = [DayPoint(day=date(2025, 3, 1), revenue=revenue, orders=orders, units=orders)]
    return report


def test_totals_sum_across_marketplaces():
    totals = build_totals([make_report("wildberries", 1000, 10), make_report("ozon", 500, 5)])
    assert totals["revenue"] == 1500
    assert totals["orders"] == 15
    assert totals["avgCheck"] == 100
    assert totals["profit"] == pytest.approx(1500 * 0.30)


def test_totals_merge_day_series_by_date():
    totals = build_totals([make_report("wildberries", 1000, 10), make_report("ozon", 500, 5)])
    assert len(totals["series"]) == 1
    assert totals["series"][0]["revenue"] == 1500
    assert totals["series"][0]["orders"] == 15


def test_totals_shares_add_up_to_hundred():
    totals = build_totals([make_report("wildberries", 750, 10), make_report("ozon", 250, 5)])
    shares = {item["marketplace"]: item["share"] for item in totals["share"]}
    assert shares["wildberries"] == 75.0
    assert shares["ozon"] == 25.0


def test_totals_on_empty_input_are_zero_not_error():
    totals = build_totals([])
    assert totals["revenue"] == 0
    assert totals["avgCheck"] == 0
    assert totals["series"] == []


def test_deltas_compare_with_previous_period():
    deltas = build_deltas([make_report("ozon", 1200, 12)], [make_report("ozon", 1000, 10)])
    assert deltas["revenue"]["change"] == pytest.approx(20.0)
    assert deltas["orders"]["change"] == pytest.approx(20.0)
    assert deltas["byMarketplace"]["ozon"]["change"] == pytest.approx(20.0)


def test_delta_is_none_when_previous_period_is_empty():
    deltas = build_deltas([make_report("ozon", 1200, 12)], [make_report("ozon", 0, 0)])
    assert deltas["revenue"]["change"] is None


def test_deltas_without_previous_reports_are_empty():
    assert build_deltas([make_report("ozon", 100, 1)], []) == {}


@pytest.mark.parametrize(
    "raw, expected",
    [
        (None, MARKETPLACE_ORDER),
        ("", MARKETPLACE_ORDER),
        ("all", MARKETPLACE_ORDER),
        ("ozon", ("ozon",)),
        ("ozon,wildberries", ("wildberries", "ozon")),
        ("что-то-чужое", MARKETPLACE_ORDER),
        ("OZON, ALI", ("ozon", "ali")),
    ],
)
def test_normalize_codes(raw, expected):
    assert normalize_codes(raw) == expected


async def test_snapshot_contains_every_requested_marketplace():
    period = Period.from_preset("7d", today=date(2025, 3, 10))
    snapshot = await build_snapshot(period, MARKETPLACE_ORDER, use_cache=False)
    payload = snapshot.to_dict()
    assert [item["marketplace"] for item in payload["marketplaces"]] == list(MARKETPLACE_ORDER)
    assert payload["period"]["days"] == 7
    assert len(payload["totals"]["series"]) == 7


async def test_marketplaces_without_keys_show_zeros_not_invented_sales():
    """Выдуманные продажи в общей выручке опаснее пустой панели."""
    period = Period.from_preset("7d", today=date(2025, 3, 10))
    payload = (await build_snapshot(period, MARKETPLACE_ORDER, use_cache=False)).to_dict()

    assert payload["totals"]["revenue"] == 0
    assert payload["totals"]["orders"] == 0
    for report in payload["marketplaces"]:
        assert report["connected"] is False
        assert report["demo"] is False
        assert report["revenue"] == 0


async def test_snapshot_is_deterministic_for_same_period():
    period = Period.from_preset("7d", today=date(2025, 3, 10))
    first = (await build_snapshot(period, ("ozon",), use_cache=False)).to_dict()
    second = (await build_snapshot(period, ("ozon",), use_cache=False)).to_dict()
    assert first["totals"] == second["totals"]


async def test_snapshot_respects_marketplace_filter():
    period = Period.from_preset("today", today=date(2025, 3, 10))
    snapshot = await build_snapshot(period, ("ozon", "ali"), use_cache=False)
    assert {report.marketplace for report in snapshot.reports} == {"ozon", "ali"}


async def test_cache_returns_stored_snapshot_and_clears():
    cache = SnapshotCache(ttl=60)
    period = Period.from_preset("today", today=date(2025, 3, 10))
    snapshot = Snapshot(period=period, reports=[make_report("ozon", 1, 1)])
    await cache.put(period, ("ozon",), snapshot)
    assert await cache.get(period, ("ozon",)) is snapshot
    await cache.clear()
    assert await cache.get(period, ("ozon",)) is None


async def test_cache_expires_after_ttl():
    cache = SnapshotCache(ttl=0)
    period = Period.from_preset("today", today=date(2025, 3, 10))
    await cache.put(period, ("ozon",), Snapshot(period=period, reports=[]))
    assert await cache.get(period, ("ozon",)) is None


async def test_cache_separates_different_marketplace_sets():
    cache = SnapshotCache(ttl=60)
    period = Period.from_preset("today", today=date(2025, 3, 10))
    await cache.put(period, ("ozon",), Snapshot(period=period, reports=[]))
    assert await cache.get(period, ("ozon", "ali")) is None


def test_totals_publish_both_halves_of_revenue():
    """«Выкупы минус возвраты» должно сходиться и в своде по площадкам."""
    from dashboard.aggregator import build_totals
    from dashboard.models import MarketplaceReport

    reports = [
        MarketplaceReport(marketplace="wildberries", title="WB", connected=True, demo=False,
                          revenue=750, gross_revenue=1000, returns_amount=250, orders=4),
        MarketplaceReport(marketplace="ozon", title="Ozon", connected=True, demo=False,
                          revenue=200, gross_revenue=300, returns_amount=100, orders=2),
    ]
    totals = build_totals(reports)

    assert totals["grossRevenue"] == 1300
    assert totals["returnsAmount"] == 350
    assert totals["revenue"] == totals["grossRevenue"] - totals["returnsAmount"]
    assert totals["returnsShare"] == pytest.approx(26.9, abs=0.1)
