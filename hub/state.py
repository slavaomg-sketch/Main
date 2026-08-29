"""Какая ветка сейчас открыта в каждом чате. Хранится в JSON рядом с данными."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

DEFAULT_PATH = Path(os.getenv("HUB_STATE", "data/hub.json"))


class HubState:
    """Маленькое хранилище: чат -> активный агент."""

    def __init__(self, path: Path | str = DEFAULT_PATH) -> None:
        self.path = Path(path)

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.path.parent, delete=False
        ) as tmp:
            tmp.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(self.path)

    def agent_for(self, chat_id: int) -> str | None:
        chats = self._read().get("chats") or {}
        chat = chats.get(str(chat_id)) or {}
        slug = chat.get("agent")
        return str(slug) if slug else None

    def set_agent(self, chat_id: int, slug: str) -> None:
        data = self._read()
        chats = data.get("chats") or {}
        chats[str(chat_id)] = {"agent": slug}
        data["chats"] = chats
        self._write(data)

    def clear(self, chat_id: int) -> None:
        data = self._read()
        chats = data.get("chats") or {}
        if chats.pop(str(chat_id), None) is not None:
            data["chats"] = chats
            self._write(data)
