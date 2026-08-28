"""HTTP-слой панели: данные, раскладки, доступ."""

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
    assert client.get("/favicon.svg").status_code == 200


def test_overview_returns_totals_and_marketplaces(client):
    payload = client.get("/api/overview?preset=7d").json()
    assert payload["period"]["days"] == 7
    assert len(payload["marketplaces"]) == 4
    assert payload["totals"]["revenue"] > 0
    assert payload["deltas"]["revenue"]["change"] is not None


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


def test_marketplaces_report_demo_state(client):
    payload = client.get("/api/marketplaces").json()
    codes = [item["code"] for item in payload["marketplaces"]]
    assert codes == ["wildberries", "ozon", "yandex", "ali"]
    assert all(item["demo"] for item in payload["marketplaces"])
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
