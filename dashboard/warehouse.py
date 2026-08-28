"""Выгрузка данных площадок на свой сервер.

Раньше каждое переключение периода означало новый запрос к маркетплейсу:
Wildberries отвечает небыстро и держит лимит частоты, поэтому панель ждала
десятки секунд. Теперь строки скачиваются один раз в фоне и складываются
в базу, а отчёт за любой период считается уже из неё — мгновенно.

Хранятся именно **сырые строки**, как их отдала площадка. Так любой период
можно пересчитать задним числом, а изменение логики отчёта не требует
повторной выгрузки.

Данные обновляются:

* при старте панели, если выгрузки ещё нет;
* каждые `DASHBOARD_SYNC_MINUTES` минут в фоне;
* по кнопке «Обновить» в интерфейсе.

Каждая выгрузка перекрывает несколько последних дней (`OVERLAP_DAYS`):
Wildberries уточняет статусы задним числом, и без перекрытия эти правки
не попали бы в панель.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from . import connections, db
from .config import Settings, settings
from .connectors import REAL_CONNECTORS
from .connectors.wildberries import WildberriesConnector
from .models import MarketplaceReport, Period

log = logging.getLogger(__name__)

# Площадки, данные которых складываются в хранилище.
# Остальные пока опрашиваются напрямую при каждом запросе.
STORED: dict[str, tuple[str, ...]] = {
    "wildberries": ("sales", "orders", "stocks"),
}

# Насколько дней назад заходим при обычной выгрузке: Wildberries правит
# статусы задним числом, и без перекрытия эти изменения прошли бы мимо.
OVERLAP_DAYS = 3

# «Снимок» — источник, который не накапливается, а заменяется целиком.
SNAPSHOT_SOURCES = {"stocks"}


@dataclass
class SyncResult:
    """Чем закончилась выгрузка одного магазина."""

    connection_id: str
    title: str
    marketplace: str
    stored: dict[str, int] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)
    finished_at: datetime = field(default_factory=datetime.utcnow)
    full: bool = False                      # первая выгрузка: качаем всю историю
    date_from: date | None = None

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "connectionId": self.connection_id,
            "title": self.title,
            "marketplace": self.marketplace,
            "stored": self.stored,
            "errors": self.errors,
            "ok": self.ok,
            "full": self.full,
            "dateFrom": self.date_from.isoformat() if self.date_from else "",
            "finishedAt": self.finished_at.replace(microsecond=0).isoformat() + "Z",
        }


# --- ключи строк ---------------------------------------------------------------


def row_key(source: str, row: dict[str, Any], index: int) -> str:
    """Устойчивый идентификатор строки — чтобы повторная выгрузка не двоила.

    У продаж и заказов Wildberries есть `srid`; если его нет, собираем ключ
    из полей, которые вместе однозначно определяют строку.
    """
    for field_name in ("srid", "saleID", "odid", "gNumber"):
        value = row.get(field_name)
        if value:
            return str(value)

    if source == "stocks":
        return f"{row.get('nmId')}:{row.get('warehouseId') or row.get('warehouseName')}"

    parts = [
        str(row.get("date") or ""),
        str(row.get("nmId") or ""),
        str(row.get("supplierArticle") or ""),
        str(row.get("totalPrice") or ""),
        str(index),
    ]
    return ":".join(parts)


def row_day(source: str, row: dict[str, Any], fallback: date) -> date:
    from .connectors.dates import parse_day

    if source in SNAPSHOT_SOURCES:
        return fallback
    return parse_day(row.get("date") or row.get("lastChangeDate")) or fallback


# --- запись --------------------------------------------------------------------


async def store_rows(
    connection_id: str, source: str, rows: list[dict[str, Any]], today: date
) -> int:
    """Сложить строки в базу. Уже известные строки перезаписываются."""
    stamp = datetime.utcnow().isoformat()

    async with db.connect() as connection:
        if source in SNAPSHOT_SOURCES:
            # Остатки — не история, а срез «сейчас»: старый заменяем целиком.
            await connection.execute(
                "DELETE FROM marketplace_rows WHERE connection_id = ? AND source = ?",
                (connection_id, source),
            )

        await connection.executemany(
            "INSERT OR REPLACE INTO marketplace_rows"
            " (connection_id, source, row_id, day, payload, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    connection_id,
                    source,
                    row_key(source, row, index),
                    row_day(source, row, today).isoformat(),
                    json.dumps(row, ensure_ascii=False),
                    stamp,
                )
                for index, row in enumerate(rows)
            ],
        )
        await connection.commit()
    return len(rows)


async def mark_sync(connection_id: str, source: str, error: str = "") -> None:
    async with db.connect() as connection:
        await connection.execute(
            "INSERT OR REPLACE INTO sync_state (connection_id, source, synced_at, error)"
            " VALUES (?, ?, ?, ?)",
            (connection_id, source, datetime.utcnow().isoformat(), error),
        )
        await connection.commit()


async def forget(connection_id: str) -> None:
    """Забыть выгрузку магазина — например, когда его удалили."""
    async with db.connect() as connection:
        await connection.execute(
            "DELETE FROM marketplace_rows WHERE connection_id = ?", (connection_id,)
        )
        await connection.execute(
            "DELETE FROM sync_state WHERE connection_id = ?", (connection_id,)
        )
        await connection.commit()


# --- чтение --------------------------------------------------------------------


async def last_stored_day(connection_id: str, sources: tuple[str, ...]) -> date | None:
    """Самый свежий день, который уже лежит в базе по этому магазину."""
    history = [source for source in sources if source not in SNAPSHOT_SOURCES]
    if not history:
        return None

    placeholders = ",".join("?" for _ in history)
    async with db.connect() as connection:
        cursor = await connection.execute(
            f"SELECT MAX(day) AS last_day FROM marketplace_rows"
            f" WHERE connection_id = ? AND source IN ({placeholders})",
            [connection_id, *history],
        )
        row = await cursor.fetchone()

    if not row or not row["last_day"]:
        return None
    try:
        return date.fromisoformat(row["last_day"])
    except ValueError:
        return None


async def prune(connection_id: str, before: date) -> int:
    """Убрать строки старше срока хранения, чтобы база не росла бесконечно."""
    async with db.connect() as connection:
        cursor = await connection.execute(
            "DELETE FROM marketplace_rows"
            " WHERE connection_id = ? AND source NOT IN ('stocks') AND day < ?",
            (connection_id, before.isoformat()),
        )
        await connection.commit()
        return cursor.rowcount or 0


async def read_rows(
    connection_id: str, source: str, period: Period | None = None
) -> list[dict[str, Any]]:
    query = (
        "SELECT payload FROM marketplace_rows WHERE connection_id = ? AND source = ?"
    )
    params: list[Any] = [connection_id, source]
    if period is not None and source not in SNAPSHOT_SOURCES:
        query += " AND day BETWEEN ? AND ?"
        params.extend([period.date_from.isoformat(), period.date_to.isoformat()])

    async with db.connect() as connection:
        cursor = await connection.execute(query, params)
        rows = await cursor.fetchall()

    result: list[dict[str, Any]] = []
    for row in rows:
        try:
            result.append(json.loads(row["payload"]))
        except json.JSONDecodeError:
            continue
    return result


async def status(config: Settings | None = None) -> dict[str, Any]:
    """Когда что выгружалось — для строки состояния в панели."""
    config = config or settings

    async with db.connect() as connection:
        cursor = await connection.execute(
            "SELECT connection_id, source, synced_at, error FROM sync_state"
        )
        rows = await cursor.fetchall()
        cursor = await connection.execute(
            "SELECT connection_id, source, COUNT(*) AS total, MAX(day) AS last_day"
            " FROM marketplace_rows GROUP BY connection_id, source"
        )
        counts = await cursor.fetchall()

    stores = await connections.load(config)
    titles = {store.id: store.title for store in stores}

    by_connection: dict[str, dict[str, Any]] = {}
    for row in rows:
        item = by_connection.setdefault(
            row["connection_id"],
            {
                "connectionId": row["connection_id"],
                "title": titles.get(row["connection_id"], "магазин удалён"),
                "sources": {},
                "syncedAt": "",
            },
        )
        item["sources"][row["source"]] = {"syncedAt": row["synced_at"], "error": row["error"]}
        item["syncedAt"] = max(item["syncedAt"], row["synced_at"] or "")

    for row in counts:
        item = by_connection.get(row["connection_id"])
        if not item:
            continue
        source = item["sources"].setdefault(row["source"], {})
        source["rows"] = row["total"]
        source["lastDay"] = row["last_day"]

    synced = [item["syncedAt"] for item in by_connection.values() if item["syncedAt"]]
    return {
        "stores": list(by_connection.values()),
        "syncedAt": min(synced) + "Z" if synced else "",
        "running": _running.locked(),
    }


# --- выгрузка ------------------------------------------------------------------

_running = asyncio.Lock()


async def sync_store(store: connections.Connection, config: Settings | None = None) -> SyncResult:
    """Скачать данные одного магазина и сложить в базу."""
    config = config or settings
    result = SyncResult(
        connection_id=store.id, title=store.title, marketplace=store.marketplace
    )

    if store.marketplace not in STORED:
        return result

    connector = REAL_CONNECTORS[store.marketplace](store.credentials(config))
    today = date.today()
    horizon = today - timedelta(days=max(config.history_days, 1) - 1)

    # Первая выгрузка качает всю историю, последующие — только то, что
    # изменилось за последние дни. Иначе каждые четверть часа пришлось бы
    # перекачивать год продаж.
    known = await last_stored_day(store.id, STORED[store.marketplace])
    date_from = max(known - timedelta(days=OVERLAP_DAYS), horizon) if known else horizon
    result.full = known is None
    result.date_from = date_from

    if isinstance(connector, WildberriesConnector):
        raw = await connector.collect_raw(date_from)
    else:  # pragma: no cover — пока хранится только Wildberries
        return result

    errors = raw.get("errors", {})
    for source in STORED[store.marketplace]:
        error = errors.get(source, "")
        if error:
            result.errors[source] = error
            await mark_sync(store.id, source, error)
            continue
        stored = await store_rows(store.id, source, raw.get(source) or [], today)
        result.stored[source] = stored
        await mark_sync(store.id, source)

    await prune(store.id, horizon)
    return result


async def sync_all(config: Settings | None = None) -> list[SyncResult]:
    """Выгрузить все подключённые магазины. Одновременно идёт только одна выгрузка."""
    config = config or settings

    if _running.locked():
        log.info("Выгрузка уже идёт — пропускаем")
        return []

    async with _running:
        stores = [
            store
            for store in await connections.load(config)
            if store.enabled and store.configured and store.marketplace in STORED
        ]
        results: list[SyncResult] = []
        for store in stores:
            try:
                results.append(await sync_store(store, config))
            except Exception as exc:  # noqa: BLE001 — выгрузка не должна ронять панель
                log.warning("Выгрузка %s не удалась: %s", store.title, exc)
                results.append(
                    SyncResult(
                        connection_id=store.id,
                        title=store.title,
                        marketplace=store.marketplace,
                        errors={"sync": f"{type(exc).__name__}"},
                    )
                )
        for result in results:
            log.info(
                "Выгружено %s: %s%s",
                result.title,
                ", ".join(f"{key} {value}" for key, value in result.stored.items()) or "нет строк",
                f"; ошибки: {result.errors}" if result.errors else "",
            )
        return results


async def has_data(config: Settings | None = None) -> bool:
    async with db.connect() as connection:
        cursor = await connection.execute("SELECT 1 FROM marketplace_rows LIMIT 1")
        return await cursor.fetchone() is not None


async def report_for(
    store: connections.Connection, period: Period, config: Settings | None = None
) -> MarketplaceReport:
    """Отчёт магазина за период — из выгрузки, без обращения к площадке."""
    config = config or settings
    connector = REAL_CONNECTORS[store.marketplace](store.credentials(config))

    rows = {
        source: await read_rows(store.id, source, period)
        for source in STORED[store.marketplace]
    }

    async with db.connect() as connection:
        cursor = await connection.execute(
            "SELECT source, error FROM sync_state WHERE connection_id = ?", (store.id,)
        )
        errors = {row["source"]: row["error"] for row in await cursor.fetchall() if row["error"]}

    return connector.build(rows, period, errors)


async def background_loop(config: Settings | None = None) -> None:
    """Фоновое обновление выгрузки."""
    config = config or settings
    interval = max(config.sync_minutes, 1) * 60

    while True:
        try:
            await sync_all(config)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — цикл не должен останавливаться
            log.exception("Ошибка фоновой выгрузки")
        await asyncio.sleep(interval)
