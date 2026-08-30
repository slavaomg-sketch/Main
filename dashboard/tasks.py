"""Задачи по кабинету: то, что в кабинете продавца висит списком дел.

Раздел намеренно отдельный от «Входящих». «Входящие» — это переписка с
покупателями. В «Задачах» будет перемешана разная по природе работа:
ответить человеку, собрать заказ, забрать возврат, починить карточку.
Свалить это в один список — значит быстро потерять смысл обоих.

Что общее: серверная логика. Задача «Ответить на вопросы» берёт вопросы
тем же коннектором и отвечает тем же методом, что и глава «Вопросы» во
«Входящих». Второй реализации нет и быть не должно.

Что своё: набор задач объявляет сама площадка, и он НЕ равен списку глав.
У главы всегда есть переписка; у задачи её может не быть вовсе.

Сегодня объявлена ровно одна работающая задача — вопросы Wildberries.
Незаконченные пункты сюда не добавляются даже заглушками: пустой пункт
в списке дел хуже, чем его отсутствие.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from . import connections, inbox, knowledge
from .config import Settings, settings
from .connectors.inbox_base import QUESTION, InboxItem

log = logging.getLogger(__name__)

# Сколько обращений отдаём за один заход. Владелец всё равно не просмотрит
# больше за присест, а следующая порция догружается кнопкой.
PAGE = 50

# Дальше этого не листаем: защита от бесконечного хождения по страницам,
# если площадка вдруг перестанет уменьшать выдачу.
MAX_PAGES = 40


@dataclass(frozen=True)
class TaskSpec:
    """Одна задача кабинета.

    `kind` связывает задачу с видом обращения — через него работают общие
    черновики помощника и общая отправка ответа.
    """

    key: str
    title: str
    kind: str


# Задачи по площадкам. Пусто — значит, у площадки пока ничего не сделано.
TASKS: dict[str, tuple[TaskSpec, ...]] = {
    "wildberries": (
        TaskSpec(key="questions", title="Ответить на вопросы", kind=QUESTION),
    ),
    "ozon": (),
    "yandex": (),
    "ali": (),
}


def spec(marketplace: str, key: str) -> TaskSpec | None:
    for task in TASKS.get(marketplace, ()):
        if task.key == key:
            return task
    return None


async def catalogue(config: Settings | None = None) -> dict[str, Any]:
    """Дерево «площадка → кабинет → задачи». Без обращений и без запросов
    к площадкам: это оглавление, а не работа."""
    config = config or settings
    stores = [
        store
        for store in await connections.load(config)
        if store.enabled and store.configured and TASKS.get(store.marketplace)
    ]

    by_marketplace: dict[str, list[dict[str, Any]]] = {}
    for store in stores:
        by_marketplace.setdefault(store.marketplace, []).append({
            "id": store.id,
            "title": store.title,
            "tasks": [
                {"key": task.key, "title": task.title, "kind": task.kind}
                for task in TASKS[store.marketplace]
            ],
        })

    marketplaces = [
        {
            "code": code,
            "title": inbox.TITLES.get(code, code),
            "stores": by_marketplace[code],
        }
        for code in inbox.ORDER
        if by_marketplace.get(code)
    ]
    return {"marketplaces": marketplaces}


async def _questions(
    store: connections.Connection, config: Settings, offset: int, limit: int
) -> tuple[list[InboxItem], int | None, bool]:
    """Страница вопросов кабинета и настоящее их количество.

    Возвращает обращения, число по данным площадки (None — узнать не вышло)
    и признак «есть ещё». «Есть ещё» определяется по факту: пришла полная
    страница — значит, может быть следующая.
    """
    source = inbox.SOURCES["wildberries"](store.credentials(config))

    total = await source.count_questions()
    items = await source.questions(take=limit, skip=offset)
    return items, total, len(items) >= limit


async def load(
    account_id: str,
    key: str,
    offset: int = 0,
    limit: int = PAGE,
    config: Settings | None = None,
) -> dict[str, Any]:
    """Рабочий список одной задачи одного кабинета.

    Грузим ровно то, что попросили: этот кабинет и эту задачу. Полный сбор
    всех глав всех кабинетов ради одного списка вопросов не запускается.
    """
    config = config or settings

    store = await connections.get(account_id, config)
    if store is None:
        raise LookupError("кабинет не найден")

    task = spec(store.marketplace, key)
    if task is None:
        raise LookupError("у этого кабинета нет такой задачи")

    limit = max(1, min(int(limit or PAGE), PAGE))
    offset = max(0, int(offset or 0))
    if offset > PAGE * MAX_PAGES:
        raise ValueError("слишком глубокая страница")

    try:
        items, total, more = await _questions(store, config, offset, limit)
    except Exception as exc:  # noqa: BLE001 — площадка могла отказать
        log.info("Задача %s кабинета %s: %s", key, store.title, exc)
        return {
            "accountId": store.id,
            "accountTitle": store.title,
            "marketplace": store.marketplace,
            "task": task.key,
            "title": task.title,
            "kind": task.kind,
            "items": [],
            "loaded": 0,
            "offset": offset,
            "total": None,
            "more": False,
            "error": inbox.reason(exc),
        }

    for item in items:
        item.account_id = store.id
        item.account_title = store.title
        item.marketplace = store.marketplace

    # Кладём в общую память — по ней помощник пишет черновики. Чужие
    # обращения при этом не трогаются.
    inbox.remember(items)

    # Заодно пополняем список родителей: справку по ним владелец заполнит
    # на отдельной странице, и она поедет помощнику.
    await knowledge.remember(
        [item.article for item in items],
        {knowledge.parent_of(item.article): item.product for item in items if item.product},
    )

    return {
        "accountId": store.id,
        "accountTitle": store.title,
        "marketplace": store.marketplace,
        "task": task.key,
        "title": task.title,
        "kind": task.kind,
        "items": [item.to_dict() for item in items],
        "loaded": len(items),
        "offset": offset,
        # `total` — число самой площадки. None значит «неизвестно», и экран
        # обязан показать это словами, а не нулём.
        "total": total,
        "more": more,
        "error": "",
    }
