"""Подключения магазинов.

Одна площадка — не обязательно один магазин: у продавца может быть два
кабинета на Wildberries, два на Ozon и по одному на Яндексе и AliExpress.
Поэтому ключи хранятся не «по площадке», а «по подключению»: у каждого
магазина своё название и свой набор ключей.

Ключи можно задать двумя способами:

* через страницу «Ключи» в панели — тогда они лежат в базе в зашифрованном
  виде и подхватываются без перезапуска;
* в файле `.env` — такое подключение показывается отдельной строкой
  с пометкой «из .env» и правится только на сервере.

Шифрование — Fernet с ключом, выведенным из `DASHBOARD_SECRET`. Это защищает
копию базы, унесённую отдельно от `.env`. Если сменить `DASHBOARD_SECRET`,
сохранённые ключи придётся ввести заново.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from . import db
from .config import MarketplaceCredentials, Settings, settings

log = logging.getLogger(__name__)

DEFAULT_SECRET = "change-me-in-production"
KDF_ROUNDS = 200_000
KDF_SALT = b"dashboard-credentials-v1"
MAX_CONNECTIONS = 20
ENV_PREFIX = "env:"


@dataclass(frozen=True)
class Field:
    """Одно поле ввода на странице настроек."""

    key: str
    label: str
    hint: str = ""
    required: bool = True


# Порядок полей = порядок строк ввода на странице.
FIELDS: dict[str, tuple[Field, ...]] = {
    "wildberries": (
        Field("token", "Токен API",
              "Личный кабинет → Настройки → Доступ к API, категория «Статистика»"),
    ),
    "ozon": (
        Field("client_id", "Client-Id", "Seller → Настройки → API-ключи, номер вида 12345"),
        Field("api_key", "Api-Key", "Там же, длинная строка с дефисами"),
    ),
    "yandex": (
        Field("api_key", "Api-Key", "Кабинет продавца → Настройки → API"),
        Field("campaign_id", "Номер кампании", "Виден в адресе кабинета и в списке магазинов"),
        Field("business_id", "Номер бизнеса", "Нужен не всем методам", required=False),
    ),
    "ali": (
        Field("app_key", "App Key", "openservice.aliexpress.com → ваше приложение"),
        Field("app_secret", "App Secret", "Там же, рядом с App Key"),
        Field("access_token", "Access Token", "Выдаётся после привязки магазина к приложению"),
    ),
}

DOCS: dict[str, str] = {
    "wildberries": "https://openapi.wildberries.ru",
    "ozon": "https://docs.ozon.ru/api/seller",
    "yandex": "https://yandex.ru/dev/market/partner-api",
    "ali": "https://openservice.aliexpress.com",
}


@dataclass
class Connection:
    """Один магазин на одной площадке."""

    id: str
    marketplace: str
    title: str
    enabled: bool = True
    source: str = "panel"          # panel — введено в панели, env — из .env
    values: dict[str, str] = field(default_factory=dict)

    def credentials(self, config: Settings | None = None) -> MarketplaceCredentials:
        config = config or settings
        base = config.marketplaces[self.marketplace]
        return MarketplaceCredentials(
            code=base.code,
            title=self.title,
            values=dict(self.values),
            required=base.required,
        )

    @property
    def configured(self) -> bool:
        return self.credentials().configured

    def missing(self, config: Settings | None = None) -> list[str]:
        credentials = self.credentials(config)
        return [key for key in credentials.required if not credentials.get(key)]


# --- шифрование ---------------------------------------------------------------


@lru_cache(maxsize=4)
def _cipher(secret: str) -> Fernet:
    derived = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), KDF_SALT, KDF_ROUNDS, dklen=32)
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(value: str) -> str:
    return _cipher(settings.session_secret).encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Расшифровать значение. Пустая строка означает «прочитать не смогли»."""
    try:
        return _cipher(settings.session_secret).decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        log.warning("Не удалось расшифровать сохранённый ключ — сменился DASHBOARD_SECRET?")
        return ""


def secret_is_default() -> bool:
    return settings.session_secret == DEFAULT_SECRET


# --- чтение -------------------------------------------------------------------


def env_connection(code: str, config: Settings) -> Connection | None:
    """Подключение из .env — если там заполнено хоть одно поле площадки."""
    base = config.marketplaces[code]
    values = {key: value for key, value in base.values.items() if value}
    if not values:
        return None
    return Connection(
        id=f"{ENV_PREFIX}{code}",
        marketplace=code,
        title=f"{base.title} (.env)",
        enabled=True,
        source="env",
        values=values,
    )


async def load(config: Settings | None = None) -> list[Connection]:
    """Все подключения: сначала из .env, затем добавленные в панели."""
    config = config or settings

    connections: list[Connection] = []
    for code in config.marketplaces:
        from_env = env_connection(code, config)
        if from_env:
            connections.append(from_env)

    async with db.connect() as connection:
        cursor = await connection.execute(
            "SELECT id, marketplace, title, enabled FROM connections ORDER BY position, title"
        )
        rows = await cursor.fetchall()
        cursor = await connection.execute(
            "SELECT connection_id, field, value FROM credentials"
        )
        secrets = await cursor.fetchall()

    values: dict[str, dict[str, str]] = {}
    for row in secrets:
        decrypted = decrypt(row["value"])
        if decrypted:
            values.setdefault(row["connection_id"], {})[row["field"]] = decrypted

    for row in rows:
        if row["marketplace"] not in config.marketplaces:
            continue
        connections.append(
            Connection(
                id=row["id"],
                marketplace=row["marketplace"],
                title=row["title"],
                enabled=bool(row["enabled"]),
                source="panel",
                values=values.get(row["id"], {}),
            )
        )
    return connections


async def get(connection_id: str, config: Settings | None = None) -> Connection | None:
    for connection in await load(config):
        if connection.id == connection_id:
            return connection
    return None


def active(connections: list[Connection], codes: tuple[str, ...]) -> list[Connection]:
    """Подключения, у которых есть все обязательные ключи и которые не выключены."""
    return [
        connection
        for connection in connections
        if connection.marketplace in codes and connection.enabled and connection.configured
    ]


# --- изменение ----------------------------------------------------------------


async def create(marketplace: str, title: str, config: Settings | None = None) -> Connection:
    config = config or settings
    if marketplace not in config.marketplaces:
        raise ValueError("Неизвестная площадка")

    async with db.connect() as connection:
        cursor = await connection.execute("SELECT COUNT(*) AS total FROM connections")
        row = await cursor.fetchone()
        if row and row["total"] >= MAX_CONNECTIONS:
            raise ValueError(f"Больше {MAX_CONNECTIONS} магазинов панель не хранит")

        cursor = await connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM connections"
        )
        position_row = await cursor.fetchone()
        position = int(position_row["next"]) if position_row else 0

        new_id = f"c_{uuid.uuid4().hex[:10]}"
        await connection.execute(
            "INSERT INTO connections (id, marketplace, title, position, enabled, created_at)"
            " VALUES (?, ?, ?, ?, 1, ?)",
            (new_id, marketplace, title.strip()[:60] or "Магазин",
             position, datetime.utcnow().isoformat()),
        )
        await connection.commit()

    return Connection(id=new_id, marketplace=marketplace, title=title.strip()[:60] or "Магазин")


async def save_values(connection_id: str, values: dict[str, str]) -> None:
    """Сохранить ключи подключения. Пустое значение стирает сохранённое."""
    target = await get(connection_id)
    if target is None or target.source == "env":
        raise ValueError("Это подключение правится только в файле .env")

    known = {item.key for item in FIELDS.get(target.marketplace, ())}
    stamp = datetime.utcnow().isoformat()

    async with db.connect() as connection:
        for key, raw in values.items():
            if key not in known:
                continue
            value = str(raw or "").strip()
            if value:
                await connection.execute(
                    "INSERT OR REPLACE INTO credentials (connection_id, field, value, updated_at)"
                    " VALUES (?, ?, ?, ?)",
                    (connection_id, key, encrypt(value), stamp),
                )
            else:
                await connection.execute(
                    "DELETE FROM credentials WHERE connection_id = ? AND field = ?",
                    (connection_id, key),
                )
        await connection.commit()


async def update(connection_id: str, *, title: str | None = None, enabled: bool | None = None) -> None:
    target = await get(connection_id)
    if target is None or target.source == "env":
        raise ValueError("Это подключение правится только в файле .env")

    async with db.connect() as connection:
        if title is not None:
            await connection.execute(
                "UPDATE connections SET title = ? WHERE id = ?",
                (title.strip()[:60] or target.title, connection_id),
            )
        if enabled is not None:
            await connection.execute(
                "UPDATE connections SET enabled = ? WHERE id = ?",
                (1 if enabled else 0, connection_id),
            )
        await connection.commit()


async def delete(connection_id: str) -> None:
    if connection_id.startswith(ENV_PREFIX):
        raise ValueError("Это подключение правится только в файле .env")
    async with db.connect() as connection:
        await connection.execute("DELETE FROM credentials WHERE connection_id = ?", (connection_id,))
        await connection.execute("DELETE FROM connections WHERE id = ?", (connection_id,))
        await connection.commit()


# --- описание для интерфейса ---------------------------------------------------


def tail(value: str) -> str:
    """Хвост ключа — по нему видно, что введено, но восстановить нельзя."""
    if not value:
        return ""
    if len(value) <= 4:
        return "••••"
    return "••••" + value[-4:]


def describe(connections: list[Connection], config: Settings | None = None) -> list[dict[str, Any]]:
    """Состояние подключений для страницы «Ключи» — без самих ключей."""
    config = config or settings
    grouped: list[dict[str, Any]] = []

    for code, base in config.marketplaces.items():
        items = []
        for connection in connections:
            if connection.marketplace != code:
                continue
            items.append({
                "id": connection.id,
                "title": connection.title,
                "enabled": connection.enabled,
                "source": connection.source,
                "editable": connection.source == "panel",
                "configured": connection.configured,
                "missing": connection.missing(config),
                "fields": [
                    {
                        "key": item.key,
                        "label": item.label,
                        "hint": item.hint,
                        "required": item.required,
                        "filled": bool(connection.values.get(item.key)),
                        "tail": tail(connection.values.get(item.key, "")),
                    }
                    for item in FIELDS.get(code, ())
                ],
            })

        grouped.append({
            "code": code,
            "title": base.title,
            "docs": DOCS.get(code, ""),
            "fields": [
                {"key": item.key, "label": item.label, "hint": item.hint, "required": item.required}
                for item in FIELDS.get(code, ())
            ],
            "connections": items,
        })
    return grouped
