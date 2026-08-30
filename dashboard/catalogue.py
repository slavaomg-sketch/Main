"""Сбор полного списка родителей из карточек кабинетов.

Справочник товаров наполнялся сам, но только тем, о чём спрашивали
покупатели. Владельцу нужен весь список сразу: описать каждый товар
словами один раз и больше к этому не возвращаться.

Сбор идёт в фоне и с показом хода: у кабинета могут быть тысячи карточек,
а площадка отдаёт их по сотне и с ограничением по частоте. Держать на
этом открытую страницу нельзя.

Сегодня умеем собирать Wildberries. Ozon добавится, когда дойдём до него:
пустой раздел в справочнике честнее, чем наполовину собранный.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from . import connections, db, inbox, knowledge
from .config import Settings, settings
from .connectors.wb_catalogue import WildberriesCatalogue

log = logging.getLogger(__name__)

SOURCES = {"wildberries": WildberriesCatalogue}


@dataclass
class Run:
    """Один сбор каталога: что происходит прямо сейчас."""

    started: datetime = field(default_factory=datetime.now)
    finished: bool = False
    stores_done: int = 0
    stores_total: int = 0
    cards: int = 0
    parents: int = 0
    store: str = ""
    errors: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": not self.finished,
            "finished": self.finished,
            "store": self.store,
            "storesDone": self.stores_done,
            "storesTotal": self.stores_total,
            "cards": self.cards,
            "parents": self.parents,
            "errors": self.errors,
            "startedAt": self.started.isoformat(timespec="seconds"),
        }


_run: Run | None = None
_task: asyncio.Task | None = None


def status() -> dict[str, Any] | None:
    return _run.to_dict() if _run else None


def running() -> bool:
    return _run is not None and not _run.finished


async def _save(cards: list) -> tuple[int, int]:
    """Разложить карточки по родителям и записать в справочник.

    Справку и название, которые написал владелец, не трогаем: здесь
    обновляются только счётчик карточек и пример имени с площадки.
    """
    by_parent: dict[str, tuple[int, str]] = {}
    for card in cards:
        parent = knowledge.parent_of(card.article)
        if not parent:
            continue
        было = by_parent.get(parent)
        by_parent[parent] = (
            (было[0] if было else 0) + 1,
            (было[1] if было and было[1] else card.name),
        )

    if not by_parent:
        return 0, 0

    now = datetime.now().isoformat(timespec="seconds")
    async with db.connect() as connection:
        for parent, (count, sample) in by_parent.items():
            await connection.execute(
                """
                INSERT INTO product_facts (parent, title, facts, updated_at, cards, sample)
                VALUES (?, '', '', ?, ?, ?)
                ON CONFLICT(parent) DO UPDATE SET
                    cards = excluded.cards,
                    sample = CASE WHEN excluded.sample <> ''
                                  THEN excluded.sample ELSE product_facts.sample END
                """,
                (parent, now, count, sample),
            )
        await connection.commit()

    return len(cards), len(by_parent)


async def _collect(config: Settings) -> None:
    run = _run
    if run is None:
        return

    stores = [
        store
        for store in await connections.load(config)
        if store.marketplace in SOURCES and store.enabled and store.configured
    ]
    run.stores_total = len(stores)

    for store in stores:
        run.store = store.title
        try:
            source = SOURCES[store.marketplace](store.credentials(config))
            cards = await source.cards()
            got_cards, got_parents = await _save(cards)
            run.cards += got_cards
            run.parents += got_parents
        except Exception as exc:  # noqa: BLE001 — кабинет мог отказать
            run.errors[store.title] = inbox.reason(exc)
            log.info("Каталог %s: %s", store.title, exc)
        run.stores_done += 1

    run.store = ""
    run.finished = True


def start(config: Settings | None = None) -> dict[str, Any]:
    """Запустить сбор. Повторное нажатие не плодит вторую пробежку."""
    global _run, _task
    config = config or settings

    if running():
        return status() or {}

    _run = Run()

    async def guarded() -> None:
        try:
            await _collect(config)
        finally:
            if _run is not None:
                _run.finished = True

    _task = asyncio.create_task(guarded())
    return status() or {}
