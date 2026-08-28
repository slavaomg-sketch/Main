"""Хранилище раскладок.

SQLite через aiosqlite — та же зависимость, что уже используется ботом,
отдельный файл базы. Хранятся именованные раскладки («вкладки» панели)
и пара служебных настроек.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, AsyncIterator

import aiosqlite

from .blocks import default_layout, new_block, sanitize_layout
from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS layouts (
    name       TEXT PRIMARY KEY,
    position   INTEGER NOT NULL DEFAULT 0,
    blocks     TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Магазины: у одной площадки их может быть несколько.
CREATE TABLE IF NOT EXISTS connections (
    id          TEXT PRIMARY KEY,
    marketplace TEXT NOT NULL,
    title       TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);

-- Ключи магазина, введённые через страницу настроек.
-- Значение хранится зашифрованным (см. dashboard/connections.py).
CREATE TABLE IF NOT EXISTS credentials (
    connection_id TEXT NOT NULL,
    field         TEXT NOT NULL,
    value         TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (connection_id, field)
);

-- Выгрузка площадок: сырые строки, как их отдал маркетплейс.
-- Отчёт за любой период считается уже отсюда, без обращения к площадке.
CREATE TABLE IF NOT EXISTS marketplace_rows (
    connection_id TEXT NOT NULL,
    source        TEXT NOT NULL,
    row_id        TEXT NOT NULL,
    day           TEXT NOT NULL,
    payload       TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (connection_id, source, row_id)
);

CREATE INDEX IF NOT EXISTS marketplace_rows_by_day
    ON marketplace_rows (connection_id, source, day);

-- Когда какой источник выгружался в последний раз и чем это кончилось.
CREATE TABLE IF NOT EXISTS sync_state (
    connection_id TEXT NOT NULL,
    source        TEXT NOT NULL,
    synced_at     TEXT NOT NULL,
    error         TEXT NOT NULL DEFAULT '',
    -- С какой даты выгрузка реально запрашивалась. По ней видно, что глубину
    -- истории увеличили и недостающее нужно докачать.
    covered_from  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (connection_id, source)
);
"""

DEFAULT_LAYOUT_NAME = "Основной"


@asynccontextmanager
async def connect() -> AsyncIterator[aiosqlite.Connection]:
    """Соединение с базой панели. Файл и каталог создаются при первом обращении."""
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    existed = settings.db_path.exists()
    connection = await aiosqlite.connect(settings.db_path)
    if not existed:
        # В базе лежат ключи маркетплейсов — читать её должен только владелец.
        try:
            settings.db_path.chmod(0o600)
        except OSError:  # на некоторых файловых системах права не выставить
            pass
    connection.row_factory = aiosqlite.Row
    try:
        yield connection
    finally:
        await connection.close()


async def _drop_pre_release_credentials(db: aiosqlite.Connection) -> None:
    """Убрать таблицу ключей первой редакции — она была «по площадке».

    Магазинов у площадки может быть несколько, поэтому ключи переехали
    на подключения. Перенести старые записи не к чему: подключений тогда
    ещё не существовало.
    """
    cursor = await db.execute("PRAGMA table_info(credentials)")
    columns = {row["name"] for row in await cursor.fetchall()}
    if columns and "connection_id" not in columns:
        await db.execute("DROP TABLE credentials")


async def _add_missing_columns(db: aiosqlite.Connection) -> None:
    """Дозаписать столбцы, появившиеся в новых версиях панели."""
    additions = {
        "sync_state": {"covered_from": "TEXT NOT NULL DEFAULT ''"},
    }
    for table, columns in additions.items():
        cursor = await db.execute(f"PRAGMA table_info({table})")
        existing = {row["name"] for row in await cursor.fetchall()}
        if not existing:
            continue  # таблицы ещё нет — её создаст схема
        for name, definition in columns.items():
            if name not in existing:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


# Блоки, которые нельзя честно посчитать без себестоимости товара.
# Пока её негде взять, они убираются из готовых раскладок — вернуть их
# можно в любой момент через библиотеку блоков.
NEEDS_COST_PRICE = ("panel.unitEconomics", "kpi.profit")


async def _hide_blocks_without_cost_price(db: aiosqlite.Connection) -> None:
    """Разовая уборка: убрать из сохранённых раскладок блоки, считающие прибыль."""
    cursor = await db.execute(
        "SELECT value FROM preferences WHERE key = 'cost_price_blocks_hidden'"
    )
    if await cursor.fetchone():
        return

    cursor = await db.execute("SELECT name, blocks FROM layouts")
    for row in await cursor.fetchall():
        blocks = json.loads(row["blocks"])
        kept = [block for block in blocks if block.get("type") not in NEEDS_COST_PRICE]
        if len(kept) != len(blocks):
            await db.execute(
                "UPDATE layouts SET blocks = ? WHERE name = ?",
                (json.dumps(kept, ensure_ascii=False), row["name"]),
            )

    await db.execute(
        "INSERT OR REPLACE INTO preferences (key, value) VALUES ('cost_price_blocks_hidden', '1')"
    )


# Блоки сверки с личным кабинетом площадки: «Выкупы» и «Возвраты, ₽».
# Без них выручку панели («выкупы минус возвраты») не с чем было сопоставить —
# в приложении маркетплейса показывают валовые выкупы.
RECONCILIATION_BLOCKS = ("kpi.grossRevenue", "kpi.returnsAmount", "kpi.buyerPaid")


async def _add_blocks_once(
    db: aiosqlite.Connection,
    marker: str,
    types: tuple[str, ...],
    after_type: str = "kpi.revenue",
    size: str | None = None,
) -> None:
    """Разово доставить новые блоки в уже сохранённые раскладки.

    Иначе их пришлось бы искать в библиотеке вручную — а владелец панели
    о новом блоке ещё не знает. Убрать лишнее он всегда может сам.
    """
    cursor = await db.execute("SELECT value FROM preferences WHERE key = ?", (marker,))
    if await cursor.fetchone():
        return

    cursor = await db.execute("SELECT name, blocks FROM layouts")
    for row in await cursor.fetchall():
        blocks = json.loads(row["blocks"])
        present = {block.get("type") for block in blocks}
        missing = [item for item in types if item not in present]
        if not missing:
            continue

        after = next(
            (index for index, block in enumerate(blocks) if block.get("type") == after_type),
            len(blocks) - 1,
        )
        blocks[after + 1 : after + 1] = [new_block(item, size) for item in missing]
        await db.execute(
            "UPDATE layouts SET blocks = ? WHERE name = ?",
            (json.dumps(blocks, ensure_ascii=False), row["name"]),
        )

    await db.execute(
        "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, '1')", (marker,)
    )


async def init_db() -> None:
    async with connect() as db:
        await _drop_pre_release_credentials(db)
        await db.executescript(SCHEMA)
        await _add_missing_columns(db)
        await _hide_blocks_without_cost_price(db)
        await _add_blocks_once(db, "reconciliation_blocks_added_3", RECONCILIATION_BLOCKS, size="sm")
        # Заказы и возвраты — в штуках и в деньгах сразу, плюс разрез
        # по родительским артикулам: об этом просил владелец панели.
        await _add_blocks_once(db, "returns_block_added", ("kpi.returns",), size="sm")
        await _add_blocks_once(
            db, "parents_table_added", ("table.parents",), after_type="table.topProducts"
        )
        await db.commit()
        cursor = await db.execute("SELECT COUNT(*) AS total FROM layouts")
        row = await cursor.fetchone()
        if not row or row["total"] == 0:
            await _insert_layout(db, DEFAULT_LAYOUT_NAME, default_layout(), position=0)
            await db.commit()


async def _insert_layout(
    db: aiosqlite.Connection, name: str, blocks: list[dict[str, Any]], position: int
) -> None:
    await db.execute(
        "INSERT OR REPLACE INTO layouts (name, position, blocks, updated_at)"
        " VALUES (?, ?, ?, ?)",
        (name, position, json.dumps(blocks, ensure_ascii=False), datetime.utcnow().isoformat()),
    )


async def list_layouts() -> list[dict[str, Any]]:
    async with connect() as db:
        cursor = await db.execute(
            "SELECT name, position, blocks, updated_at FROM layouts ORDER BY position, name"
        )
        rows = await cursor.fetchall()
    return [
        {
            "name": row["name"],
            "position": row["position"],
            "blocks": sanitize_layout(json.loads(row["blocks"])),
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


async def get_layout(name: str) -> dict[str, Any] | None:
    async with connect() as db:
        cursor = await db.execute(
            "SELECT name, position, blocks, updated_at FROM layouts WHERE name = ?", (name,)
        )
        row = await cursor.fetchone()
    if not row:
        return None
    return {
        "name": row["name"],
        "position": row["position"],
        "blocks": sanitize_layout(json.loads(row["blocks"])),
        "updatedAt": row["updated_at"],
    }


async def save_layout(name: str, blocks: Any) -> dict[str, Any]:
    clean = sanitize_layout(blocks)
    async with connect() as db:
        cursor = await db.execute("SELECT position FROM layouts WHERE name = ?", (name,))
        row = await cursor.fetchone()
        if row is None:
            cursor = await db.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM layouts")
            next_row = await cursor.fetchone()
            position = int(next_row["next"]) if next_row else 0
        else:
            position = int(row["position"])
        await _insert_layout(db, name, clean, position)
        await db.commit()
    return {"name": name, "position": position, "blocks": clean}


async def delete_layout(name: str) -> bool:
    async with connect() as db:
        cursor = await db.execute("SELECT COUNT(*) AS total FROM layouts")
        row = await cursor.fetchone()
        if row and row["total"] <= 1:
            return False  # последнюю вкладку не удаляем — панели не на чем держаться
        await db.execute("DELETE FROM layouts WHERE name = ?", (name,))
        await db.commit()
    return True


async def rename_layout(old_name: str, new_name: str) -> bool:
    async with connect() as db:
        cursor = await db.execute("SELECT 1 FROM layouts WHERE name = ?", (new_name,))
        if await cursor.fetchone():
            return False
        await db.execute("UPDATE layouts SET name = ? WHERE name = ?", (new_name, old_name))
        await db.commit()
    return True


async def get_preference(key: str, default: str = "") -> str:
    async with connect() as db:
        cursor = await db.execute("SELECT value FROM preferences WHERE key = ?", (key,))
        row = await cursor.fetchone()
    return row["value"] if row else default


async def set_preference(key: str, value: str) -> None:
    async with connect() as db:
        await db.execute(
            "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", (key, value)
        )
        await db.commit()
