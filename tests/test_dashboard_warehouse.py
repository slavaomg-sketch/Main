"""Выгрузка данных площадок на сервер: хранение, чтение, обновление."""

from dataclasses import replace
from datetime import date, timedelta

import httpx
import pytest

from dashboard import connections as conn
from dashboard import db, warehouse
from dashboard.config import settings
from dashboard.connectors.wildberries import WildberriesConnector
from dashboard.models import Period


def period(days: int = 3) -> Period:
    end = date.today()
    return Period(date_from=end - timedelta(days=days - 1), date_to=end)


def sale(day: date, srid: str, price: float = 1000.0) -> dict:
    return {
        "date": f"{day.isoformat()}T10:00:00", "srid": srid, "saleID": "S" + srid,
        "finishedPrice": price, "forPay": price * 0.85, "supplierArticle": "ART-1",
        "nmId": 777, "subject": "Кружка", "regionName": "Москва",
    }


def order(day: date, srid: str) -> dict:
    return {"date": f"{day.isoformat()}T09:00:00", "srid": srid, "isCancel": False,
            "supplierArticle": "ART-1", "nmId": 777}


@pytest.fixture
async def store(dashboard_db):
    await db.init_db()
    created = await conn.create("wildberries", "ВБ Основной")
    await conn.save_values(created.id, {"token": "token-value"})
    return await conn.get(created.id)


def mock_wb(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesConnector, "client", client)


def wb_handler(sales, orders, stocks=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if "sales" in request.url.path:
            return httpx.Response(200, json=sales)
        if "orders" in request.url.path:
            return httpx.Response(200, json=orders)
        return httpx.Response(200, json={"items": stocks or []})

    return handler


# --- ключи строк ---------------------------------------------------------------


def test_row_key_prefers_marketplace_identifier():
    assert warehouse.row_key("sales", {"srid": "abc"}, 0) == "abc"
    assert warehouse.row_key("orders", {"odid": 55}, 0) == "55"


def test_row_key_falls_back_to_fields_when_no_identifier():
    row = {"date": "2025-03-01T10:00:00", "nmId": 1, "supplierArticle": "A", "totalPrice": 5}
    first = warehouse.row_key("sales", row, 0)
    assert first == warehouse.row_key("sales", row, 0)
    assert first != warehouse.row_key("sales", row, 1)


def test_stock_row_key_is_product_plus_warehouse():
    key = warehouse.row_key("stocks", {"nmId": 7, "warehouseId": 3}, 0)
    assert key == "7:3"


# --- хранение и чтение ----------------------------------------------------------


async def test_rows_are_stored_and_read_back_for_the_period(store):
    today = date.today()
    rows = [sale(today, "a"), sale(today - timedelta(days=1), "b"),
            sale(today - timedelta(days=30), "old")]
    await warehouse.store_rows(store.id, "sales", rows, today)

    inside = await warehouse.read_rows(store.id, "sales", period(3))
    assert {row["srid"] for row in inside} == {"a", "b"}

    everything = await warehouse.read_rows(store.id, "sales")
    assert len(everything) == 3


async def test_repeated_sync_does_not_duplicate_rows(store):
    today = date.today()
    await warehouse.store_rows(store.id, "sales", [sale(today, "a")], today)
    await warehouse.store_rows(store.id, "sales", [sale(today, "a", price=1500)], today)

    rows = await warehouse.read_rows(store.id, "sales")
    assert len(rows) == 1
    assert rows[0]["finishedPrice"] == 1500      # строка обновилась, а не задвоилась


async def test_stocks_are_replaced_not_accumulated(store):
    today = date.today()
    await warehouse.store_rows(store.id, "stocks", [{"nmId": 1, "warehouseId": 2, "quantity": 5}], today)
    await warehouse.store_rows(store.id, "stocks", [{"nmId": 9, "warehouseId": 2, "quantity": 1}], today)

    rows = await warehouse.read_rows(store.id, "stocks")
    assert [row["nmId"] for row in rows] == [9]


async def test_stocks_are_not_filtered_by_period(store):
    await warehouse.store_rows(
        store.id, "stocks", [{"nmId": 1, "warehouseId": 2, "quantity": 5}],
        date.today() - timedelta(days=60),
    )
    assert len(await warehouse.read_rows(store.id, "stocks", period(3))) == 1


# --- выгрузка -------------------------------------------------------------------


async def test_sync_downloads_and_stores_everything(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a"), sale(today, "b")],
        orders=[order(today, "o1")],
        stocks=[{"nmId": 777, "warehouseId": 1, "quantity": 4, "warehouseName": "Коледино"}],
    ))

    result = await warehouse.sync_store(store, settings)

    assert result.ok
    assert result.stored == {"sales": 2, "orders": 1, "stocks": 1}
    assert len(await warehouse.read_rows(store.id, "sales")) == 2


async def test_report_is_built_from_storage_without_touching_the_marketplace(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a"), sale(today, "b")],
        orders=[order(today, "o1"), order(today, "o2")],
        stocks=[{"nmId": 777, "warehouseId": 1, "quantity": 4}],
    ))
    await warehouse.sync_store(store, settings)

    # Площадка «отключается»: дальше отчёт обязан считаться из базы.
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("отчёт не должен ходить в маркетплейс")

    mock_wb(monkeypatch, refuse)

    report = await warehouse.report_for(store, period(3), settings)

    assert report.revenue == 2000
    assert report.orders == 2
    assert report.stock_units == 4
    assert report.connected is True
    assert report.error == ""


async def test_any_period_is_served_from_one_download(store, monkeypatch):
    today = date.today()
    rows = [sale(today - timedelta(days=offset), f"s{offset}") for offset in range(10)]
    mock_wb(monkeypatch, wb_handler(sales=rows, orders=[]))
    await warehouse.sync_store(store, settings)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("площадку больше не трогаем")

    mock_wb(monkeypatch, refuse)

    week = await warehouse.report_for(store, period(7), settings)
    three = await warehouse.report_for(store, period(3), settings)

    assert week.revenue == 7000
    assert three.revenue == 3000


async def test_failed_source_is_remembered_and_shown_as_warning(store, monkeypatch):
    today = date.today()

    def handler(request: httpx.Request) -> httpx.Response:
        if "stocks-report" in request.url.path:
            return httpx.Response(403, json={"detail": "no scope"})
        if "sales" in request.url.path:
            return httpx.Response(200, json=[sale(today, "a")])
        return httpx.Response(200, json=[order(today, "o1")])

    mock_wb(monkeypatch, handler)
    result = await warehouse.sync_store(store, settings)

    assert "stocks" in result.errors
    assert result.stored["sales"] == 1

    report = await warehouse.report_for(store, period(3), settings)
    assert report.revenue == 1000
    assert any("остатки" in warning for warning in report.warnings)


async def test_sync_status_reports_what_was_downloaded(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(sales=[sale(today, "a")], orders=[]))
    await warehouse.sync_store(store, settings)

    status = await warehouse.status(settings)

    assert status["syncedAt"]
    assert status["stores"][0]["title"] == "ВБ Основной"
    assert status["stores"][0]["sources"]["sales"]["rows"] == 1


async def test_forget_removes_everything_about_the_store(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(sales=[sale(today, "a")], orders=[]))
    await warehouse.sync_store(store, settings)

    await warehouse.forget(store.id)

    assert await warehouse.read_rows(store.id, "sales") == []
    assert await warehouse.status(settings) == {"stores": [], "syncedAt": "", "running": False}


async def test_sync_all_skips_stores_without_keys(dashboard_db, monkeypatch):
    await db.init_db()
    empty = await conn.create("wildberries", "Без ключей")
    assert empty.id

    results = await warehouse.sync_all(settings)
    assert results == []


# --- дозагрузка вместо полной перекачки -----------------------------------------


async def test_first_sync_downloads_the_whole_history(store, monkeypatch):
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.params.get("dateFrom", ""))
        return httpx.Response(200, json=[] if "supplier" in request.url.path else {"items": []})

    mock_wb(monkeypatch, handler)
    result = await warehouse.sync_store(store, settings)

    assert [value for value in asked if value]
    assert result.full is True
    horizon = date.today() - timedelta(days=settings.history_days - 1)
    assert result.date_from == horizon


async def test_next_sync_only_asks_for_recent_changes(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(sales=[sale(today, "a")], orders=[]))
    await warehouse.sync_store(store, settings)

    from dashboard.connectors import wildberries

    wildberries.reset_cache()          # иначе ответ переиспользуется из памяти

    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.params.get("dateFrom", ""))
        return httpx.Response(200, json=[] if "supplier" in request.url.path else {"items": []})

    mock_wb(monkeypatch, handler)
    result = await warehouse.sync_store(store, settings)

    assert result.full is False
    assert result.date_from == today - timedelta(days=warehouse.OVERLAP_DAYS)

    # У остатков параметра dateFrom нет — смотрим только запросы статистики.
    windows = [value for value in asked if value]
    assert windows
    assert all(str(today - timedelta(days=warehouse.OVERLAP_DAYS)) in value for value in windows)


async def test_old_rows_are_pruned_beyond_the_retention_window(store):
    today = date.today()
    horizon = today - timedelta(days=settings.history_days - 1)
    await warehouse.store_rows(store.id, "sales", [
        sale(today, "fresh"),
        sale(horizon - timedelta(days=5), "ancient"),
    ], today)

    removed = await warehouse.prune(store.id, horizon)

    assert removed == 1
    assert {row["srid"] for row in await warehouse.read_rows(store.id, "sales")} == {"fresh"}


async def test_pruning_never_touches_stock_snapshot(store):
    today = date.today()
    await warehouse.store_rows(
        store.id, "stocks", [{"nmId": 1, "warehouseId": 2, "quantity": 5}],
        today - timedelta(days=900),
    )
    await warehouse.prune(store.id, today)
    assert len(await warehouse.read_rows(store.id, "stocks")) == 1


# --- терпение при ограничении частоты -------------------------------------------


async def test_background_sync_waits_out_the_rate_limit(store, monkeypatch):
    """Площадка просит подождать — фоновая выгрузка ждёт и получает данные.

    Страница в это время читает из базы, поэтому пауза никому не мешает.
    """
    today = date.today()
    attempts = {"sales": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if "sales" in request.url.path:
            attempts["sales"] += 1
            if attempts["sales"] == 1:
                return httpx.Response(
                    429, json={"detail": "rate limit"}, headers={"X-RateLimit-Retry": "1"}
                )
            return httpx.Response(200, json=[sale(today, "a")])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[order(today, "o1")])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    result = await warehouse.sync_store(store, settings)

    assert attempts["sales"] == 2          # дождались и повторили
    assert result.stored["sales"] == 1
    assert "sales" not in result.errors


async def test_interactive_check_does_not_hang_on_a_long_rate_limit(monkeypatch):
    """Кнопка «Проверить связь» не должна ждать минуту — лучше честно сказать."""
    from dashboard.config import MarketplaceCredentials
    from dashboard.connectors.wildberries import PATIENCE_INTERACTIVE

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, json={"detail": "rate limit"}, headers={"X-RateLimit-Retry": "300"}
        )

    mock_wb(monkeypatch, handler)
    credentials = MarketplaceCredentials(
        code="wildberries", title="Wildberries",
        values={"token": "token-value"}, required=("token",),
    )
    connector = WildberriesConnector(credentials)

    raw = await connector.collect_raw(date.today(), PATIENCE_INTERACTIVE)

    assert "ограничивает частоту" in raw["errors"]["sales"]


# --- углубление истории ---------------------------------------------------------


async def test_deeper_history_triggers_a_full_download(store, monkeypatch):
    """Увеличили глубину хранения — недостающее нужно докачать.

    Иначе длинные периоды («Год») молча показывали бы данные только за то
    время, что успели выгрузить раньше.
    """
    today = date.today()
    windows: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        window = request.url.params.get("dateFrom", "")
        if window:
            windows.append(window[:10])
        if "sales" in request.url.path:
            return httpx.Response(200, json=[sale(today, "a")])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[order(today, "o1")])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)

    shallow = replace(settings, history_days=30)
    await warehouse.sync_store(store, shallow)
    from dashboard.connectors import wildberries

    wildberries.reset_cache()
    windows.clear()

    deep = replace(settings, history_days=400)
    result = await warehouse.sync_store(store, deep)

    assert result.full is True
    assert result.date_from == today - timedelta(days=399)
    assert all(value == str(today - timedelta(days=399)) for value in windows)


async def test_unchanged_history_depth_keeps_incremental_sync(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(sales=[sale(today, "a")], orders=[order(today, "o1")]))
    await warehouse.sync_store(store, settings)

    from dashboard.connectors import wildberries

    wildberries.reset_cache()
    result = await warehouse.sync_store(store, settings)

    assert result.full is False
    assert result.date_from == today - timedelta(days=warehouse.OVERLAP_DAYS)


async def test_coverage_is_remembered_only_for_successful_sources(store, monkeypatch):
    today = date.today()

    def handler(request: httpx.Request) -> httpx.Response:
        if "orders" in request.url.path:
            return httpx.Response(500, text="boom")
        if "sales" in request.url.path:
            return httpx.Response(200, json=[sale(today, "a")])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    await warehouse.sync_store(store, settings)

    # Заказы не выгрузились — значит период не покрыт целиком.
    assert await warehouse.covered_from(store.id, ("sales", "orders", "stocks")) is None
