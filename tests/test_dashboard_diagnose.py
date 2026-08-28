"""Самодиагностика: вывод должен быть полезным и безопасным для пересылки."""

from datetime import date

import httpx
import pytest

from dashboard import diagnose
from dashboard.config import MarketplaceCredentials, load_settings
from dashboard.connectors.base import Probe
from dashboard.connectors.wildberries import WildberriesConnector
from dashboard.models import Period

TOKEN = "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.secret-token-value"


def period() -> Period:
    return Period(date_from=date(2025, 3, 1), date_to=date(2025, 3, 3))


def wb_credentials() -> MarketplaceCredentials:
    return MarketplaceCredentials(
        code="wildberries", title="Wildberries",
        values={"token": TOKEN}, required=("token",),
    )


# --- маскирование -------------------------------------------------------------


def test_mask_replaces_secret_with_tail():
    masked = diagnose.mask(f"Authorization: {TOKEN}", [TOKEN])
    assert TOKEN not in masked
    assert masked.endswith("••••" + TOKEN[-4:])


def test_mask_handles_several_secrets():
    masked = diagnose.mask("a=ключ-один b=ключ-два", ["ключ-один", "ключ-два"])
    assert "ключ-один" not in masked and "ключ-два" not in masked


def test_secret_values_skips_empty_and_short():
    config = load_settings()
    object.__setattr__(config, "marketplaces", {
        "wildberries": wb_credentials(),
        "ozon": MarketplaceCredentials(code="ozon", title="Ozon",
                                       values={"client_id": "", "api_key": "ab"},
                                       required=("client_id", "api_key")),
    })
    assert diagnose.secret_values(config) == [TOKEN]


# --- форма значений -----------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        ("2025-03-01T10:20:30", "«9999-99-99x99:99:99»"),
        ("S1234567890", "«x9999999999»"),
        (12345, "число"),
        (12.5, "число"),
        (True, "да/нет"),
        (None, "null"),
        ([1, 2, 3], "список[3]"),
    ],
)
def test_shape_hides_content_but_keeps_format(value, expected):
    assert diagnose.shape(value) == expected


def test_shape_of_dict_lists_keys_only():
    assert diagnose.shape({"amount": 1200, "currency": "RUB"}) == "объект{amount, currency}"


def test_shape_never_leaks_product_names():
    assert "Термокружка" not in diagnose.shape("Термокружка Stelo 450 мл")


def test_describe_rows_lists_field_names_with_shapes():
    lines = diagnose.describe_rows([
        {"date": "2025-03-01T10:00:00", "totalPrice": 1000, "supplierArticle": "ART-1"},
    ])
    text = "\n".join(lines)
    assert "date: «9999-99-99x99:99:99»" in text
    assert "totalPrice: число" in text
    assert "ART-1" not in text


def test_describe_rows_fills_type_from_later_rows():
    lines = diagnose.describe_rows([{"region": None}, {"region": "Москва"}])
    assert "region: «xxxxxx»" in "\n".join(lines)


# --- отчёт по одному запросу ---------------------------------------------------


def test_probe_report_shows_row_count():
    probe = Probe(label="GET /sales", status=200, payload=[{"date": "2025-03-01"}] * 5)
    text = "\n".join(diagnose.describe_probe(probe, [], with_values=False))
    assert "строк: 5" in text


def test_probe_report_explains_empty_answer():
    probe = Probe(label="GET /sales", status=200, payload=[])
    text = "\n".join(diagnose.describe_probe(probe, [], with_values=False))
    assert "пусто" in text


def test_probe_report_masks_secret_inside_error():
    probe = Probe(label="GET /sales", status=401, error=f"bad token {TOKEN}")
    text = "\n".join(diagnose.describe_probe(probe, [TOKEN], with_values=False))
    assert TOKEN not in text
    assert "ОШИБКА 401" in text


def test_values_flag_shows_raw_sample_but_still_masks_secrets():
    probe = Probe(label="GET /sales", status=200,
                  payload=[{"name": "Термокружка", "token": TOKEN}])
    text = "\n".join(diagnose.describe_probe(probe, [TOKEN], with_values=True))
    assert "Термокружка" in text
    assert TOKEN not in text


# --- сквозная проверка на подставном API ---------------------------------------


def mock_wildberries(monkeypatch, handler):
    def client(self):
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesConnector, "client", client)


async def test_check_reports_working_connection(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == TOKEN
        if "sales" in request.url.path:
            return httpx.Response(200, json=[{
                "date": "2025-03-01T10:00:00", "saleID": "S1", "finishedPrice": 1000,
                "forPay": 850, "supplierArticle": "ART-1", "subject": "Кружка",
                "regionName": "Москва",
            }])
        if "orders" in request.url.path:
            return httpx.Response(200, json=[{"date": "2025-03-01T10:00:00", "isCancel": False}])
        return httpx.Response(200, json=[{
            "supplierArticle": "ART-1", "quantity": 4, "warehouseName": "Коледино",
        }])

    mock_wildberries(monkeypatch, handler)
    config = load_settings()
    object.__setattr__(config, "marketplaces", {"wildberries": wb_credentials()})

    text = "\n".join(await diagnose.check("wildberries", period(), config, with_values=False))

    assert TOKEN not in text
    assert "••••" in text
    assert "строк: 1" in text
    assert "выручка посчитана" in text
    assert "Кружка" not in text and "Москва" not in text


async def test_check_reports_bad_token_without_leaking_it(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"invalid token {TOKEN}")

    mock_wildberries(monkeypatch, handler)
    config = load_settings()
    object.__setattr__(config, "marketplaces", {"wildberries": wb_credentials()})

    text = "\n".join(await diagnose.check("wildberries", period(), config, with_values=False))

    assert "ОШИБКА 401" in text
    assert TOKEN not in text


async def test_check_skips_marketplace_without_keys():
    config = load_settings()
    object.__setattr__(config, "marketplaces", {
        "ozon": MarketplaceCredentials(code="ozon", title="Ozon",
                                       values={"client_id": "", "api_key": ""},
                                       required=("client_id", "api_key")),
    })
    text = "\n".join(await diagnose.check("ozon", period(), config, with_values=False))
    assert "ключи не заданы" in text
    assert "client_id" in text


async def test_run_rejects_unknown_marketplace():
    assert "Неизвестная площадка" in await diagnose.run(7, "озон", False)


async def test_run_covers_all_marketplaces_by_default():
    text = await diagnose.run(7, None, False)
    for title in ("Wildberries", "Ozon", "Яндекс Маркет", "AliExpress"):
        assert title in text


# --- вымарывание на уровне коннектора -----------------------------------------


def test_connector_redacts_its_own_keys():
    connector = WildberriesConnector(wb_credentials())
    assert TOKEN not in connector.redact(f"ответ площадки: {TOKEN}")
    assert connector.redact("обычный текст") == "обычный текст"


async def test_report_error_does_not_contain_key(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise RuntimeError(f"сломалось на ключе {TOKEN}")

    mock_wildberries(monkeypatch, handler)
    report = await WildberriesConnector(wb_credentials()).safe_fetch(period())
    assert report.error
    assert TOKEN not in report.error


async def test_probe_error_does_not_contain_key(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text=f"forbidden for {TOKEN}")

    mock_wildberries(monkeypatch, handler)
    probes = await WildberriesConnector(wb_credentials()).probe(period())
    assert probes and all(TOKEN not in probe.error for probe in probes)
    assert all(probe.status == 403 for probe in probes)
