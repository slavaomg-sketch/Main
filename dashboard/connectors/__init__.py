"""Реестр коннекторов маркетплейсов."""

from __future__ import annotations

from ..config import Settings, settings
from .ali import AliExpressConnector
from .base import HttpConnector, MarketplaceConnector
from .demo import DemoConnector
from .ozon import OzonConnector
from .wildberries import WildberriesConnector
from .yandex import YandexConnector

REAL_CONNECTORS: dict[str, type[MarketplaceConnector]] = {
    "wildberries": WildberriesConnector,
    "ozon": OzonConnector,
    "yandex": YandexConnector,
    "ali": AliExpressConnector,
}

MARKETPLACE_ORDER = ("wildberries", "ozon", "yandex", "ali")


def build_connector(code: str, config: Settings | None = None) -> MarketplaceConnector:
    """Вернуть боевой коннектор, если ключи заданы, иначе демонстрационный."""
    config = config or settings
    credentials = config.marketplaces[code]
    if config.force_demo or not credentials.configured:
        return DemoConnector(code=code, title=credentials.title, credentials=credentials)
    return REAL_CONNECTORS[code](credentials)


def all_connectors(config: Settings | None = None) -> list[MarketplaceConnector]:
    config = config or settings
    return [build_connector(code, config) for code in MARKETPLACE_ORDER]


__all__ = [
    "AliExpressConnector",
    "DemoConnector",
    "HttpConnector",
    "MARKETPLACE_ORDER",
    "MarketplaceConnector",
    "OzonConnector",
    "REAL_CONNECTORS",
    "WildberriesConnector",
    "YandexConnector",
    "all_connectors",
    "build_connector",
]
