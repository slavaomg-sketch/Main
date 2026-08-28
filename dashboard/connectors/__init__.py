"""Реестр коннекторов маркетплейсов."""

from __future__ import annotations

from ..config import MarketplaceCredentials, Settings, settings
from .ali import AliExpressConnector
from .base import HttpConnector, MarketplaceConnector
from .demo import DemoConnector
from .empty import NotConnectedConnector
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


def build_connector(
    code: str,
    config: Settings | None = None,
    credentials: MarketplaceCredentials | None = None,
) -> MarketplaceConnector:
    """Вернуть боевой коннектор, если ключи заданы, иначе демонстрационный.

    `credentials` позволяет передать ключи, введённые на странице настроек;
    без него берутся значения из `.env`.
    """
    config = config or settings
    credentials = credentials or config.marketplaces[code]
    if config.force_demo:
        return DemoConnector(code=code, title=credentials.title, credentials=credentials)
    if not credentials.configured:
        return NotConnectedConnector(
            code=code, title=config.marketplaces[code].title, credentials=credentials
        )
    return REAL_CONNECTORS[code](credentials)


def all_connectors(config: Settings | None = None) -> list[MarketplaceConnector]:
    config = config or settings
    return [build_connector(code, config) for code in MARKETPLACE_ORDER]


__all__ = [
    "AliExpressConnector",
    "MarketplaceCredentials",
    "NotConnectedConnector",
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
