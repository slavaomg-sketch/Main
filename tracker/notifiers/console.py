"""Печать событий в терминал — всегда доступна, годится для отладки."""

from __future__ import annotations

import sys
from datetime import datetime

from ..models import EVENT_ALERT, EVENT_ARRIVED, EVENT_FINISHED, Event
from .base import Notifier

_ICONS = {
    EVENT_ALERT: "🔔",
    EVENT_ARRIVED: "🚗",
    EVENT_FINISHED: "✅",
}


class ConsoleNotifier(Notifier):
    name = "console"

    def __init__(self, stream=None) -> None:
        self.stream = stream or sys.stdout

    def push(self, event: Event) -> None:
        icon = _ICONS.get(event.kind, "•")
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{stamp}] {icon} {event.title}", file=self.stream)
        if event.body:
            for line in event.body.splitlines():
                print(f"           {line}", file=self.stream)
        self.stream.flush()
