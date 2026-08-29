"""Реестр уведомлялок: имя из командной строки -> объект."""

from __future__ import annotations

from .apple import CalendarNotifier, MacNotificationNotifier, RemindersNotifier
from .base import Notifier
from .console import ConsoleNotifier
from .icsfile import IcsNotifier
from .telegram import TelegramNotifier

BUILDERS = {
    "console": ConsoleNotifier,
    "banner": MacNotificationNotifier,
    "reminders": RemindersNotifier,
    "calendar": CalendarNotifier,
    "ics": IcsNotifier,
    "telegram": TelegramNotifier,
}

DESCRIPTIONS = {
    "console": "печатать в терминал",
    "banner": "баннер macOS (пока запущен трекер)",
    "reminders": "запись в Apple Напоминаниях с будильником",
    "calendar": "событие в Apple Календаре с будильниками",
    "ics": "файл .ics с будильниками (для iPhone и любых календарей)",
    "telegram": "сообщение в Telegram",
}

# Заранее запланированные напоминания сработают и без запущенного трекера.
STANDALONE = {"reminders", "calendar", "ics"}


def parse_names(raw: str | None, default: str = "console") -> list[str]:
    """'reminders,telegram' -> ['reminders', 'telegram'] с проверкой имён."""
    names: list[str] = []
    for chunk in (raw or default).replace(";", ",").split(","):
        chunk = chunk.strip().lower()
        if not chunk or chunk in names:
            continue
        if chunk not in BUILDERS:
            known = ", ".join(sorted(BUILDERS))
            raise ValueError(f"Неизвестный способ уведомления '{chunk}'. Доступные: {known}")
        names.append(chunk)
    return names or [default]


def build(names: list[str]) -> list[Notifier]:
    return [BUILDERS[name]() for name in names]


__all__ = [
    "BUILDERS",
    "DESCRIPTIONS",
    "STANDALONE",
    "Notifier",
    "ConsoleNotifier",
    "IcsNotifier",
    "build",
    "parse_names",
]
