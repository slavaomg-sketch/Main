"""Что такое агент и как хаб его подключает.

Агент — это отдельная «ветка» внутри одного бота: свои обработчики, своё
состояние, своя фоновая задача. Хаб держит для каждого чата активного агента
и отдаёт ему обычные сообщения; агенты друг о друге ничего не знают.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from aiogram import Bot, Router
from aiogram.types import BotCommand


class Background(Protocol):
    """Фоновая задача агента (например, опрос Яндекса)."""

    def start(self) -> None: ...

    async def shutdown(self) -> None: ...


@dataclass(frozen=True)
class Agent:
    """Описание ветки бота.

    slug        — идентификатор, он же в callback_data кнопки меню;
    title       — как ветка называется в меню («🚕 Доставка»);
    summary     — строка-пояснение под названием;
    greeting    — что показать, когда пользователь вошёл в ветку;
    router      — обработчики; обычные сообщения к ним попадают,
                  только когда ветка активна в этом чате;
    commands    — команды агента для меню Telegram;
    claims      — «это моё?»: если функция узнаёт текст (скажем, ссылку
                  на доставку), хаб сам переключится на этот агент;
    setup       — положить зависимости агента в данные диспетчера;
    background  — создать фоновую задачу (или None, если она не нужна).
    """

    slug: str
    title: str
    summary: str
    greeting: str
    router: Router
    commands: list[BotCommand] = field(default_factory=list)
    claims: Callable[[str], bool] | None = None
    setup: Callable[[dict[str, Any], Any], None] | None = None
    background: Callable[[Bot, dict[str, Any]], Background] | None = None

    def owns(self, text: str) -> bool:
        if self.claims is None or not text:
            return False
        try:
            return bool(self.claims(text))
        except Exception:  # noqa: BLE001 - кривой агент не должен ронять хаб
            return False


def find(agents: list[Agent], slug: str | None) -> Agent | None:
    for agent in agents:
        if agent.slug == slug:
            return agent
    return None
