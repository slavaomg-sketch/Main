"""Подключение к SQLite и схема базы данных."""

from __future__ import annotations

import logging
from pathlib import Path

import aiosqlite

log = logging.getLogger(__name__)

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Сотрудники и администраторы
CREATE TABLE IF NOT EXISTS users (
    tg_id      INTEGER PRIMARY KEY,
    username   TEXT,
    full_name  TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'employee',   -- employee | admin
    tz         TEXT NOT NULL DEFAULT 'Europe/Moscow',
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

-- Шаблоны напоминаний: общие (создаёт админ) и личные (создаёт сотрудник)
CREATE TABLE IF NOT EXISTS reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    scope        TEXT NOT NULL DEFAULT 'global',   -- global | personal
    owner_id     INTEGER,                          -- автор; для личных — сам сотрудник
    is_mandatory INTEGER NOT NULL DEFAULT 1,       -- общие: обязательное или по желанию
    default_time TEXT NOT NULL DEFAULT '09:00',
    days         TEXT NOT NULL DEFAULT '1,2,3,4,5',
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users (tg_id) ON DELETE CASCADE
);

-- Пункты чек-листа внутри напоминания
CREATE TABLE IF NOT EXISTS checklist_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reminder_id INTEGER NOT NULL,
    text        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (reminder_id) REFERENCES reminders (id) ON DELETE CASCADE
);

-- Подписка сотрудника на напоминание со своим временем получения
CREATE TABLE IF NOT EXISTS subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    reminder_id INTEGER NOT NULL,
    time        TEXT NOT NULL,
    days        TEXT,                              -- NULL = дни берутся из напоминания
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    UNIQUE (user_id, reminder_id),
    FOREIGN KEY (user_id) REFERENCES users (tg_id) ON DELETE CASCADE,
    FOREIGN KEY (reminder_id) REFERENCES reminders (id) ON DELETE CASCADE
);

-- Факт отправки напоминания в конкретный день
CREATE TABLE IF NOT EXISTS deliveries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id  INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    reminder_id      INTEGER NOT NULL,
    title            TEXT NOT NULL,                -- снимок названия на момент отправки
    local_date       TEXT NOT NULL,                -- YYYY-MM-DD в поясе сотрудника
    scheduled_time   TEXT NOT NULL,                -- HH:MM
    sent_at          TEXT,
    chat_message_id  INTEGER,
    status           TEXT NOT NULL DEFAULT 'sent', -- sent | done | partial | missed | failed
    first_response_at TEXT,
    completed_at     TEXT,
    nudged_at        TEXT,
    comment          TEXT,          -- пояснение сотрудника, попадает в отчёт
    commented_at     TEXT,
    UNIQUE (subscription_id, local_date, scheduled_time),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (tg_id) ON DELETE CASCADE
);

-- Снимок пунктов чек-листа для конкретной отправки
CREATE TABLE IF NOT EXISTS delivery_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL,
    text        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_done     INTEGER NOT NULL DEFAULT 0,
    done_at     TEXT,
    FOREIGN KEY (delivery_id) REFERENCES deliveries (id) ON DELETE CASCADE
);

-- Журнал отправленных отчётов, чтобы не слать один и тот же дважды
CREATE TABLE IF NOT EXISTS report_log (
    admin_id   INTEGER NOT NULL,
    local_date TEXT NOT NULL,
    sent_at    TEXT NOT NULL,
    PRIMARY KEY (admin_id, local_date)
);

CREATE INDEX IF NOT EXISTS idx_subs_user     ON subscriptions (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_deliv_date    ON deliveries (local_date, status);
CREATE INDEX IF NOT EXISTS idx_deliv_user    ON deliveries (user_id, local_date);
CREATE INDEX IF NOT EXISTS idx_items_deliv   ON delivery_items (delivery_id);
CREATE INDEX IF NOT EXISTS idx_items_rem     ON checklist_items (reminder_id, position);
"""


# Столбцы, добавленные после первого релиза. Для новых баз они уже есть в SCHEMA,
# для работающих — доставляются здесь, чтобы обновление не требовало ручных действий.
MIGRATIONS: list[tuple[str, str, str]] = [
    ("deliveries", "comment", "comment TEXT"),
    ("deliveries", "commented_at", "commented_at TEXT"),
]


async def _apply_migrations(conn: aiosqlite.Connection) -> None:
    for table, column, ddl in MIGRATIONS:
        async with conn.execute(f"PRAGMA table_info({table})") as cur:
            existing = {row["name"] for row in await cur.fetchall()}
        if column not in existing:
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
            log.info("Миграция: в таблицу %s добавлен столбец %s", table, column)
    await conn.commit()


async def connect(db_path: str | Path) -> aiosqlite.Connection:
    """Открывает соединение, создаёт файл и схему при первом запуске."""
    path = Path(db_path)
    if path.parent and str(path.parent) not in ("", "."):
        path.parent.mkdir(parents=True, exist_ok=True)

    conn = await aiosqlite.connect(path)
    conn.row_factory = aiosqlite.Row
    await conn.executescript(SCHEMA)
    await conn.commit()
    await _apply_migrations(conn)
    log.info("База данных готова: %s", path)
    return conn
