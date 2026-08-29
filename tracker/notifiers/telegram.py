"""Сообщение в Telegram — способ получить сигнал на телефон без Мака.

Токен и адресата берём из тех же переменных, что и бот напоминаний:
``TRACKER_BOT_TOKEN``/``BOT_TOKEN`` и ``TRACKER_CHAT_ID``/первый из ``ADMIN_IDS``.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from ..models import Event
from .base import Notifier

API = "https://api.telegram.org"


def _first_admin() -> str:
    raw = os.getenv("ADMIN_IDS", "")
    for chunk in raw.replace(";", ",").split(","):
        chunk = chunk.strip()
        if chunk:
            return chunk
    return ""


class TelegramNotifier(Notifier):
    name = "telegram"

    def __init__(self, token: str | None = None, chat_id: str | None = None) -> None:
        self.token = token or os.getenv("TRACKER_BOT_TOKEN") or os.getenv("BOT_TOKEN", "")
        self.chat_id = chat_id or os.getenv("TRACKER_CHAT_ID") or _first_admin()
        self.available = bool(self.token and self.chat_id)
        self.unavailable_reason = (
            "" if self.available else "нужны BOT_TOKEN и TRACKER_CHAT_ID (или ADMIN_IDS)"
        )

    def push(self, event: Event) -> None:
        if not self.available:
            return
        text = event.title if not event.body else f"{event.title}\n{event.body}"
        payload = urllib.parse.urlencode(
            {
                "chat_id": self.chat_id,
                "text": text,
                "disable_web_page_preview": "true",
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{API}/bot{self.token}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                answer = json.loads(response.read().decode("utf-8"))
            if not answer.get("ok"):  # pragma: no cover - зависит от Telegram
                print(f"[telegram] отказ: {answer.get('description')}", file=sys.stderr)
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
            print(f"[telegram] не отправилось: {exc}", file=sys.stderr)
