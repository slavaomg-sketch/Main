"""Разбор дат из ответов маркетплейсов.

Площадки отдают время в разных форматах: WB — ISO, Яндекс — `ДД-ММ-ГГГГ`,
AliExpress — `ГГГГ-ММ-ДД ЧЧ:ММ:СС`. Разбираем по списку известных шаблонов,
обрезая строку ровно по длине шаблона, а не по длине его записи.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

SAMPLE = datetime(2025, 12, 31, 23, 59, 59)

FORMATS: tuple[str, ...] = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%d-%m-%Y %H:%M:%S",
    "%d.%m.%Y %H:%M:%S",
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d.%m.%Y",
)

# Сколько символов занимает дата, записанная по каждому шаблону.
WIDTHS: tuple[tuple[str, int], ...] = tuple(
    (fmt, len(SAMPLE.strftime(fmt))) for fmt in FORMATS
)


def parse_day(raw: Any) -> date | None:
    """Вернуть дату или None, если строку разобрать не удалось."""
    text = str(raw or "").strip()
    if not text:
        return None

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass

    for fmt, width in WIDTHS:
        if len(text) < width:
            continue
        try:
            return datetime.strptime(text[:width], fmt).date()
        except ValueError:
            continue
    return None
