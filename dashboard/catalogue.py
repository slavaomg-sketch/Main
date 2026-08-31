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
import json
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
class Shop:
    """Один кабинет в сборе: дошла ли до него очередь и чем кончилось.

    Владелец спрашивает не «сколько страниц прочитано», а «где мой второй
    Озон». Ответить на это можно только списком кабинетов с их состоянием.
    """

    id: str
    title: str
    marketplace: str
    state: str = "waiting"      # waiting | running | done | error
    cards: int = 0
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "marketplace": self.marketplace,
            "state": self.state,
            "cards": self.cards,
            "error": self.error,
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
    shops: list[Shop] = field(default_factory=list)
    # Сбор живёт в памяти службы. Обновление панели её перезапускает — и
    # незаконченный сбор пропадает вместе с ней. Молчать об этом нельзя:
    # владелец должен понимать, почему кабинет остался непрочитанным.
    interrupted: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": not self.finished,
            "finished": self.finished,
            "interrupted": self.interrupted,
            "store": self.store,
            "storesDone": self.stores_done,
            "storesTotal": self.stores_total,
            "cards": self.cards,
            "parents": self.parents,
            "pages": self.pages,
            "errors": self.errors,
            "shops": [shop.to_dict() for shop in self.shops],
            "startedAt": self.started.isoformat(timespec="seconds"),
        }


_run: Run | None = None
_task: asyncio.Task | None = None

# Ход сбора живёт в памяти службы, а служба перезапускается при каждом
# обновлении панели. Незаконченный сбор при этом пропадает — и владелец
# видит только, что кабинета в списке нет, без объяснения почему.
# Поэтому итог каждого сбора записывается ещё и в базу.
LAST_RUN = "catalogue_last_run"


async def _remember(run: Run) -> None:
    """Запомнить ход сбора, чтобы он пережил перезапуск службы."""
    try:
        await db.set_preference(LAST_RUN, json.dumps(run.to_dict(), ensure_ascii=False))
    except Exception:  # noqa: BLE001 — запись хода не должна ронять сам сбор
        log.info("Не удалось записать ход сбора каталога")


async def last_run() -> dict[str, Any] | None:
    """Последний сбор: идущий сейчас или тот, что записан в базе.

    Сбор, оборвавшийся на перезапуске службы, помечается прерванным: в
    памяти его уже нет, а в базе он остался незаконченным.
    """
    if _run is not None:
        return _run.to_dict()

    записано = await db.get_preference(LAST_RUN)
    if not записано:
        return None
    try:
        было = json.loads(записано)
    except ValueError:
        return None

    if было.get("running"):
        было["running"] = False
        было["finished"] = True
        было["interrupted"] = True
        for shop in было.get("shops") or []:
            # Кабинет, который читали, и кабинет, до которого не дошла
            # очередь, — разные вещи, и владельцу надо сказать разное.
            if shop.get("state") == "running":
                shop["state"] = "interrupted"
            elif shop.get("state") == "waiting":
                shop["state"] = "skipped"
    return было


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
    run.shops = [
        Shop(id=store.id, title=store.title, marketplace=store.marketplace)
        for store in stores
    ]

    # Счётчик карточек копится по страницам — перед новым обходом обнуляем,
    # иначе повторный сбор удвоил бы числа.
    async with db.connect() as connection:
        await connection.execute("UPDATE product_facts SET cards = 0")
        await connection.commit()

    known: set[str] = set()
    await _remember(run)

    for номер, store in enumerate(stores):
        run.store = store.title
        мой = run.shops[номер]
        мой.state = "running"

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
            мой.cards += len(cards)
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
            мой.state = "done"
        except Exception as exc:  # noqa: BLE001 — кабинет мог отказать
            мой.state = "error"
            мой.error = inbox.reason(exc)
            run.errors[store.title] = мой.error
            log.info("Каталог %s: %s", store.title, exc)
        run.stores_done += 1
        await _remember(run)

    run.store = ""
    run.finished = True
    await _remember(run)


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
