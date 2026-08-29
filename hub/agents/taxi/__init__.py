"""Ветка «Доставка»: следит за поездкой по ссылке и напоминает о прибытии."""

from __future__ import annotations

from typing import Any

from aiogram import Bot
from aiogram.types import BotCommand

from tracker.providers import YandexDeliveryProvider, find_keys
from tracker.store import TripStore

from ...registry import Agent
from .config import TaxiConfig
from .handlers import router
from .poller import TripPoller
from .texts import GREETING


def setup(data: dict[str, Any], hub_config) -> None:
    """Кладёт зависимости ветки в данные диспетчера."""
    config = TaxiConfig.from_env(tz=hub_config.tz)
    data["taxi_config"] = config
    data["taxi_store"] = TripStore(config.trips_path)
    data.setdefault("taxi_provider", YandexDeliveryProvider())


def background(bot: Bot, data: dict[str, Any]) -> TripPoller:
    """Фоновый опрос Яндекса: обновляет карточки и шлёт напоминания."""
    return TripPoller(
        bot,
        data["taxi_store"],
        data["taxi_config"],
        provider=data.get("taxi_provider"),
    )


agent = Agent(
    slug="taxi",
    title="🚕 Доставка",
    summary="слежу за курьером по ссылке и напоминаю, когда пора выходить",
    greeting=GREETING,
    router=router,
    commands=[BotCommand(command="list", description="Что я сейчас отслеживаю")],
    # Ссылку на доставку узнаём по идентификатору поездки в тексте.
    claims=lambda text: bool(find_keys(text)),
    setup=setup,
    background=background,
)

__all__ = ["agent"]
