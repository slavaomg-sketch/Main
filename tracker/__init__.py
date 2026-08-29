"""Трекер доставок Яндекса: следит за поездкой по ссылке и напоминает о прибытии."""

from __future__ import annotations

from .models import ARRIVED, FINISHED, IN_PROGRESS, UNKNOWN, Event, Trip, TripState
from .providers import TrackerError, YandexDeliveryProvider, normalize_url, parse_key
from .store import TripStore
from .watcher import Watcher, apply_events, evaluate

__all__ = [
    "ARRIVED",
    "FINISHED",
    "IN_PROGRESS",
    "UNKNOWN",
    "Event",
    "Trip",
    "TripState",
    "TrackerError",
    "TripStore",
    "Watcher",
    "YandexDeliveryProvider",
    "apply_events",
    "evaluate",
    "normalize_url",
    "parse_key",
]
