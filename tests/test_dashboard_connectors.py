"""Разбор ответов маркетплейсов и поведение при сбоях."""

from datetime import date

import httpx
import pytest

from dashboard.config import MarketplaceCredentials, load_settings
from dashboard.connectors import build_connector
from dashboard.connectors.ali import AliExpressConnector
from dashboard.connectors.demo import DemoConnector
from dashboard.connectors.ozon import DAY_METRICS, OzonConnector
from dashboard.connectors.dates import parse_day
from dashboard.connectors.wildberries import WildberriesConnector
from dashboard.connectors.yandex import YandexConnector
from dashboard.models import MarketplaceReport, Period


def period() -> Period:
    return Period(date_from=date(2025, 3, 1), date_to=date(2025, 3, 3))


def blank(code: str) -> MarketplaceReport:
    return MarketplaceReport(marketplace=code, title=code, connected=True, demo=False)


def credentials(code: str, **values) -> MarketplaceCredentials:
    return MarketplaceCredentials(code=code, title=code, values=values, required=tuple(values))


# --- выбор коннектора --------------------------------------------------------


def test_demo_connector_is_used_without_keys():
    config = load_settings()
    object.__setattr__(config, "marketplaces", {"ozon": credentials("ozon", api_key="")})
    assert isinstance(build_connector("ozon", config), DemoConnector)


def test_real_connector_is_used_when_keys_present():
    config = load_settings()
    object.__setattr__(
        config,
        "marketplaces",
        {"ozon": MarketplaceCredentials(
            code="ozon", title="Ozon",
            values={"client_id": "1", "api_key": "k"},
            required=("client_id", "api_key"),
        )},
    )
    object.__setattr__(config, "force_demo", False)
    assert isinstance(build_connector("ozon", config), OzonConnector)


def test_force_demo_overrides_configured_keys():
    config = load_settings()
    object.__setattr__(
        config,
        "marketplaces",
        {"ozon": MarketplaceCredentials(
            code="ozon", title="Ozon",
            values={"client_id": "1", "api_key": "k"},
            required=("client_id", "api_key"),
        )},
    )
    object.__setattr__(config, "force_demo", True)
    assert isinstance(build_connector("ozon", config), DemoConnector)


# --- устойчивость к сбоям ----------------------------------------------------


class BrokenConnector(WildberriesConnector):
    async def fetch(self, period):
        raise RuntimeError("боль")


class TimingOutConnector(WildberriesConnector):
    async def fetch(self, period):
        raise httpx.ConnectTimeout("нет связи")


async def test_exception_becomes_report_with_error_not_crash():
    report = await BrokenConnector(credentials("wildberries", token="x")).safe_fetch(period())
    assert report.error.startswith("RuntimeError")
    assert report.revenue == 0


async def test_network_error_is_reported_in_plain_words():
    report = await TimingOutConnector(credentials("wildberries", token="x")).safe_fetch(period())
    assert "Нет связи" in report.error


# --- Wildberries -------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("2025-03-01T10:20:30", date(2025, 3, 1)),      # Wildberries
        ("2025-03-01T10:20:30Z", date(2025, 3, 1)),
        ("2025-03-01 10:20:30", date(2025, 3, 1)),      # AliExpress
        ("01-03-2025 10:20:30", date(2025, 3, 1)),      # Яндекс Маркет
        ("01-03-2025", date(2025, 3, 1)),
        ("2025-03-01", date(2025, 3, 1)),
        ("01.03.2025", date(2025, 3, 1)),
        ("", None),
        (None, None),
        ("не дата", None),
        ("2025-13-45", None),
    ],
)
def test_marketplace_dates_are_parsed(raw, expected):
    assert parse_day(raw) == expected


def test_wildberries_sales_split_sales_and_returns():
    connector = WildberriesConnector(credentials("wildberries", token="x"))
    report = blank("wildberries")
    rows = [
        {"date": "2025-03-01T10:00:00", "saleID": "S1", "finishedPrice": 1000, "forPay": 850,
         "supplierArticle": "ART-1", "subject": "Кружка", "regionName": "Москва"},
        {"date": "2025-03-02T11:00:00", "saleID": "S2", "finishedPrice": 500, "forPay": 430,
         "supplierArticle": "ART-1", "subject": "Кружка", "regionName": "Москва"},
        {"date": "2025-03-02T12:00:00", "saleID": "R3", "finishedPrice": 500,
         "supplierArticle": "ART-1", "subject": "Кружка", "regionName": "Москва"},
        {"date": "2025-02-20T12:00:00", "saleID": "S4", "finishedPrice": 9999,
         "supplierArticle": "ART-9", "subject": "Вне периода"},
    ]
    connector._apply_sales(report, rows, period())

    assert report.revenue == 1500
    assert report.units == 2
    assert report.returns == 1
    assert report.commission == pytest.approx(220)  # (1000-850) + (500-430)
    assert len(report.series) == 3
    assert report.products[0].sku == "ART-1"
    assert report.regions[0].region == "Москва"


def test_wildberries_orders_count_cancellations_separately():
    connector = WildberriesConnector(credentials("wildberries", token="x"))
    report = blank("wildberries")
    connector._apply_sales(report, [], period())
    connector._apply_orders(report, [
        {"date": "2025-03-01T10:00:00", "isCancel": False},
        {"date": "2025-03-01T11:00:00", "isCancel": False},
        {"date": "2025-03-02T11:00:00", "isCancel": True},
    ], period())

    assert report.orders == 2
    assert report.cancellations == 1
    assert report.series[0].orders == 2


def test_wildberries_stocks_flag_low_cover_items():
    connector = WildberriesConnector(credentials("wildberries", token="x"))
    report = blank("wildberries")
    connector._apply_sales(report, [
        {"date": "2025-03-01T10:00:00", "saleID": "S1", "finishedPrice": 100,
         "supplierArticle": "ART-1", "subject": "Кружка"},
    ] * 3, period())
    connector._apply_stocks(report, [
        {"supplierArticle": "ART-1", "quantity": 2, "warehouseName": "Коледино"},
    ], period())

    assert report.stock_units == 2
    assert report.stock_alerts and report.stock_alerts[0].sku == "ART-1"
    assert report.stock_alerts[0].warehouse == "Коледино"


# --- Ozon --------------------------------------------------------------------


def test_ozon_reads_metrics_by_position():
    connector = OzonConnector(credentials("ozon", client_id="1", api_key="k"))
    report = blank("ozon")
    rows = [{
        "dimensions": [{"id": "2025-03-01", "name": "2025-03-01"}],
        "metrics": [12000, 8, 1, 2, 300, 40, 6],
    }]
    connector._apply_days(report, rows, period())

    assert report.revenue == 12000
    assert report.orders == 8
    assert report.returns == 1
    assert report.cancellations == 2
    assert report.buyouts == 6
    assert report.funnel.card_views == 300
    assert len(report.series) == 3


def test_ozon_ignores_rows_outside_period():
    connector = OzonConnector(credentials("ozon", client_id="1", api_key="k"))
    report = blank("ozon")
    connector._apply_days(report, [{
        "dimensions": [{"id": "2024-12-31"}],
        "metrics": [999, 9, 0, 0, 0, 0, 0],
    }], period())
    assert report.revenue == 0


def test_ozon_metric_helper_handles_missing_values():
    assert OzonConnector._metric({"metrics": []}, DAY_METRICS, "revenue") == 0.0
    assert OzonConnector._metric({}, DAY_METRICS, "revenue") == 0.0
    assert OzonConnector._metric({"metrics": [5]}, DAY_METRICS, "revenue") == 5.0


def test_ozon_sums_stocks_across_warehouses():
    connector = OzonConnector(credentials("ozon", client_id="1", api_key="k"))
    report = blank("ozon")
    report.products = []
    connector._apply_stocks(report, [
        {"offer_id": "A", "product_id": "1", "stocks": [{"present": 3}, {"present": 4}]},
    ], period())
    assert report.stock_units == 7


# --- Яндекс Маркет -----------------------------------------------------------


def test_yandex_collects_orders_items_and_regions():
    connector = YandexConnector(credentials("yandex", api_key="k", campaign_id="7"))
    report = blank("yandex")
    connector._apply_orders(report, [
        {
            "creationDate": "01-03-2025 10:00:00",
            "status": "DELIVERED",
            "delivery": {"region": {"name": "Казань"}},
            "items": [
                {"shopSku": "SKU-1", "offerName": "Плед", "count": 2, "price": 1500,
                 "commissions": [{"actual": 300}]},
            ],
        },
        {"creationDate": "02-03-2025 10:00:00", "status": "CANCELLED", "items": []},
    ], period())

    assert report.orders == 1
    assert report.cancellations == 1
    assert report.buyouts == 1
    assert report.revenue == 3000
    assert report.units == 2
    assert report.commission == 300
    assert report.regions[0].region == "Казань"


def test_yandex_counts_only_available_stock():
    connector = YandexConnector(credentials("yandex", api_key="k", campaign_id="7"))
    report = blank("yandex")
    report.products = []
    connector._apply_stocks(report, [
        {"shopSku": "SKU-1", "_warehouse": "Склад", "stocks": [
            {"type": "AVAILABLE", "count": 5},
            {"type": "DEFECT", "count": 9},
        ]},
    ], period())
    assert report.stock_units == 5


# --- AliExpress --------------------------------------------------------------


def test_ali_signature_is_stable_and_uppercase():
    connector = AliExpressConnector(
        credentials("ali", app_key="key", app_secret="secret", access_token="token")
    )
    params = {"app_key": "key", "method": "test", "timestamp": "1"}
    signature = connector.sign(params)
    assert signature == connector.sign(dict(reversed(list(params.items()))))
    assert signature == signature.upper()
    assert len(signature) == 64


def test_ali_unwrap_finds_nested_list():
    connector = AliExpressConnector(
        credentials("ali", app_key="k", app_secret="s", access_token="t")
    )
    body = {"result": {"data": {"target_list": [{"order_status": "FINISH"}]}}}
    assert connector._unwrap(body, "target_list") == [{"order_status": "FINISH"}]
    assert connector._unwrap({"result": {}}, "target_list") == []


def test_ali_orders_skip_cancelled():
    connector = AliExpressConnector(
        credentials("ali", app_key="k", app_secret="s", access_token="t")
    )
    report = blank("ali")
    connector._apply_orders(report, [
        {"gmt_create": "2025-03-01 10:00:00", "order_status": "FINISHED",
         "order_amount": {"amount": "1200"}},
        {"gmt_create": "2025-03-02 10:00:00", "order_status": "ORDER_CANCEL"},
    ], period())
    assert report.orders == 1
    assert report.cancellations == 1
    assert report.revenue == 1200


# --- демо-данные -------------------------------------------------------------


def test_demo_data_is_deterministic():
    connector = DemoConnector(code="wildberries", title="Wildberries")
    first = connector.build(period())
    second = connector.build(period())
    assert first.revenue == second.revenue
    assert [point.orders for point in first.series] == [point.orders for point in second.series]


def test_demo_report_is_internally_consistent():
    report = DemoConnector(code="ozon", title="Ozon").build(period())
    assert report.demo is True
    assert len(report.series) == 3
    assert report.revenue == pytest.approx(sum(p.revenue for p in report.series))
    assert report.stock_units == sum(product.stock for product in report.products)
    assert report.buyouts <= report.orders
    assert report.products == sorted(report.products, key=lambda p: p.revenue, reverse=True)


def test_demo_marketplaces_differ_from_each_other():
    wb = DemoConnector(code="wildberries", title="WB").build(period())
    ozon = DemoConnector(code="ozon", title="Ozon").build(period())
    assert wb.revenue != ozon.revenue
