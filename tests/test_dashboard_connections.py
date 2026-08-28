"""Магазины: хранение ключей, шифрование, несколько кабинетов на площадке."""

from datetime import date

import pytest

from dashboard import connections as conn
from dashboard import db
from dashboard.config import settings
from dashboard.models import Period


@pytest.fixture
async def store(dashboard_db):
    await db.init_db()
    return dashboard_db


def period() -> Period:
    return Period(date_from=date(2025, 3, 1), date_to=date(2025, 3, 3))


# --- шифрование ---------------------------------------------------------------


def test_value_round_trips_through_encryption():
    assert conn.decrypt(conn.encrypt("токен-магазина")) == "токен-магазина"


def test_encrypted_value_does_not_contain_original():
    assert "токен-магазина" not in conn.encrypt("токен-магазина")


def test_same_value_encrypts_differently_each_time():
    assert conn.encrypt("одно и то же") != conn.encrypt("одно и то же")


def test_wrong_secret_yields_empty_value_not_crash():
    encrypted = conn.encrypt("секретный ключ")
    original = settings.session_secret
    object.__setattr__(settings, "session_secret", "совсем другой секрет")
    try:
        assert conn.decrypt(encrypted) == ""
    finally:
        object.__setattr__(settings, "session_secret", original)


def test_garbage_does_not_break_decryption():
    assert conn.decrypt("не шифртекст") == ""


@pytest.mark.parametrize(
    "value, expected",
    [("", ""), ("abc", "••••"), ("very-long-token-ABCD", "••••ABCD")],
)
def test_tail_shows_only_last_characters(value, expected):
    assert conn.tail(value) == expected


# --- несколько магазинов на площадке -------------------------------------------


async def test_two_stores_on_one_marketplace(store):
    first = await conn.create("wildberries", "WB Основной")
    second = await conn.create("wildberries", "WB Второй")
    await conn.save_values(first.id, {"token": "token-one-AAAA"})
    await conn.save_values(second.id, {"token": "token-two-BBBB"})

    loaded = await conn.load()
    wb = [item for item in loaded if item.marketplace == "wildberries"]
    assert [item.title for item in wb] == ["WB Основной", "WB Второй"]
    assert [item.values["token"] for item in wb] == ["token-one-AAAA", "token-two-BBBB"]
    assert all(item.configured for item in wb)


async def test_store_without_all_required_keys_is_not_configured(store):
    created = await conn.create("ozon", "Ozon без ключа")
    await conn.save_values(created.id, {"client_id": "12345"})

    loaded = await conn.get(created.id)
    assert loaded.configured is False
    assert loaded.missing() == ["api_key"]


async def test_saving_ignores_fields_the_marketplace_does_not_have(store):
    created = await conn.create("wildberries", "WB")
    await conn.save_values(created.id, {"token": "ok-token", "api_key": "лишнее"})

    loaded = await conn.get(created.id)
    assert loaded.values == {"token": "ok-token"}


async def test_empty_value_erases_saved_key(store):
    created = await conn.create("wildberries", "WB")
    await conn.save_values(created.id, {"token": "token-to-erase"})
    await conn.save_values(created.id, {"token": ""})

    assert (await conn.get(created.id)).values == {}


async def test_rename_and_disable_store(store):
    created = await conn.create("ozon", "Старое имя")
    await conn.update(created.id, title="Новое имя", enabled=False)

    loaded = await conn.get(created.id)
    assert loaded.title == "Новое имя"
    assert loaded.enabled is False


async def test_delete_removes_store_with_its_keys(store):
    created = await conn.create("wildberries", "WB")
    await conn.save_values(created.id, {"token": "token"})
    await conn.delete(created.id)

    assert await conn.get(created.id) is None
    async with db.connect() as connection:
        cursor = await connection.execute("SELECT COUNT(*) AS total FROM credentials")
        assert (await cursor.fetchone())["total"] == 0


async def test_unknown_marketplace_is_rejected(store):
    with pytest.raises(ValueError):
        await conn.create("avito", "Магазин")


async def test_connection_count_is_capped(store):
    for index in range(conn.MAX_CONNECTIONS):
        await conn.create("wildberries", f"Магазин {index}")
    with pytest.raises(ValueError):
        await conn.create("wildberries", "Лишний")


# --- подключение из .env --------------------------------------------------------


def test_env_connection_appears_when_keys_are_in_env():
    config = settings
    original = config.marketplaces["wildberries"]
    object.__setattr__(
        config,
        "marketplaces",
        dict(config.marketplaces, wildberries=type(original)(
            code="wildberries", title="Wildberries",
            values={"token": "env-token"}, required=("token",),
        )),
    )
    try:
        from_env = conn.env_connection("wildberries", config)
        assert from_env is not None
        assert from_env.source == "env"
        assert from_env.id.startswith(conn.ENV_PREFIX)
        assert from_env.configured
    finally:
        object.__setattr__(
            config, "marketplaces", dict(config.marketplaces, wildberries=original)
        )


def test_no_env_connection_without_keys():
    assert conn.env_connection("wildberries", settings) is None


async def test_env_connection_cannot_be_edited(store):
    with pytest.raises(ValueError):
        await conn.save_values(conn.ENV_PREFIX + "wildberries", {"token": "x"})
    with pytest.raises(ValueError):
        await conn.delete(conn.ENV_PREFIX + "wildberries")


# --- описание для интерфейса ----------------------------------------------------


async def test_describe_never_exposes_key_values(store):
    created = await conn.create("wildberries", "WB")
    await conn.save_values(created.id, {"token": "super-secret-token-9999"})

    described = conn.describe(await conn.load(), settings)
    text = repr(described)
    assert "super-secret-token-9999" not in text
    assert "••••9999" in text


async def test_describe_groups_stores_by_marketplace(store):
    await conn.create("wildberries", "WB 1")
    await conn.create("wildberries", "WB 2")
    await conn.create("ozon", "Ozon 1")

    described = {item["code"]: item for item in conn.describe(await conn.load(), settings)}
    assert len(described["wildberries"]["connections"]) == 2
    assert len(described["ozon"]["connections"]) == 1
    assert described["yandex"]["connections"] == []
    assert described["wildberries"]["docs"]


async def test_active_skips_disabled_and_unconfigured(store):
    ready = await conn.create("wildberries", "Готовый")
    await conn.save_values(ready.id, {"token": "token"})
    off = await conn.create("wildberries", "Выключенный")
    await conn.save_values(off.id, {"token": "token"})
    await conn.update(off.id, enabled=False)
    await conn.create("wildberries", "Пустой")

    loaded = await conn.load()
    assert [item.title for item in conn.active(loaded, ("wildberries",))] == ["Готовый"]


def test_every_marketplace_has_field_descriptions():
    for code in ("wildberries", "ozon", "yandex", "ali"):
        fields = conn.FIELDS[code]
        assert fields
        assert all(item.label and item.hint for item in fields)
        required = {item.key for item in fields if item.required}
        assert required == set(settings.marketplaces[code].required)
