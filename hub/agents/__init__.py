"""Список подключённых веток.

Чтобы добавить свою: положите рядом папку с модулем, соберите в нём объект
`Agent` (см. hub/registry.py) и допишите его сюда. Больше нигде править
ничего не нужно — хаб сам подхватит роутер, зависимости, фоновую задачу
и покажет ветку в меню.
"""

from __future__ import annotations

from ..registry import Agent
from .taxi import agent as taxi_agent

AGENTS: list[Agent] = [taxi_agent]

__all__ = ["AGENTS"]
