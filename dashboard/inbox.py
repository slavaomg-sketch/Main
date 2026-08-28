"""Входящие: всё, что ждёт ответа продавца, в одном месте.

В кабинете Wildberries это красные кружки с числами — отзывы без ответа,
вопросы покупателей, заявки на возврат. Их нужно закрывать, и панель
собирает их по всем магазинам сразу, чтобы не заходить в каждый кабинет.

Главы намеренно разделены: у каждой свой смысл, свой темп и, в будущем,
свой агент-помощник. Общего у них только устройство обращения.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from . import connections
from .config import Settings, settings
from .connectors.wb_inbox import InboxItem, WildberriesInbox

log = logging.getLogger(__name__)

# Обращение без даты не должно всплывать наверх списка.
_OLD = datetime(1970, 1, 1)

# Главы входящих в порядке, в котором их видит владелец панели.
CHAPTERS: tuple[tuple[str, str], ...] = (
    ("feedback", "Отзывы"),
    ("question", "Вопросы"),
    ("claim", "Заявки на возврат"),
)

CHAPTER_TITLES = dict(CHAPTERS)


def _connector(store: connections.Connection, config: Settings) -> WildberriesInbox:
    return WildberriesInbox(store.credentials(config))


async def _for_store(
    store: connections.Connection, config: Settings
) -> tuple[list[InboxItem], dict[str, str]]:
    """Обращения одного магазина. Сбой одной главы не уносит остальные."""
    connector = _connector(store, config)
    items: list[InboxItem] = []
    errors: dict[str, str] = {}

    for kind, loader in (
        ("feedback", connector.feedbacks),
        ("question", connector.questions),
        ("claim", connector.claims),
    ):
        try:
            found = await loader()
        except Exception as exc:  # noqa: BLE001 — глава могла быть недоступна
            errors[kind] = f"{type(exc).__name__}"
            log.info("Входящие %s, глава %s: %s", store.title, kind, exc)
            continue

        for item in found:
            item.account_id = store.id
            item.account_title = store.title
        items.extend(found)

    return items, errors


async def collect(config: Settings | None = None) -> dict[str, Any]:
    """Собрать входящие по всем подключённым магазинам Wildberries."""
    config = config or settings
    stores = [
        store
        for store in await connections.load(config)
        if store.marketplace == "wildberries" and store.enabled and store.configured
    ]

    if not stores:
        return {"chapters": [], "total": 0, "urgent": 0, "stores": []}

    gathered = await asyncio.gather(
        *(_for_store(store, config) for store in stores), return_exceptions=True
    )

    items: list[InboxItem] = []
    errors: dict[str, str] = {}
    for store, outcome in zip(stores, gathered):
        if isinstance(outcome, BaseException):
            errors[store.id] = f"{type(outcome).__name__}"
            continue
        found, store_errors = outcome
        items.extend(found)
        errors.update({f"{store.id}:{key}": value for key, value in store_errors.items()})

    chapters = []
    for kind, title in CHAPTERS:
        chapter = [item for item in items if item.kind == kind]
        chapter.sort(key=lambda item: item.created_at or _OLD, reverse=True)
        chapters.append({
            "kind": kind,
            "title": title,
            "count": len(chapter),
            "urgent": sum(1 for item in chapter if item.urgent),
            "items": [item.to_dict() for item in chapter],
        })

    return {
        "chapters": chapters,
        "total": len(items),
        "urgent": sum(1 for item in items if item.urgent),
        "stores": [{"id": store.id, "title": store.title} for store in stores],
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

    await _connector(store, config).answer(kind, item_id, text)
