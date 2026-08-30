"""Сбор полного списка родителей из карточек кабинетов.

Справочник товаров наполнялся сам, но только тем, о чём спрашивали
покупатели. Владельцу нужен весь список сразу: описать каждый товар
словами один раз и больше к этому не возвращаться.

Сбор идёт в фоне и с показом хода: у кабинета могут быть тысячи карточек,
а площадка отдаёт их по сотне и с ограничением по частоте. Держать на
этом открытую страницу нельзя.

Собираем Wildberries, Ozon и Яндекс Маркет — каждый кабинет отдельно.
Кабинет, который отказал, не срывает остальные: его ошибка попадает в
отчёт о сборе, а прочие кабинеты досчитываются до конца.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from . import connections, db, inbox, products
from . import knowledge as знание
from .config import Settings, settings
from .connectors.ozon_catalogue import OzonCatalogue
from .connectors.wb_catalogue import WildberriesCatalogue
from .connectors.yandex_catalogue import YandexCatalogue

log = logging.getLogger(__name__)

SOURCES = {
    "wildberries": WildberriesCatalogue,
    "ozon": OzonCatalogue,
    "yandex": YandexCatalogue,
}


@dataclass
class Run:
    """Один сбор каталога: что происходит прямо сейчас."""

    started: datetime = field(default_factory=datetime.now)
    finished: bool = False
    stores_done: int = 0
    stores_total: int = 0
    cards: int = 0
    parents: int = 0
    pages: int = 0
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
            "pages": self.pages,
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
        parent = знание.parent_of(card.article)
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
                    -- Карточки приходят страницами, поэтому счётчик копим.
                    -- Перед сбором он обнуляется, так что повтор не удваивает.
                    cards = product_facts.cards + excluded.cards,
                    sample = CASE WHEN product_facts.sample = ''
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

    # Счётчик карточек копится по страницам — перед новым обходом обнуляем,
    # иначе повторный сбор удвоил бы числа.
    async with db.connect() as connection:
        await connection.execute("UPDATE product_facts SET cards = 0")
        await connection.commit()

    known: set[str] = set()

    for store in stores:
        run.store = store.title

        async def страница(cards: list) -> None:
            """Каждая прочитанная страница сразу ложится в справочник.

            Так владелец видит движение, а прерванный сбор не пропадает
            впустую: прочитанное уже сохранено.
            """
            _, родители = await _save(cards)
            # Сами карточки тоже сохраняем: по ним владелец ходит глазами
            # в разделе «Товары».
            await products.save_cards(store.id, cards)
            run.cards += len(cards)
            known.update(знание.parent_of(card.article) for card in cards)
            known.discard("")
            run.parents = len(known)
            run.pages += 1
            log.info(
                "Каталог %s: страниц %d, карточек %d, товаров %d",
                store.title, run.pages, run.cards, run.parents,
            )
            return родители

        try:
            source = SOURCES[store.marketplace](store.credentials(config))
            await source.cards(on_page=страница)
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
