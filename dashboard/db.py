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

from .blocks import default_layout, sanitize_layout
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
"""

DEFAULT_LAYOUT_NAME = "Основной"


@asynccontextmanager
async def connect() -> AsyncIterator[aiosqlite.Connection]:
    """Соединение с базой панели. Файл и каталог создаются при первом обращении."""
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = await aiosqlite.connect(settings.db_path)
    connection.row_factory = aiosqlite.Row
    try:
        yield connection
    finally:
        await connection.close()


async def init_db() -> None:
    async with connect() as db:
        await db.executescript(SCHEMA)
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
