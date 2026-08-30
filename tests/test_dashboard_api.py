"""HTTP-слой панели: данные, раскладки, доступ."""

from datetime import date

import pytest
from fastapi.testclient import TestClient

from dashboard.config import settings
from dashboard.main import create_app


@pytest.fixture
def client(dashboard_db):
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def protected_client(dashboard_db):
    """Панель с включённым паролем."""
    object.__setattr__(settings, "password", "секрет")
    with TestClient(create_app()) as test_client:
        yield test_client
    object.__setattr__(settings, "password", "")


def test_health_is_open(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_index_and_static_assets_are_served(client):
    assert client.get("/").status_code == 200
    assert client.get("/assets/css/app.css").status_code == 200
    assert client.get("/assets/js/app.js").status_code == 200
    assert client.get("/assets/js/inbox.js").status_code == 200
    assert client.get("/favicon.svg").status_code == 200


def test_overview_returns_totals_and_marketplaces(client):
    payload = client.get("/api/overview?preset=7d").json()
    assert payload["period"]["days"] == 7
    assert len(payload["marketplaces"]) == 4
    assert payload["totals"]["revenue"] == 0      # ключей нет — и выдумывать нечего
    assert all(not report["connected"] for report in payload["marketplaces"])


def test_overview_respects_marketplace_filter(client):
    payload = client.get("/api/overview?preset=today&marketplaces=ozon,ali").json()
    assert [item["marketplace"] for item in payload["marketplaces"]] == ["ozon", "ali"]


def test_overview_accepts_custom_range(client):
    payload = client.get("/api/overview?from=2025-03-01&to=2025-03-05").json()
    assert payload["period"]["from"] == "2025-03-01"
    assert payload["period"]["days"] == 5


def test_overview_swaps_reversed_range(client):
    payload = client.get("/api/overview?from=2025-03-05&to=2025-03-01").json()
    assert payload["period"]["from"] == "2025-03-01"
    assert payload["period"]["to"] == "2025-03-05"


def test_overview_rejects_broken_date(client):
    assert client.get("/api/overview?from=вчера&to=сегодня").status_code == 400


def test_overview_rejects_range_longer_than_year(client):
    assert client.get("/api/overview?from=2020-01-01&to=2025-01-01").status_code == 400


def test_marketplaces_without_keys_are_marked_empty(client):
    payload = client.get("/api/marketplaces").json()
    codes = [item["code"] for item in payload["marketplaces"]]
    assert codes == ["wildberries", "ozon", "yandex", "ali"]
    assert all(item["state"] == "empty" for item in payload["marketplaces"])
    assert not any(item["demo"] for item in payload["marketplaces"])
    assert all(item["requires"] for item in payload["marketplaces"])


def test_blocks_catalog_is_returned(client):
    catalog = client.get("/api/blocks").json()["catalog"]
    assert len(catalog) > 10
    assert {"type", "title", "group", "sizes", "defaultSize"} <= set(catalog[0])


def test_default_layout_is_created_on_first_run(client):
    payload = client.get("/api/layouts").json()
    assert len(payload["layouts"]) == 1
    assert payload["layouts"][0]["blocks"]
    assert payload["active"] == payload["layouts"][0]["name"]


def test_layout_is_saved_and_read_back(client):
    name = client.get("/api/layouts").json()["layouts"][0]["name"]
    blocks = [{"id": "b1", "type": "kpi.revenue", "size": "sm", "hidden": True}]
    assert client.put(f"/api/layouts/{name}", json={"blocks": blocks}).status_code == 200

    saved = client.get("/api/layouts").json()["layouts"][0]["blocks"]
    assert len(saved) == 1
    assert saved[0]["type"] == "kpi.revenue"
    assert saved[0]["hidden"] is True


def test_saving_unknown_block_type_is_ignored(client):
    name = client.get("/api/layouts").json()["layouts"][0]["name"]
    client.put(f"/api/layouts/{name}", json={"blocks": [{"id": "x", "type": "выполнить.всё"}]})
    saved = client.get("/api/layouts").json()["layouts"][0]["blocks"]
    assert all(block["type"] != "выполнить.всё" for block in saved)


def test_new_tab_can_be_created_and_deleted(client):
    client.put("/api/layouts/Финансы", json={"blocks": [{"type": "kpi.profit", "size": "sm"}]})
    names = [item["name"] for item in client.get("/api/layouts").json()["layouts"]]
    assert "Финансы" in names

    assert client.delete("/api/layouts/Финансы").status_code == 200
    names = [item["name"] for item in client.get("/api/layouts").json()["layouts"]]
    assert "Финансы" not in names


def test_last_layout_cannot_be_deleted(client):
    name = client.get("/api/layouts").json()["layouts"][0]["name"]
    assert client.delete(f"/api/layouts/{name}").status_code == 400


def test_layout_rename_keeps_blocks(client):
    name = client.get("/api/layouts").json()["layouts"][0]["name"]
    before = len(client.get("/api/layouts").json()["layouts"][0]["blocks"])
    assert client.post(f"/api/layouts/{name}/rename", json={"name": "Продажи"}).status_code == 200

    layouts = client.get("/api/layouts").json()["layouts"]
    assert layouts[0]["name"] == "Продажи"
    assert len(layouts[0]["blocks"]) == before


def test_rename_to_existing_name_is_rejected(client):
    client.put("/api/layouts/Финансы", json={"blocks": []})
    name = client.get("/api/layouts").json()["layouts"][0]["name"]
    assert client.post(f"/api/layouts/{name}/rename", json={"name": "Финансы"}).status_code == 409


def test_reset_restores_default_blocks(client):
    name = client.get("/api/layouts").json()["layouts"][0]["name"]
    client.put(f"/api/layouts/{name}", json={"blocks": []})
    restored = client.post(f"/api/layouts/{name}/reset").json()
    assert len(restored["blocks"]) > 5


def test_block_instance_has_unique_id(client):
    first = client.post("/api/blocks/instance", json={"type": "kpi.revenue"}).json()
    second = client.post("/api/blocks/instance", json={"type": "kpi.revenue"}).json()
    assert first["id"] != second["id"]
    assert first["type"] == "kpi.revenue"


def test_unknown_block_instance_is_rejected(client):
    assert client.post("/api/blocks/instance", json={"type": "нет.такого"}).status_code == 400


def test_cache_can_be_cleared(client):
    assert client.post("/api/cache/clear").json()["cleared"] is True


# --- доступ по паролю ---------------------------------------------------------


def test_data_requires_login_when_password_is_set(protected_client):
    assert protected_client.get("/api/overview").status_code == 401
    assert protected_client.get("/api/layouts").status_code == 401
    assert protected_client.get("/api/health").status_code == 200


def test_session_reports_auth_state(protected_client):
    session = protected_client.get("/api/session").json()
    assert session["authEnabled"] is True
    assert session["authenticated"] is False


def test_wrong_password_is_rejected(protected_client):
    assert protected_client.post("/api/auth/login", json={"password": "нет"}).status_code == 401


def test_login_opens_access_and_logout_closes_it(protected_client):
    assert protected_client.post("/api/auth/login", json={"password": "секрет"}).status_code == 200
    assert protected_client.get("/api/overview?preset=today").status_code == 200

    protected_client.post("/api/auth/logout")
    assert protected_client.get("/api/overview?preset=today").status_code == 401


# --- магазины и их ключи --------------------------------------------------------


def add_store(client, marketplace, title):
    return client.post("/api/connections", json={"marketplace": marketplace, "title": title}).json()


def stores_of(client, code):
    payload = client.get("/api/connections").json()
    return [item for item in payload["marketplaces"] if item["code"] == code][0]["connections"]


def test_connections_start_empty(client):
    payload = client.get("/api/connections").json()
    assert [item["code"] for item in payload["marketplaces"]] == \
        ["wildberries", "ozon", "yandex", "ali"]
    assert all(not item["connections"] for item in payload["marketplaces"])


def test_two_stores_can_be_added_to_one_marketplace(client):
    add_store(client, "wildberries", "WB Основной")
    add_store(client, "wildberries", "WB Второй")
    titles = [store["title"] for store in stores_of(client, "wildberries")]
    assert titles == ["WB Основной", "WB Второй"]


def test_store_on_unknown_marketplace_is_rejected(client):
    assert client.post("/api/connections", json={"marketplace": "avito"}).status_code == 404


def test_saved_key_comes_back_only_as_a_tail(client):
    created = add_store(client, "wildberries", "WB")["created"]
    client.put(f"/api/connections/{created}", json={"values": {"token": "secret-token-7777"}})

    response = client.get("/api/connections")
    assert "secret-token-7777" not in response.text

    field = stores_of(client, "wildberries")[0]["fields"][0]
    assert field["filled"] is True
    assert field["tail"] == "••••7777"


def test_store_becomes_configured_when_all_keys_are_in(client):
    created = add_store(client, "ozon", "Ozon")["created"]
    client.put(f"/api/connections/{created}", json={"values": {"client_id": "12345"}})
    assert stores_of(client, "ozon")[0]["configured"] is False
    assert stores_of(client, "ozon")[0]["missing"] == ["api_key"]

    client.put(f"/api/connections/{created}", json={"values": {"api_key": "key"}})
    assert stores_of(client, "ozon")[0]["configured"] is True


def test_marketplace_reports_number_of_ready_stores(client):
    first = add_store(client, "wildberries", "WB 1")["created"]
    second = add_store(client, "wildberries", "WB 2")["created"]
    client.put(f"/api/connections/{first}", json={"values": {"token": "t1"}})
    client.put(f"/api/connections/{second}", json={"values": {"token": "t2"}})

    payload = client.get("/api/marketplaces").json()["marketplaces"]
    wildberries = [item for item in payload if item["code"] == "wildberries"][0]
    assert wildberries["stores"] == 2
    assert wildberries["state"] == "connected"
    assert [item for item in payload if item["code"] == "yandex"][0]["state"] == "empty"


def test_store_can_be_renamed_and_switched_off(client):
    created = add_store(client, "wildberries", "Старое")["created"]
    client.put(f"/api/connections/{created}", json={"values": {"token": "t"}})

    client.put(f"/api/connections/{created}", json={"title": "Новое"})
    assert stores_of(client, "wildberries")[0]["title"] == "Новое"

    client.put(f"/api/connections/{created}", json={"enabled": False})
    assert stores_of(client, "wildberries")[0]["enabled"] is False

    payload = client.get("/api/marketplaces").json()["marketplaces"]
    assert [item for item in payload if item["code"] == "wildberries"][0]["stores"] == 0


def test_store_deletion_removes_it_from_the_list(client):
    created = add_store(client, "wildberries", "WB")["created"]
    assert client.delete(f"/api/connections/{created}").status_code == 200
    assert stores_of(client, "wildberries") == []


def test_env_store_cannot_be_edited_through_the_page(client):
    assert client.put("/api/connections/env:wildberries", json={"title": "нет"}).status_code == 400
    assert client.delete("/api/connections/env:wildberries").status_code == 400


def test_testing_a_store_without_keys_asks_to_fill_them(client):
    created = add_store(client, "ozon", "Ozon")["created"]
    result = client.post(f"/api/connections/{created}/test").json()
    assert result["ok"] is False
    assert result["missing"] == ["client_id", "api_key"]


def test_testing_unknown_store_is_not_found(client):
    assert client.post("/api/connections/c_нет/test").status_code == 404


def test_connections_page_requires_login_when_password_is_set(protected_client):
    assert protected_client.get("/api/connections").status_code == 401
    assert protected_client.post("/api/connections", json={"marketplace": "ozon"}).status_code == 401


def test_connection_test_does_not_double_the_requests(client, monkeypatch):
    """Кнопка «Проверить связь» должна делать по одному запросу на метод:
    лишние обращения упираются в лимиты площадок."""
    import httpx

    from dashboard.connectors.wildberries import WildberriesConnector

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
        if "sales" in request.url.path or "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    def fake_client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesConnector, "client", fake_client)

    created = add_store(client, "wildberries", "WB")["created"]
    client.put(f"/api/connections/{created}", json={"values": {"token": "token"}})

    result = client.post(f"/api/connections/{created}/test").json()

    assert result["ok"] is True
    assert len(result["probes"]) == 3
    assert len(calls) == 3
    assert sorted(calls) == sorted(set(calls))


def test_connection_test_reports_partial_answer(client, monkeypatch):
    import httpx

    from dashboard.connectors.wildberries import WildberriesConnector

    def handler(request: httpx.Request) -> httpx.Response:
        if "stocks-report" in request.url.path:
            return httpx.Response(404, json={"detail": "deprecated"})
        return httpx.Response(200, json=[{"date": "2025-03-01T10:00:00"}])

    def fake_client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesConnector, "client", fake_client)

    created = add_store(client, "wildberries", "WB")["created"]
    client.put(f"/api/connections/{created}", json={"values": {"token": "token"}})

    result = client.post(f"/api/connections/{created}/test").json()

    assert result["ok"] is False
    assert result["partial"] is True
    assert result["summary"] == {"working": 2, "total": 3, "rows": 2}


async def test_saved_layouts_lose_blocks_that_need_cost_price(dashboard_db):
    """Разовая уборка не должна трогать остальные блоки раскладки."""
    import json

    from dashboard import db

    await db.init_db()
    async with db.connect() as connection:
        await connection.execute(
            "UPDATE layouts SET blocks = ?",
            (json.dumps([
                {"id": "a", "type": "kpi.revenue", "size": "sm", "hidden": False,
                 "title": "Выручка"},
                {"id": "b", "type": "panel.unitEconomics", "size": "md", "hidden": False,
                 "title": "Юнит-экономика"},
                {"id": "c", "type": "kpi.profit", "size": "sm", "hidden": False,
                 "title": "Прибыль"},
                {"id": "d", "type": "kpi.orders", "size": "sm", "hidden": False,
                 "title": "Заказы"},
            ], ensure_ascii=False),),
        )
        await connection.execute(
            "DELETE FROM preferences WHERE key = 'cost_price_blocks_hidden'"
        )
        await connection.commit()

    await db.init_db()          # повторный запуск панели — уборка срабатывает
    layouts = await db.list_layouts()

    types = [block["type"] for block in layouts[0]["blocks"]]
    assert types == ["kpi.revenue", "kpi.orders"]


async def test_cleanup_runs_only_once(dashboard_db):
    """Владелец мог сознательно вернуть блок — второй раз его убирать нельзя."""
    from dashboard import db

    await db.init_db()
    await db.save_layout("Основной", [
        {"id": "a", "type": "kpi.revenue", "size": "sm"},
        {"id": "b", "type": "panel.unitEconomics", "size": "md"},
    ])

    await db.init_db()          # ещё один запуск панели
    layouts = await db.list_layouts()

    assert "panel.unitEconomics" in {block["type"] for block in layouts[0]["blocks"]}


# --- фильтр по магазинам --------------------------------------------------------


def _two_wb_stores(client, monkeypatch):
    """Два кабинета Wildberries с разной выручкой — 1000 ₽ и 300 ₽ за сегодня."""
    import httpx

    from dashboard.connectors.wildberries import WildberriesConnector

    today = date.today().isoformat()
    prices = {"token-slava": 1000.0, "token-natasha": 300.0}

    # Продажу ставим на начало суток. Период «сегодня» обрывается на текущем
    # моменте, поэтому продажа, помеченная десятью утра, ночью оказалась бы
    # в будущем — и тест падал бы только на ночных выкладках.

    def handler(request: httpx.Request) -> httpx.Response:
        price = prices[request.headers["Authorization"]]
        if "sales-reports/list" in request.url.path:
            return httpx.Response(200, json=[])
        if "sales-reports" in request.url.path:
            return httpx.Response(204)
        if "sales" in request.url.path:
            return httpx.Response(200, json=[{
                "date": f"{today}T00:00:00", "srid": f"s{price}", "saleID": f"S{price}",
                "finishedPrice": price, "forPay": price, "supplierArticle": "ART",
                "nmId": 1, "subject": "Кружка",
            }])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"items": []})

    def fake_client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesConnector, "client", fake_client)

    ids = {}
    for title, token in (("ВБ Вячеслав", "token-slava"), ("ВБ Наталья", "token-natasha")):
        created = add_store(client, "wildberries", title)["created"]
        client.put(f"/api/connections/{created}", json={"values": {"token": token}})
        ids[title] = created

    client.post("/api/sync")
    return ids


def test_store_list_is_published_for_the_switch(client, monkeypatch):
    ids = _two_wb_stores(client, monkeypatch)
    payload = client.get("/api/marketplaces").json()

    titles = [store["title"] for store in payload["stores"]]
    assert titles == ["ВБ Вячеслав", "ВБ Наталья"]
    assert {store["id"] for store in payload["stores"]} == set(ids.values())


def test_overview_can_show_one_store_and_all_together(client, monkeypatch):
    ids = _two_wb_stores(client, monkeypatch)

    together = client.get("/api/overview?preset=today").json()
    slava = client.get(f"/api/overview?preset=today&stores={ids['ВБ Вячеслав']}").json()
    natasha = client.get(f"/api/overview?preset=today&stores={ids['ВБ Наталья']}").json()

    assert together["totals"]["revenue"] == 1300
    assert slava["totals"]["revenue"] == 1000
    assert natasha["totals"]["revenue"] == 300


def test_unknown_store_filter_falls_back_to_all(client, monkeypatch):
    _two_wb_stores(client, monkeypatch)
    payload = client.get("/api/overview?preset=today&stores=нет-такого").json()
    assert payload["totals"]["revenue"] == 1300


def test_store_filter_does_not_blank_out_other_marketplaces(client, monkeypatch):
    """Выбор кабинета — это выбор внутри площадки. Переключившись на один
    магазин Wildberries, руководитель не должен терять из виду Ozon."""
    from dashboard import connections as conn
    from dashboard.connections import Connection

    stores = [
        Connection(id="wb1", marketplace="wildberries", title="ВБ Вячеслав"),
        Connection(id="wb2", marketplace="wildberries", title="ВБ Наталья"),
        Connection(id="oz1", marketplace="ozon", title="Ozon WAAC"),
    ]

    kept = conn.narrow(stores, ("wb2",))

    assert [store.id for store in kept] == ["wb2", "oz1"]
    # Без выбора остаются все.
    assert len(conn.narrow(stores, ())) == 3


# --- черновики помощника --------------------------------------------------------


def test_draft_needs_a_known_item(client):
    """Черновик пишется только по обращению, которое панель уже показывала."""
    answer = client.post("/api/inbox/draft", json={
        "accountId": "нет", "kind": "feedback", "id": "f1",
    })
    assert answer.status_code == 404
    assert "обновите входящие" in answer.json()["detail"].lower()


def test_draft_refuses_incomplete_request(client):
    assert client.post("/api/inbox/draft", json={"kind": "feedback"}).status_code == 400


def test_draft_reports_a_sleeping_bridge(client, monkeypatch, tmp_path):
    """Мост к Codex не запущен — панель обязана сказать это словами,
    а не молчать и не выдумывать ответ."""
    from dashboard import agent, inbox
    from dashboard.connectors.wb_inbox import InboxItem

    inbox.remember([InboxItem(kind="feedback", id="f1", text="Всё плохо",
                              account_id="wb1", account_title="ВБ Вячеслав")])

    async def refuse(*args, **kwargs):
        raise agent.AgentUnavailable("Помощник не ответил вовремя")

    monkeypatch.setattr(agent, "draft", refuse)
    answer = client.post("/api/inbox/draft", json={
        "accountId": "wb1", "kind": "feedback", "id": "f1",
    })

    assert answer.status_code == 503
    assert "не ответил вовремя" in answer.json()["detail"]


def test_draft_returns_the_text_and_the_warning(client, monkeypatch):
    from dashboard import agent, inbox
    from dashboard.connectors.wb_inbox import InboxItem

    inbox.remember([InboxItem(kind="claim", id="c1", text="Верните деньги",
                              account_id="wb1", account_title="ВБ Вячеслав")])

    async def write(item, title, config, facts=""):
        assert item["text"] == "Верните деньги"
        assert title == "ВБ Вячеслав"
        return agent.Draft(answer="Разберёмся.", needs_human=True, why="речь о деньгах")

    monkeypatch.setattr(agent, "draft", write)
    payload = client.post("/api/inbox/draft", json={
        "accountId": "wb1", "kind": "claim", "id": "c1",
    }).json()

    assert payload == {"answer": "Разберёмся.", "needsHuman": True, "why": "речь о деньгах"}


# --- конвейер -------------------------------------------------------------------


def test_batch_needs_a_working_agent(client, monkeypatch):
    """Без моста разбирать нечем — панель обязана сказать это прямо.

    Мост подменяем явно: иначе тест зависел бы от того, установлен ли он
    на машине, где идёт прогон, и падал бы прямо на сервере.
    """
    from dashboard import agent

    monkeypatch.setattr(agent, "available", lambda config=None: False)
    answer = client.post("/api/inbox/batch", json={
        "accountId": "wb1", "kind": "chat", "ids": ["i1"],
    })
    assert answer.status_code == 503
    assert "не настроен" in answer.json()["detail"]


def test_batch_refuses_unknown_chapter(client, monkeypatch):
    from dashboard import agent

    monkeypatch.setattr(agent, "available", lambda config=None: True)
    assert client.post("/api/inbox/batch", json={
        "accountId": "wb1", "kind": "почта", "ids": [],
    }).status_code == 400


def test_batch_runs_and_can_be_read_back(client, monkeypatch):
    from dashboard import agent, inbox, pipeline
    from dashboard.connectors.inbox_base import InboxItem

    pipeline._batches.clear()
    inbox.remember([
        InboxItem(kind="chat", id="i1", text="Когда приедет?", account_id="wb1",
                  account_title="ВБ Вячеслав", marketplace="wildberries"),
    ])

    async def write(item, title, config, facts=""):
        return agent.Draft(answer="Завтра будет у вас.")

    monkeypatch.setattr(agent, "available", lambda config=None: True)
    monkeypatch.setattr(agent, "draft", write)

    started = client.post("/api/inbox/batch", json={
        "accountId": "wb1", "kind": "chat", "ids": ["i1"],
    }).json()
    assert started["total"] == 1

    payload = client.get(f"/api/inbox/batch/{started['id']}").json()
    assert payload["done"] == 1
    assert payload["drafts"][0]["answer"] == "Завтра будет у вас."
    pipeline._batches.clear()


def test_unknown_batch_is_not_found(client):
    assert client.get("/api/inbox/batch/нет-такой").status_code == 404


def test_mass_send_refuses_an_empty_request(client):
    assert client.post("/api/inbox/send", json={
        "accountId": "wb1", "kind": "chat", "answers": {},
    }).status_code == 400


def test_mass_send_refuses_more_than_a_batch(client):
    from dashboard import pipeline

    answers = {f"i{number}": "Ответ" for number in range(pipeline.MAX_BATCH + 1)}
    answer = client.post("/api/inbox/send", json={
        "accountId": "wb1", "kind": "chat", "answers": answers,
    })
    assert answer.status_code == 400
    assert "Слишком много" in answer.json()["detail"]


def test_mass_send_reports_what_went_out(client, monkeypatch):
    from dashboard import inbox

    async def reply(account, kind, item_id, text, config):
        if item_id == "i2":
            raise RuntimeError("отказ")

    monkeypatch.setattr(inbox, "reply", reply)
    payload = client.post("/api/inbox/send", json={
        "accountId": "wb1", "kind": "chat", "answers": {"i1": "Да", "i2": "Нет"},
    }).json()

    assert payload["sent"] == ["i1"]
    assert payload["failed"] == {"i2": "RuntimeError"}


# --- задачи по кабинету ---------------------------------------------------------


def test_tasks_catalogue_is_empty_without_keys(client):
    assert client.get("/api/tasks").json() == {"marketplaces": []}


def test_unknown_task_is_not_found(client):
    assert client.get("/api/tasks/нет-такого/questions").status_code == 404


def test_task_page_size_is_capped(client):
    """Запрос страницы больше разрешённой отвергается, а не молча урезается
    до чего-то другого."""
    from dashboard import tasks

    answer = client.get(f"/api/tasks/wb1/questions?limit={tasks.PAGE + 1}")
    assert answer.status_code == 422


def test_task_offset_cannot_be_negative(client):
    assert client.get("/api/tasks/wb1/questions?offset=-1").status_code == 422


def test_tasks_page_is_served_separately(client):
    """«Задачи» — отдельная страница, а не часть основной панели."""
    page = client.get("/tasks")
    assert page.status_code == 200
    assert "Задачи" in page.text
    # Страница лёгкая: тяжёлых модулей основной панели на ней нет.
    assert "blocks.js" not in page.text
    assert "charts.js" not in page.text
    assert "tasks-page.js" in page.text


def test_assets_are_revalidated_by_the_browser(client):
    """Панель обновляется часто. Браузер обязан переспрашивать, иначе
    свежая страница уедет к пользователю со старым скриптом — и кнопка
    будет на месте, но работать не будет."""
    for path in ("/", "/tasks", "/assets/js/app.js", "/assets/css/app.css"):
        answer = client.get(path)
        assert answer.status_code == 200
        assert "no-cache" in answer.headers.get("cache-control", "")


def test_main_page_links_to_the_tasks_page(client):
    assert 'href="/tasks"' in client.get("/").text


# --- справочник товаров ---------------------------------------------------------


def test_knowledge_starts_empty(client):
    assert client.get("/api/knowledge").json() == {
        "parents": [], "filled": 0, "named": 0, "total": 0,
    }


def test_knowledge_is_saved_and_listed(client):
    saved = client.put("/api/knowledge/UA-TC-1M-WH", json={
        "title": "Кабель Type-C 1 м", "facts": "Длина 1 м. До 60 Вт.",
    }).json()
    assert saved["filled"] is True

    payload = client.get("/api/knowledge").json()
    assert payload["total"] == 1
    assert payload["filled"] == 1
    assert payload["parents"][0]["parent"] == "UA-TC-1M-WH"


def test_knowledge_page_is_served(client):
    page = client.get("/knowledge")
    assert page.status_code == 200
    assert "Справочник ответов" in page.text
    assert "knowledge-page.js" in page.text


def test_tasks_page_links_to_the_knowledge_page(client):
    assert 'href="/knowledge"' in client.get("/tasks").text


# --- товары ---------------------------------------------------------------------


def test_products_page_is_served(client):
    """«Товары» — отдельный раздел, не часть справочника ответов."""
    page = client.get("/products")
    assert page.status_code == 200
    assert "products-page.js" in page.text
    # И между разделами есть переходы в обе стороны.
    assert 'href="/knowledge"' in page.text
    assert 'href="/products"' in client.get("/knowledge").text


def test_products_start_empty(client):
    assert client.get("/api/products").json() == {"parents": [], "total": 0, "cards": 0}


def test_unknown_card_is_not_found(client):
    assert client.get("/api/products/card/нет-такой").status_code == 404
    assert client.put("/api/products/card/нет-такой/note",
                      json={"note": "текст"}).status_code == 404
