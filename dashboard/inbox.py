"""Входящие: всё, что ждёт ответа продавца, в одном месте.

В кабинете продавца это красные кружки с числами — отзывы без ответа,
вопросы, заявки на возврат, непрочитанные сообщения. Их нужно закрывать,
и панель собирает их сразу по всем площадкам и всем кабинетам, чтобы не
заходить в каждый кабинет по отдельности.

Устройство трёхуровневое, как и просил владелец:

    площадка  →  магазин  →  глава  →  обращения

Площадки разные, и главы у них разные: у Wildberries есть заявки на
возврат, у Ozon их нет, у Яндекса нет отдельных вопросов. Поэтому список
глав объявляет сам коннектор площадки, а не этот модуль.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

import httpx

from . import connections
from .config import Settings, settings
from .connectors.inbox_base import InboxItem
from .connectors.ozon_inbox import OzonInbox
from .connectors.wb_inbox import WildberriesInbox
from .connectors.yandex_inbox import YandexInbox

log = logging.getLogger(__name__)

# Обращение без даты не должно всплывать наверх списка.
_OLD = datetime(1970, 1, 1)

# Какая площадка каким коннектором обслуживается. AliExpress сюда пока
# не входит: у площадки нет метода, которым продавец отвечает покупателю.
SOURCES = {
    "wildberries": WildberriesInbox,
    "ozon": OzonInbox,
    "yandex": YandexInbox,
}

# Порядок площадок на экране.
ORDER = ("wildberries", "ozon", "yandex")

TITLES = {
    "wildberries": "Wildberries",
    "ozon": "Ozon",
    "yandex": "Яндекс Маркет",
}

# Названия глав для показа. Берутся у коннектора, здесь — запасной вариант.
CHAPTER_TITLES = {
    "feedback": "Отзывы",
    "question": "Вопросы",
    "claim": "Заявки на возврат",
    "chat": "Сообщения покупателей",
}

# Последняя выдача `collect`, разложенная по ключу обращения. Нужна, чтобы
# черновик писался по тексту, который панель получила от площадки сама,
# а не по тому, что прислал браузер.
_seen: dict[tuple[str, str, str], InboxItem] = {}


def remember(items: list[InboxItem]) -> None:
    """Запомнить обращения текущей выдачи."""
    _seen.clear()
    for item in items:
        _seen[(item.account_id, item.kind, str(item.id))] = item


def find(account_id: str, kind: str, item_id: str) -> InboxItem | None:
    """Найти обращение среди тех, что панель показывала последними."""
    return _seen.get((account_id, kind, str(item_id)))


def _source(store: connections.Connection, config: Settings):
    """Коннектор входящих для магазина."""
    factory = SOURCES.get(store.marketplace)
    if factory is None:
        raise LookupError(f"у площадки {store.marketplace} нет входящих")
    return factory(store.credentials(config))


async def _for_store(
    store: connections.Connection, config: Settings
) -> tuple[list[dict[str, Any]], dict[str, str], list[InboxItem]]:
    """Главы одного магазина. Сбой одной главы не уносит остальные."""
    source = _source(store, config)
    chapters: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    collected: list[InboxItem] = []

    for kind, title in source.CHAPTERS:
        try:
            found = await source.load(kind)
        except Exception as exc:  # noqa: BLE001 — глава могла быть недоступна
            errors[f"{store.id}:{kind}"] = _reason(exc)
            log.info("Входящие %s, глава %s: %s", store.title, kind, exc)
            found = []

        for item in found:
            item.account_id = store.id
            item.account_title = store.title
            item.marketplace = store.marketplace

        found.sort(key=lambda item: item.created_at or _OLD, reverse=True)
        collected.extend(found)
        chapters.append({
            "kind": kind,
            "title": title or CHAPTER_TITLES.get(kind, kind),
            "count": len(found),
            "urgent": sum(1 for item in found if item.urgent),
            "items": [item.to_dict() for item in found],
        })

    return chapters, errors, collected


def _reason(error: BaseException) -> str:
    """Короткое человеческое объяснение, почему глава не открылась."""
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        if code in {401, 403}:
            return "нет прав в ключе"
        if code == 404:
            return "площадка не отдаёт этот раздел"
        if code == 429:
            return "площадка просит подождать"
        return f"площадка ответила {code}"
    return type(error).__name__


async def collect(config: Settings | None = None) -> dict[str, Any]:
    """Собрать входящие по всем площадкам и всем их кабинетам."""
    config = config or settings

    stores = [
        store
        for store in await connections.load(config)
        if store.marketplace in SOURCES and store.enabled and store.configured
    ]

    if not stores:
        _seen.clear()
        return {"marketplaces": [], "total": 0, "urgent": 0, "errors": {}}

    gathered = await asyncio.gather(
        *(_for_store(store, config) for store in stores), return_exceptions=True
    )

    errors: dict[str, str] = {}
    by_marketplace: dict[str, list[dict[str, Any]]] = {}
    seen: list[InboxItem] = []

    for store, outcome in zip(stores, gathered):
        if isinstance(outcome, BaseException):
            errors[store.id] = _reason(outcome)
            continue

        chapters, store_errors, items = outcome
        errors.update(store_errors)
        seen.extend(items)

        by_marketplace.setdefault(store.marketplace, []).append({
            "id": store.id,
            "title": store.title,
            "total": sum(chapter["count"] for chapter in chapters),
            "urgent": sum(chapter["urgent"] for chapter in chapters),
            "chapters": chapters,
        })

    remember(seen)

    marketplaces = []
    for code in ORDER:
        shops = by_marketplace.get(code)
        if not shops:
            continue
        marketplaces.append({
            "code": code,
            "title": TITLES.get(code, code),
            "total": sum(shop["total"] for shop in shops),
            "urgent": sum(shop["urgent"] for shop in shops),
            "stores": shops,
        })

    return {
        "marketplaces": marketplaces,
        "total": sum(place["total"] for place in marketplaces),
        "urgent": sum(place["urgent"] for place in marketplaces),
        "errors": errors,
    }


async def reply(
    account_id: str, kind: str, item_id: str, text: str, config: Settings | None = None
) -> None:
    """Ответить на обращение от имени конкретного магазина."""
    config = config or settings
    store = await connections.get(account_id, config)
    if store is None:
        raise LookupError("магазин не найден")

    await _source(store, config).answer(kind, item_id, text)
