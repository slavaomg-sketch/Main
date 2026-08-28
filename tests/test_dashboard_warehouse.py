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


def finance(day: date, rrd_id: int, price: float = 1000.0, doc: str = "Продажа") -> dict:
    """Строка детализации отчёта реализации — так её отдаёт Wildberries."""
    return {
        "rrdId": rrd_id, "rrDate": day.isoformat(), "saleDt": f"{day.isoformat()}T10:00:00Z",
        "docTypeName": doc, "quantity": 1, "retailAmount": price, "forPay": price * 0.85,
        "nmId": 777, "vendorCode": "ART-1", "subjectName": "Кружка", "brandName": "Бренд",
    }


def wb_handler(sales, orders, stocks=None, finance_rows=None, balance=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if "account/balance" in request.url.path:
            return httpx.Response(200, json=balance or {"current": 0, "for_withdraw": 0})
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            if not finance_rows:
                return httpx.Response(204)
            return httpx.Response(200, json=finance_rows)
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
    assert result.stored == {"reports": 0, "balance": 1, "sales": 2, "orders": 1,
                             "stocks": 1, "finance": 0}
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
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
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
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
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
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
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
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
        if "sales" in request.url.path:
            return httpx.Response(200, json=[sale(today, "a")])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    await warehouse.sync_store(store, settings)

    # Заказы не выгрузились — значит период не покрыт целиком.
    assert await warehouse.covered_from(store.id, ("sales", "orders", "stocks")) is None


# --- глубина хранения на стороне площадки ---------------------------------------


async def test_period_deeper_than_available_data_is_flagged(store, monkeypatch):
    """Wildberries хранит статистику около полугода.

    Запрошенный «Год» покажет меньше — и панель обязана сказать об этом,
    иначе неполная цифра выглядит достоверной.
    """
    today = date.today()
    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today - timedelta(days=30), "a")], orders=[]
    ))
    await warehouse.sync_store(store, settings)

    deep = Period(date_from=today - timedelta(days=300), date_to=today)
    report = await warehouse.report_for(store, deep, settings)

    assert report.data_from == today - timedelta(days=30)
    assert any("не хранит статистику глубже" in note for note in report.notes)
    # Это пояснение, а не сбой: тревогу «часть данных не пришла» оно не поднимает.
    assert report.warnings == []


async def test_period_within_available_data_is_not_flagged(store, monkeypatch):
    today = date.today()
    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today - timedelta(days=30), "a")], orders=[]
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(7), settings)

    assert not any("глубже" in note for note in report.notes)


# --- отчёт реализации: глубина за пределами статистики --------------------------


async def test_finance_rows_are_stored_by_the_day_of_the_sale():
    """Дата операции бывает на день-другой позже самой продажи — по дням
    отчёт должен ложиться так же, как статистика."""
    row = {"rrdId": 4242, "rrDate": "2026-01-15", "saleDt": "2026-01-14T10:00:00Z"}
    assert warehouse.row_key("finance", row, 0) == "4242"
    assert warehouse.row_day("finance", row, date.today()) == date(2026, 1, 14)
    # Если даты продажи нет, остаётся дата операции.
    assert warehouse.row_day("finance", {"rrDate": "2026-01-15"}, date.today()) == date(2026, 1, 15)


async def test_finance_fills_the_days_statistics_no_longer_keeps(store, monkeypatch):
    today = date.today()
    deep = today - timedelta(days=8)

    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a")],
        orders=[order(today, "o1")],
        finance_rows=[finance(deep, 1), finance(deep, 2)],
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(14), settings)

    # 1000 из статистики за сегодня плюс 2000 из отчёта реализации за глубокий день.
    assert report.revenue == 3000
    assert report.payout == pytest.approx(1000 * 0.85 * 3)


async def test_finance_does_not_double_count_days_statistics_already_covers(store, monkeypatch):
    today = date.today()

    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a")],
        orders=[order(today, "o1")],
        finance_rows=[finance(today, 1)],
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(3), settings)

    assert report.revenue == 1000


async def test_finance_returns_reduce_revenue(store, monkeypatch):
    today = date.today()
    deep = today - timedelta(days=8)

    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a")],
        orders=[],
        finance_rows=[finance(deep, 1), finance(deep, 2, doc="Возврат")],
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(14), settings)

    assert report.revenue == 1000
    assert report.returns == 1


async def test_finance_ignores_lines_that_are_not_sales(store, monkeypatch):
    today = date.today()
    deep = today - timedelta(days=8)
    logistics = finance(deep, 3, doc="Логистика")

    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a")], orders=[], finance_rows=[logistics],
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(14), settings)

    assert report.revenue == 1000


async def test_deep_period_says_where_the_numbers_came_from(store, monkeypatch):
    today = date.today()
    deep = today - timedelta(days=8)

    mock_wb(monkeypatch, wb_handler(
        sales=[sale(today, "a")], orders=[], finance_rows=[finance(deep, 1)],
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(14), settings)

    assert any("финансового отчёта" in note for note in report.notes)
    assert report.warnings == []


async def test_finance_is_downloaded_page_by_page(store, monkeypatch):
    from dashboard.connectors import wildberries

    monkeypatch.setattr(wildberries, "FINANCE_PAGE", 2)
    today = date.today()
    deep = today - timedelta(days=8)
    asked: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            import json as _json

            body = _json.loads(request.content)
            asked.append(body["rrdId"])
            if body["rrdId"] == 0:
                return httpx.Response(200, json=[finance(deep, 1), finance(deep, 2)])
            return httpx.Response(204)
        if "sales" in request.url.path:
            return httpx.Response(200, json=[])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    result = await warehouse.sync_store(store, settings)

    assert asked == [0, 2]
    assert result.stored["finance"] == 2


async def test_finance_is_never_asked_for_dates_wildberries_has_no_reports(store, monkeypatch):
    from dashboard.connectors import wildberries

    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            import json as _json

            asked.append(_json.loads(request.content)["dateFrom"])
            return httpx.Response(204)
        if "sales" in request.url.path:
            return httpx.Response(200, json=[])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    await warehouse.sync_store(store, replace(settings, history_days=5000))

    assert asked == [wildberries.FINANCE_SINCE.isoformat()]


async def test_next_finance_sync_only_asks_for_recent_changes(store, monkeypatch):
    today = date.today()
    deep = today - timedelta(days=8)
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            import json as _json

            asked.append(_json.loads(request.content)["dateFrom"])
            return httpx.Response(200, json=[finance(deep, 1)])
        if "sales" in request.url.path:
            return httpx.Response(200, json=[])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    await warehouse.sync_store(store, settings)
    from dashboard.connectors import wildberries

    wildberries.reset_cache()
    await warehouse.sync_store(store, settings)

    # Второй заход начинается от последнего сохранённого дня с перекрытием.
    assert asked[1] == (deep - timedelta(days=warehouse.OVERLAP_DAYS)).isoformat()


# --- сверка с личным кабинетом --------------------------------------------------


async def test_revenue_is_buyouts_minus_returns_and_both_halves_are_visible(store, monkeypatch):
    """В приложении Wildberries показывают валовые выкупы. Панель считает
    выручку чистой, поэтому обе половины должны быть видны по отдельности."""
    today = date.today()
    bought = sale(today, "a", price=1000.0)
    returned = sale(today, "b", price=250.0)
    returned["saleID"] = "R-b"

    mock_wb(monkeypatch, wb_handler(sales=[bought, returned], orders=[]))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(3), settings)

    assert report.gross_revenue == 1000
    assert report.returns_amount == 250
    assert report.revenue == report.gross_revenue - report.returns_amount == 750


async def test_finance_days_also_split_buyouts_and_returns(store, monkeypatch):
    today = date.today()
    deep = today - timedelta(days=8)

    mock_wb(monkeypatch, wb_handler(
        sales=[], orders=[],
        finance_rows=[finance(deep, 1, price=800.0),
                      finance(deep, 2, price=200.0, doc="Возврат")],
    ))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(14), settings)

    assert report.gross_revenue == 800
    assert report.returns_amount == 200
    assert report.revenue == 600


async def test_wider_column_set_forces_a_full_finance_download(store, monkeypatch):
    """Новые колонки отчёта в уже скачанных строках взяться неоткуда —
    такую выгрузку надо повторить целиком, иначе за старые месяцы их не будет."""
    from dashboard.connectors import wildberries

    today = date.today()
    deep = today - timedelta(days=8)
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            import json as _json

            asked.append(_json.loads(request.content)["dateFrom"])
            return httpx.Response(200, json=[finance(deep, 1)])
        if "sales" in request.url.path or "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    await warehouse.sync_store(store, settings)
    wildberries.reset_cache()

    # Обычная выгрузка забирает только свежее...
    await warehouse.sync_store(store, settings)
    assert asked[1] != asked[0]

    # ...а расширение набора колонок снова поднимает всю историю.
    wildberries.reset_cache()
    monkeypatch.setattr(wildberries, "FINANCE_FIELDS_VERSION", 99)
    await warehouse.sync_store(store, settings)
    assert asked[2] == asked[0]


async def test_source_check_lines_up_both_wildberries_sources(store, monkeypatch):
    """Дни, покрытые обоими источниками, должны сходиться — сверка
    показывает итоги рядом, чтобы расхождение было видно сразу."""
    from dashboard import reconcile

    today = date.today()
    yesterday = today - timedelta(days=1)

    row = sale(yesterday, "a", price=1000.0)
    row["priceWithDisc"] = 1000.0
    mock_wb(monkeypatch, wb_handler(
        sales=[row], orders=[],
        finance_rows=[finance(yesterday, 1, price=1000.0)],
    ))
    await warehouse.sync_store(store, settings)

    check = await reconcile.check_day(store.id, yesterday)

    assert check["статистика"]["выкупы:priceWithDisc"] == 1000
    assert check["финотчёт по дате продажи"]["выкупы:retailAmount"] == 1000
    assert check["финотчёт по дате продажи"]["типы строк"] == {"Продажа": 1}


async def test_deep_days_use_the_same_two_bases_as_fresh_days(store, monkeypatch):
    """Одна логика на все периоды: выручка по цене продавца, отдельно —
    сколько из неё заплатил покупатель."""
    today = date.today()
    deep = today - timedelta(days=8)

    row = finance(deep, 1, price=1145.0)
    row["retailPriceWithDisc"] = 1547.0

    mock_wb(monkeypatch, wb_handler(sales=[], orders=[], finance_rows=[row]))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(14), settings)

    assert report.gross_revenue == 1547
    assert report.buyer_paid == 1145
    assert report.revenue == 1547


async def test_fresh_days_match_the_marketplace_app(store, monkeypatch):
    today = date.today()
    row = sale(today, "a", price=1145.0)
    row["priceWithDisc"] = 1547.0

    mock_wb(monkeypatch, wb_handler(sales=[row], orders=[]))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(3), settings)

    assert report.gross_revenue == 1547   # столько показывает приложение
    assert report.buyer_paid == 1145      # столько заплатил покупатель


# --- заказы в деньгах и разрез по родителям -------------------------------------


async def test_orders_are_counted_in_money_too(store, monkeypatch):
    today = date.today()
    first = order(today, "o1")
    first["priceWithDisc"] = 1000.0
    second = order(today, "o2")
    second["priceWithDisc"] = 500.0

    mock_wb(monkeypatch, wb_handler(sales=[], orders=[first, second]))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(3), settings)

    assert report.orders == 2
    assert report.orders_amount == 1500
    assert report.avg_check == 750


async def test_average_check_is_broken_down_by_parent_article(store, monkeypatch):
    """Кабель TC-TC-1M и TC-TC-2M — разные родители, и чек у них свой."""
    today = date.today()

    def with_article(row: dict, article: str, price: float) -> dict:
        row["supplierArticle"] = article
        row["priceWithDisc"] = price
        return row

    orders = [
        with_article(order(today, "o1"), "TC-TC-1M", 400.0),
        with_article(order(today, "o2"), "TC-TC-1M", 600.0),
        with_article(order(today, "o3"), "TC-TC-2M", 1500.0),
    ]
    mock_wb(monkeypatch, wb_handler(sales=[], orders=orders))
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(3), settings)
    by_article = {parent.article: parent for parent in report.parents}

    assert by_article["TC-TC-1M"].orders == 2
    assert by_article["TC-TC-1M"].avg_check == 500
    assert by_article["TC-TC-2M"].orders == 1
    assert by_article["TC-TC-2M"].avg_check == 1500
    # Дороже — выше в списке.
    assert report.parents[0].article == "TC-TC-2M"


# --- баланс кабинета и его прирост ----------------------------------------------


async def test_balance_is_recorded_once_a_day(store, monkeypatch):
    """Площадка отдаёт только «сейчас» — историю панель ведёт сама,
    перезаписывая запись текущего дня."""
    today = date.today()

    mock_wb(monkeypatch, wb_handler(
        sales=[], orders=[], balance={"current": 100000, "for_withdraw": 25000},
    ))
    await warehouse.sync_store(store, settings)

    from dashboard.connectors import wildberries

    wildberries.reset_cache()
    mock_wb(monkeypatch, wb_handler(
        sales=[], orders=[], balance={"current": 130000, "for_withdraw": 30000},
    ))
    await warehouse.sync_store(store, settings)

    history = await warehouse.balance_history(store.id, today)
    assert len(history) == 1
    assert history[0]["current"] == 130000


async def test_balance_growth_over_the_period_is_the_money_that_arrived(store, monkeypatch):
    """Прирост баланса — это и есть деньги, начисленные за период."""
    from dashboard.models import MarketplaceReport

    today = date.today()
    mock_wb(monkeypatch, wb_handler(sales=[], orders=[], balance={"current": 0}))
    await warehouse.sync_store(store, settings)

    # Подкладываем историю за три дня, как её накопила бы панель.
    for offset, amount in ((2, 500_000.0), (1, 560_000.0), (0, 610_000.0)):
        day = today - timedelta(days=offset)
        await warehouse.store_rows(
            store.id, "balance",
            [{"day": day.isoformat(), "current": amount, "forWithdraw": amount / 2}],
            day,
        )

    report = MarketplaceReport(marketplace="wildberries", title="WB")
    await warehouse.apply_balance(report, store.id, period(1))   # только сегодня

    assert report.balance_delta_known is True
    assert report.balance_delta == 50_000        # 610 000 − 560 000
    assert report.balance_current == 610_000
    assert report.balance_for_withdraw == 305_000


async def test_balance_growth_needs_a_day_to_compare_with(store, monkeypatch):
    """Одной записи мало: пока сравнивать не с чем, прирост не показывается."""
    from dashboard.models import MarketplaceReport

    mock_wb(monkeypatch, wb_handler(
        sales=[], orders=[], balance={"current": 700000, "for_withdraw": 0},
    ))
    await warehouse.sync_store(store, settings)

    report = MarketplaceReport(marketplace="wildberries", title="WB")
    await warehouse.apply_balance(report, store.id, period(1))

    assert report.balance_current == 700000
    assert report.balance_delta_known is False
    assert report.balance_delta == 0


# --- ежедневные отчёты реализации -----------------------------------------------


def daily_report(day: date, report_id: int, sale: float, for_pay: float,
                 delivery: float = 0.0, bank: float = 0.0) -> dict:
    """Строка списка отчётов — как её отдаёт Wildberries."""
    return {
        "reportId": report_id,
        "dateFrom": day.isoformat(),
        "dateTo": day.isoformat(),
        "reportType": 1,
        "retailAmountSum": str(sale),
        "forPaySum": str(for_pay),
        "deliveryServiceSum": str(delivery),
        "paidStorageSum": "0",
        "paidAcceptanceSum": "0",
        "penaltySum": "0",
        "deductionSum": "0",
        "bankPaymentSum": str(bank),
    }


async def test_daily_reports_give_the_amount_that_reaches_the_account(store, monkeypatch):
    """«Итого к оплате» площадка считает сама — панель только складывает
    дневные отчёты за период."""
    today = date.today()
    rows = [
        daily_report(today, 1, sale=65551.49, for_pay=48810.33, delivery=5000, bank=43000),
        daily_report(today, 2, sale=5563.33, for_pay=3692.90, delivery=400, bank=3200),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if "account/balance" in request.url.path:
            return httpx.Response(200, json={"current": 0, "for_withdraw": 0})
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=rows)
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
        if "sales" in request.url.path or "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    mock_wb(monkeypatch, handler)
    await warehouse.sync_store(store, settings)

    report = await warehouse.report_for(store, period(3), settings)

    # За день два отчёта: основной и по выкупам — складываются вместе.
    assert report.reports_count == 2
    assert report.bank_payment == pytest.approx(46200)
    assert report.report_sale == pytest.approx(71114.82)
    assert report.delivery_cost == pytest.approx(5400)
