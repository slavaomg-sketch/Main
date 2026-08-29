"""Источники данных о доставке. Пока один — Яндекс Доставка (dostavka.yandex.ru)."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

from .eta import looks_arrived, looks_finished, parse_eta_minutes
from .models import ARRIVED, FINISHED, IN_PROGRESS, UNKNOWN, TripState, now_utc

API_HOST = "https://ya-authproxy.taxi.yandex.ru"
API_PATH = "/4.0/cargo-c2c/v1/shared-route"
ORIGIN = "https://dostavka.yandex.ru"

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)

DEFAULT_POLL_SECONDS = 30.0
MIN_POLL_SECONDS = 10.0
RETRY_PAUSE_SECONDS = 2.0

_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Accept-Language": "ru",
    "Origin": ORIGIN,
    "Referer": ORIGIN + "/",
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
}


class TrackerError(RuntimeError):
    """Не удалось получить состояние поездки."""


def parse_key(url: str) -> str:
    """Достаёт идентификатор поездки из ссылки вида .../route/<uuid> или из самого uuid."""
    match = _UUID_RE.search(url or "")
    if not match:
        raise TrackerError(
            "Не вижу идентификатора в ссылке. Нужна ссылка вида "
            "https://dostavka.yandex.ru/route/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        )
    return match.group(0).lower()


def normalize_url(url: str) -> str:
    """Приводит ссылку к канонической форме (заодно проверяет её)."""
    key = parse_key(url)
    if url and url.strip().startswith("http"):
        return url.strip()
    return f"{ORIGIN}/route/{key}"


def _request(path: str, payload: dict, timeout: float, attempts: int = 3) -> tuple[dict, dict]:
    body = json.dumps(payload).encode("utf-8")
    raw = ""
    headers: dict[str, str] = {}
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            API_HOST + path, data=body, headers=_HEADERS, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
                headers = {k.lower(): v for k, v in response.headers.items()}
            break
        except urllib.error.HTTPError as exc:  # pragma: no cover - сетевые ошибки
            if exc.code in (403, 404, 410):
                raise TrackerError(
                    "Яндекс не отдаёт эту поездку: ссылка устарела или заказ уже закрыт."
                ) from exc
            if exc.code < 500 or attempt == attempts:
                raise TrackerError(f"Яндекс ответил ошибкой {exc.code}.") from exc
        except (urllib.error.URLError, OSError) as exc:  # pragma: no cover - сетевые ошибки
            # Разрыв соединения на мобильной сети — обычное дело, пробуем ещё раз.
            if attempt == attempts:
                reason = getattr(exc, "reason", exc)
                raise TrackerError(f"Нет связи с Яндексом: {reason}") from exc
        time.sleep(RETRY_PAUSE_SECONDS * attempt)

    try:
        return json.loads(raw), headers
    except json.JSONDecodeError as exc:  # pragma: no cover - защита от мусора
        raise TrackerError("Яндекс вернул не JSON — похоже, поменялось API.") from exc


def _poll_seconds(headers: dict) -> float:
    """Яндекс сам подсказывает период опроса в заголовке x-refresh-after (мс)."""
    raw = headers.get("x-refresh-after")
    try:
        seconds = float(raw) / 1000
    except (TypeError, ValueError):
        return DEFAULT_POLL_SECONDS
    return max(MIN_POLL_SECONDS, seconds)


_FINISHED_STATUSES = {
    "delivered",
    "delivered_finish",
    "delivery_finished",
    "complete",
    "completed",
    "finished",
}


def _status_from(payload: dict, summary: str) -> str:
    points = payload.get("route_points") or []
    if points and all(point.get("visit_status") == "visited" for point in points):
        return FINISHED

    provider_status = str((payload.get("context") or {}).get("provider_status") or "").lower()
    if provider_status:
        if "cancel" in provider_status or "return" in provider_status:
            return FINISHED
        if provider_status in _FINISHED_STATUSES:
            return FINISHED
        # delivery_arrived — курьер у получателя; pickup_arrived — ещё только у отправителя.
        if "arriv" in provider_status and "pickup" not in provider_status:
            return ARRIVED

    if looks_finished(summary):
        return FINISHED
    if looks_arrived(summary):
        return ARRIVED
    if provider_status:
        return IN_PROGRESS
    return UNKNOWN


def _destination(payload: dict) -> str | None:
    for point in payload.get("route_points") or []:
        if point.get("type") == "destination":
            return point.get("short_text") or point.get("full_text")
    return None


def state_from_payload(
    key: str, payload: dict, headers: dict[str, Any] | None = None
) -> TripState:
    """Превращает ответ API в TripState. Вынесено отдельно, чтобы удобно тестировать."""
    summary = str(payload.get("summary") or "").strip()
    description = str(payload.get("description") or "").strip()
    status = _status_from(payload, summary)

    if status == ARRIVED:
        eta = 0.0
    elif status == FINISHED:
        eta = None
    else:
        eta = parse_eta_minutes(summary) or parse_eta_minutes(description)

    performer = payload.get("performer") or {}
    return TripState(
        key=key,
        status=status,
        summary=summary,
        description=description,
        eta_minutes=eta,
        performer=performer.get("short_name") or performer.get("name") or None,
        vehicle=" ".join(
            part
            for part in (performer.get("vehicle_model"), performer.get("vehicle_number"))
            if part
        )
        or None,
        destination=_destination(payload),
        fetched_at=now_utc(),
        poll_after=_poll_seconds(headers or {}),
    )


class YandexDeliveryProvider:
    """Читает состояние поездки по публичной ссылке отслеживания."""

    name = "yandex"

    def __init__(self, timeout: float = 15.0) -> None:
        self.timeout = timeout

    def fetch(self, key: str) -> TripState:
        payload, headers = _request(f"{API_PATH}/info", {"key": key}, self.timeout)
        return state_from_payload(key, payload, headers)

    def position(self, key: str) -> tuple[float, float] | None:
        """Текущие координаты курьера — пригодятся для отладки и карт."""
        try:
            payload, _ = _request(f"{API_PATH}/performer-position", {"key": key}, self.timeout)
        except TrackerError:
            return None
        position = payload.get("position") or {}
        if "lat" in position and "lon" in position:
            return float(position["lat"]), float(position["lon"])
        return None
