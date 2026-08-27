"""Мелкие утилиты: время, часовые пояса, дни недели, форматирование."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEKDAY_NAMES = {1: "пн", 2: "вт", 3: "ср", 4: "чт", 5: "пт", 6: "сб", 7: "вс"}
WEEKDAY_FULL = {
    1: "понедельник",
    2: "вторник",
    3: "среда",
    4: "четверг",
    5: "пятница",
    6: "суббота",
    7: "воскресенье",
}
WORKDAYS = "1,2,3,4,5"
EVERYDAY = "1,2,3,4,5,6,7"

_TIME_RE = re.compile(r"^\s*(\d{1,2})\s*[:.\-\s]?\s*(\d{2})\s*$")

# Часовые пояса, которые предлагаются кнопками в интерфейсе.
POPULAR_TZ = [
    ("Калининград (UTC+2)", "Europe/Kaliningrad"),
    ("Москва (UTC+3)", "Europe/Moscow"),
    ("Самара (UTC+4)", "Europe/Samara"),
    ("Екатеринбург (UTC+5)", "Asia/Yekaterinburg"),
    ("Омск (UTC+6)", "Asia/Omsk"),
    ("Красноярск (UTC+7)", "Asia/Krasnoyarsk"),
    ("Иркутск (UTC+8)", "Asia/Irkutsk"),
    ("Якутск (UTC+9)", "Asia/Yakutsk"),
    ("Владивосток (UTC+10)", "Asia/Vladivostok"),
    ("Магадан (UTC+11)", "Asia/Magadan"),
    ("Камчатка (UTC+12)", "Asia/Kamchatka"),
    ("Минск (UTC+3)", "Europe/Minsk"),
    ("Киев (UTC+2/+3)", "Europe/Kyiv"),
    ("Астана (UTC+5)", "Asia/Almaty"),
    ("Ташкент (UTC+5)", "Asia/Tashkent"),
    ("Тбилиси (UTC+4)", "Asia/Tbilisi"),
    ("Ереван (UTC+4)", "Asia/Yerevan"),
    ("Баку (UTC+4)", "Asia/Baku"),
]


def parse_time(raw: str) -> str | None:
    """'9:30', '09.30', '0930' -> '09:30'. Возвращает None, если разобрать нельзя."""
    if raw is None:
        return None
    match = _TIME_RE.match(str(raw))
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return f"{hour:02d}:{minute:02d}"


def valid_tz(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def tz_or_default(name: str | None, default: str = "Europe/Moscow") -> ZoneInfo:
    if name and valid_tz(name):
        return ZoneInfo(name)
    return ZoneInfo(default)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso(moment: datetime | None = None) -> str:
    """UTC-метка времени в виде строки — так она хранится в базе."""
    moment = moment or now_utc()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def parse_utc(raw: str | None) -> datetime | None:
    if not raw:
        return None
    return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def local_now(tz_name: str | None, default_tz: str = "Europe/Moscow") -> datetime:
    return now_utc().astimezone(tz_or_default(tz_name, default_tz))


def parse_days(raw: str | None) -> list[int]:
    """'1,2,5' -> [1, 2, 5]. Пустое значение считается «каждый день»."""
    if not raw:
        return [1, 2, 3, 4, 5, 6, 7]
    days: list[int] = []
    for chunk in str(raw).split(","):
        chunk = chunk.strip()
        if chunk.isdigit() and 1 <= int(chunk) <= 7:
            days.append(int(chunk))
    return sorted(set(days)) or [1, 2, 3, 4, 5, 6, 7]


def days_to_str(days: list[int] | set[int]) -> str:
    return ",".join(str(d) for d in sorted(set(days)))


def format_days(raw: str | None) -> str:
    days = parse_days(raw)
    if days == [1, 2, 3, 4, 5, 6, 7]:
        return "ежедневно"
    if days == [1, 2, 3, 4, 5]:
        return "будни"
    if days == [6, 7]:
        return "выходные"
    return ", ".join(WEEKDAY_NAMES[d] for d in days)


def format_date(value: str) -> str:
    """'2026-08-27' -> '27.08.2026 (чт)'."""
    date = datetime.strptime(value, "%Y-%m-%d")
    return f"{date:%d.%m.%Y} ({WEEKDAY_NAMES[date.isoweekday()]})"


def format_minutes(minutes: float | None) -> str:
    if minutes is None:
        return "—"
    minutes = int(round(minutes))
    if minutes < 60:
        return f"{minutes} мин"
    hours, rest = divmod(minutes, 60)
    return f"{hours} ч {rest:02d} мин" if rest else f"{hours} ч"


def percent(part: int, total: int) -> int:
    return round(part * 100 / total) if total else 0


def progress_bar(part: int, total: int, width: int = 10) -> str:
    filled = round(width * part / total) if total else 0
    return "█" * filled + "░" * (width - filled)


def escape(text: str | None) -> str:
    """Экранирование для HTML-разметки Telegram."""
    if not text:
        return ""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def shorten(text: str, limit: int = 40) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
