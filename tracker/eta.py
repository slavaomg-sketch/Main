"""Разбор человекочитаемого ETA: «~18 мин», «1 ч 5 мин», «10–15 мин»."""

from __future__ import annotations

import re

# Яндекс отдаёт время прибытия только текстом в поле summary,
# отдельного числового поля в ответе нет — поэтому разбираем строку.

_HOURS = r"ч(?:ас[а-яё]*)?|h(?:ou)?rs?|h"
_MINUTES = r"мин[а-яё]*|min(?:ute)?s?"

# «10–15 мин», «10-15 минут» — берём нижнюю границу: лучше напомнить раньше.
_RANGE_RE = re.compile(rf"(\d+)\s*[–—−-]\s*(\d+)\s*(?:{_MINUTES})", re.IGNORECASE)
_HOURS_RE = re.compile(rf"(\d+)\s*(?:{_HOURS})(?![а-яёa-z])", re.IGNORECASE)
_MINUTES_RE = re.compile(rf"(\d+)\s*(?:{_MINUTES})", re.IGNORECASE)

# Формулировки, которые означают «уже вот-вот» без конкретных минут.
_ALMOST_RE = re.compile(
    r"меньше\s+минуты|менее\s+минуты|less\s+than\s+a\s+minute|вот-вот", re.IGNORECASE
)

_ARRIVED_MARKERS = (
    "на месте",
    "ожидает вас",
    "ждёт вас",
    "ждет вас",
    "подъехал",
    "прибыл",
    "is waiting",
    "has arrived",
    "arrived",
)

_FINISHED_MARKERS = (
    "доставлен",
    "вручен",
    "вручён",
    "завершен",
    "завершён",
    "отменен",
    "отменён",
    "delivered",
    "completed",
    "cancelled",
    "canceled",
)


def _normalize(text: str) -> str:
    return (
        (text or "")
        .replace(" ", " ")
        .replace(" ", " ")
        .replace("~", " ")
        .replace("≈", " ")
        .replace("&nbsp;", " ")
    )


def parse_eta_minutes(text: str) -> float | None:
    """Достаёт из текста количество минут до прибытия. None — если ETA нет."""
    normalized = _normalize(text)
    if not normalized.strip():
        return None

    if _ALMOST_RE.search(normalized):
        return 0.0

    range_match = _RANGE_RE.search(normalized)
    if range_match:
        low, high = int(range_match.group(1)), int(range_match.group(2))
        return float(min(low, high))

    hours = _HOURS_RE.search(normalized)
    minutes = _MINUTES_RE.search(normalized)
    if hours is None and minutes is None:
        return None

    total = 0.0
    if hours:
        total += int(hours.group(1)) * 60
    if minutes:
        total += int(minutes.group(1))
    return total


def looks_arrived(text: str) -> bool:
    lowered = _normalize(text).lower()
    return any(marker in lowered for marker in _ARRIVED_MARKERS)


def looks_finished(text: str) -> bool:
    lowered = _normalize(text).lower()
    return any(marker in lowered for marker in _FINISHED_MARKERS)


def humanize(minutes: float | None) -> str:
    """Число минут -> «5 мин», «1 ч 20 мин», «меньше минуты»."""
    if minutes is None:
        return "время неизвестно"
    total = int(round(minutes))
    if total <= 0:
        return "меньше минуты"
    hours, mins = divmod(total, 60)
    if hours and mins:
        return f"{hours} ч {mins} мин"
    if hours:
        return f"{hours} ч"
    return f"{mins} мин"
