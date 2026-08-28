"""Периоды, расчётные показатели и приведение отчёта к JSON."""

from datetime import date

import pytest

from dashboard.models import DayPoint, MarketplaceReport, Period, Product, StockAlert


def test_period_from_preset_counts_days_inclusively():
    period = Period.from_preset("7d", today=date(2025, 3, 10))
    assert period.date_from == date(2025, 3, 4)
    assert period.date_to == date(2025, 3, 10)
    assert period.days == 7
    assert len(period.each_day()) == 7


def test_period_today_is_single_day():
    period = Period.from_preset("today", today=date(2025, 3, 10))
    assert period.days == 1
    assert period.date_from == period.date_to


def test_unknown_preset_falls_back_to_month():
    period = Period.from_preset("что-то своё", today=date(2025, 3, 10))
    assert period.preset == "30d"
    assert period.days == 30


def test_previous_period_is_same_length_and_does_not_overlap():
    period = Period.from_preset("30d", today=date(2025, 3, 10))
    previous = period.previous()
    assert previous.days == period.days
    assert previous.date_to < period.date_from


@pytest.mark.parametrize("preset", ["today", "yesterday", "7d", "30d", "90d", "month", "year"])
def test_all_presets_produce_valid_ranges(preset):
    period = Period.from_preset(preset, today=date(2025, 6, 15))
    assert period.date_from <= period.date_to
    assert period.days >= 1


def _report() -> MarketplaceReport:
    report = MarketplaceReport(marketplace="wildberries", title="Wildberries")
    report.revenue = 1_000_000
    report.orders = 400
    report.units = 500
    report.returns = 40
    report.buyouts = 300
    report.commission = 150_000
    report.logistics = 60_000
    report.ad_spend = 80_000
    report.cost_price = 400_000
    report.stock_units = 900
    report.series = [DayPoint(day=date(2025, 3, 1) , units=500)]
    return report


def test_derived_metrics():
    report = _report()
    assert report.avg_check == 2500
    assert report.profit == 310_000
    assert report.margin == pytest.approx(31.0)
    assert report.buyout_rate == pytest.approx(75.0)
    assert report.return_rate == pytest.approx(10.0)
    assert report.drr == pytest.approx(8.0)


def test_metrics_do_not_divide_by_zero():
    empty = MarketplaceReport(marketplace="ozon", title="Ozon")
    assert empty.avg_check == 0
    assert empty.buyout_rate == 0
    assert empty.return_rate == 0
    assert empty.drr == 0
    assert empty.stock_days == 0


def test_stock_days_uses_daily_sales_rate():
    report = _report()
    # 500 штук за один день продаж, на складе 900 → запаса меньше чем на два дня
    assert report.stock_days == pytest.approx(1.8)


def test_report_serializes_to_camel_case_json():
    payload = _report().to_dict()
    assert payload["avgCheck"] == 2500
    assert payload["buyoutRate"] == 75.0
    assert payload["marketplace"] == "wildberries"
    assert isinstance(payload["series"], list)


def test_stock_alert_severity_thresholds():
    critical = StockAlert(sku="1", name="товар", stock=3, days_left=2)
    warning = StockAlert(sku="1", name="товар", stock=10, days_left=6)
    calm = StockAlert(sku="1", name="товар", stock=90, days_left=30)
    assert critical.severity == "critical"
    assert warning.severity == "warning"
    assert calm.severity == "ok"


def test_product_rounds_values_in_json():
    product = Product(sku="A", name="Товар", revenue=1234.5678, rating=4.6666)
    payload = product.to_dict()
    assert payload["revenue"] == 1234.57
    assert payload["rating"] == 4.7
