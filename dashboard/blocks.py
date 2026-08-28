"""Каталог блоков панели и раскладка по умолчанию.

Каталог живёт на сервере, чтобы фронтенд и валидация раскладки исходили
из одного списка: блок, которого нет в каталоге, в раскладку не попадёт.
"""

from __future__ import annotations

import uuid
from typing import Any

# size: sm = 1 колонка, md = 2, lg = 3, xl = вся ширина (сетка из 4 колонок)
BLOCK_CATALOG: list[dict[str, Any]] = [
    {
        "type": "kpi.revenue",
        "title": "Выручка",
        "group": "Показатели",
        "description": "Сумма продаж за период и динамика к прошлому периоду.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "revenue",
    },
    {
        "type": "kpi.profit",
        "title": "Прибыль",
        "group": "Показатели",
        "description": "Выручка за вычетом комиссии, логистики, рекламы и себестоимости.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "profit",
    },
    {
        "type": "kpi.orders",
        "title": "Заказы",
        "group": "Показатели",
        "description": "Количество заказов по всем выбранным площадкам.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "orders",
    },
    {
        "type": "kpi.avgCheck",
        "title": "Средний чек",
        "group": "Показатели",
        "description": "Выручка, делённая на число заказов.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "check",
    },
    {
        "type": "kpi.buyoutRate",
        "title": "Процент выкупа",
        "group": "Показатели",
        "description": "Доля доставленных и выкупленных заказов.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "buyout",
    },
    {
        "type": "kpi.drr",
        "title": "ДРР",
        "group": "Показатели",
        "description": "Доля рекламных расходов в выручке.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "ads",
    },
    {
        "type": "kpi.returnRate",
        "title": "Возвраты",
        "group": "Показатели",
        "description": "Доля возвратов от количества заказов.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "returns",
    },
    {
        "type": "kpi.rating",
        "title": "Рейтинг",
        "group": "Показатели",
        "description": "Средний рейтинг карточек и число отзывов.",
        "sizes": ["sm", "md"],
        "defaultSize": "sm",
        "icon": "star",
    },
    {
        "type": "chart.revenueDynamics",
        "title": "Динамика выручки",
        "group": "Графики",
        "description": "График выручки по дням с разбивкой по площадкам.",
        "sizes": ["md", "lg", "xl"],
        "defaultSize": "xl",
        "icon": "chart",
    },
    {
        "type": "chart.ordersByDay",
        "title": "Заказы по дням",
        "group": "Графики",
        "description": "Столбчатая диаграмма заказов по дням недели.",
        "sizes": ["md", "lg", "xl"],
        "defaultSize": "lg",
        "icon": "bars",
    },
    {
        "type": "chart.marketplaceShare",
        "title": "Доли площадок",
        "group": "Графики",
        "description": "Какую часть выручки приносит каждый маркетплейс.",
        "sizes": ["sm", "md"],
        "defaultSize": "md",
        "icon": "donut",
    },
    {
        "type": "chart.regions",
        "title": "География продаж",
        "group": "Графики",
        "description": "Топ регионов по выручке.",
        "sizes": ["md", "lg"],
        "defaultSize": "md",
        "icon": "map",
    },
    {
        "type": "table.marketplaces",
        "title": "Сравнение площадок",
        "group": "Таблицы",
        "description": "Ключевые метрики каждой площадки в одной таблице.",
        "sizes": ["lg", "xl"],
        "defaultSize": "xl",
        "icon": "table",
    },
    {
        "type": "table.topProducts",
        "title": "Топ товаров",
        "group": "Таблицы",
        "description": "Товары-лидеры по выручке за период.",
        "sizes": ["md", "lg", "xl"],
        "defaultSize": "lg",
        "icon": "box",
    },
    {
        "type": "list.stockAlerts",
        "title": "Заканчиваются остатки",
        "group": "Операции",
        "description": "Товары, которых хватит меньше чем на две недели.",
        "sizes": ["md", "lg"],
        "defaultSize": "md",
        "icon": "warning",
    },
    {
        "type": "panel.unitEconomics",
        "title": "Юнит-экономика",
        "group": "Финансы",
        "description": "Из чего складывается прибыль: комиссия, логистика, реклама, себестоимость.",
        "sizes": ["md", "lg", "xl"],
        "defaultSize": "lg",
        "icon": "wallet",
    },
    {
        "type": "panel.funnel",
        "title": "Воронка продаж",
        "group": "Операции",
        "description": "Показы → карточка → корзина → заказ → выкуп.",
        "sizes": ["md", "lg"],
        "defaultSize": "md",
        "icon": "funnel",
    },
    {
        "type": "list.reviews",
        "title": "Последние отзывы",
        "group": "Операции",
        "description": "Свежие отзывы покупателей по всем площадкам.",
        "sizes": ["md", "lg"],
        "defaultSize": "md",
        "icon": "message",
    },
    {
        "type": "panel.goal",
        "title": "План продаж",
        "group": "Финансы",
        "description": "Выполнение месячного плана по выручке.",
        "sizes": ["sm", "md"],
        "defaultSize": "md",
        "icon": "target",
        "settings": {"goal": 5000000},
    },
    {
        "type": "panel.health",
        "title": "Статус подключений",
        "group": "Операции",
        "description": "Какие площадки отдают данные, а какие работают в демо-режиме.",
        "sizes": ["sm", "md", "lg"],
        "defaultSize": "md",
        "icon": "plug",
    },
]

BLOCK_TYPES: dict[str, dict[str, Any]] = {block["type"]: block for block in BLOCK_CATALOG}
VALID_SIZES = {"sm", "md", "lg", "xl"}

DEFAULT_LAYOUT_TYPES: list[tuple[str, str]] = [
    ("kpi.revenue", "sm"),
    ("kpi.profit", "sm"),
    ("kpi.orders", "sm"),
    ("kpi.avgCheck", "sm"),
    ("chart.revenueDynamics", "xl"),
    ("chart.marketplaceShare", "md"),
    ("panel.unitEconomics", "md"),
    ("table.marketplaces", "xl"),
    ("table.topProducts", "xl"),
    ("list.stockAlerts", "md"),
    ("panel.funnel", "md"),
    ("chart.regions", "md"),
    ("list.reviews", "md"),
]


def new_block(block_type: str, size: str | None = None) -> dict[str, Any]:
    """Создать экземпляр блока с уникальным идентификатором."""
    definition = BLOCK_TYPES[block_type]
    block = {
        "id": f"b_{uuid.uuid4().hex[:10]}",
        "type": block_type,
        "size": size or definition["defaultSize"],
        "hidden": False,
        "title": definition["title"],
    }
    if definition.get("settings"):
        block["settings"] = dict(definition["settings"])
    return block


def default_layout() -> list[dict[str, Any]]:
    return [new_block(block_type, size) for block_type, size in DEFAULT_LAYOUT_TYPES]


def sanitize_layout(raw: Any) -> list[dict[str, Any]]:
    """Привести присланную раскладку к безопасному виду.

    Неизвестные типы блоков и лишние поля отбрасываются: панель настраивает
    пользователь, но хранить в базе произвольный JSON мы не обязаны.
    """
    if not isinstance(raw, list):
        return default_layout()

    layout: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in raw[:60]:
        if not isinstance(item, dict):
            continue
        block_type = str(item.get("type") or "")
        definition = BLOCK_TYPES.get(block_type)
        if not definition:
            continue

        block_id = str(item.get("id") or "")[:40]
        if not block_id or block_id in seen_ids:
            block_id = f"b_{uuid.uuid4().hex[:10]}"
        seen_ids.add(block_id)

        size = str(item.get("size") or definition["defaultSize"])
        if size not in VALID_SIZES or size not in definition["sizes"]:
            size = definition["defaultSize"]

        block: dict[str, Any] = {
            "id": block_id,
            "type": block_type,
            "size": size,
            "hidden": bool(item.get("hidden")),
            "title": str(item.get("title") or definition["title"])[:80],
        }

        settings = item.get("settings")
        if isinstance(settings, dict) and definition.get("settings"):
            allowed = definition["settings"].keys()
            block["settings"] = {
                key: settings[key]
                for key in allowed
                if isinstance(settings.get(key), (int, float, str, bool))
            }
        elif definition.get("settings"):
            block["settings"] = dict(definition["settings"])

        layout.append(block)

    return layout or default_layout()
