"""Тексты самого хаба. У каждой ветки свои — в её папке."""

from __future__ import annotations

from .registry import Agent

NOT_ALLOWED = "Этот бот личный. Если он нужен вам — поднимите свою копию, код открыт."

NO_AGENTS = "Ни одна ветка не подключена. Загляните в hub/agents/__init__.py."

PICK_AGENT = "Выберите ветку — или просто пришлите то, с чем нужно помочь."

CANCELLED = "Отменил."


def greeting(agents: list[Agent]) -> str:
    """Приветствие с перечнем веток."""
    lines = [
        "👋 <b>Это бот-хаб.</b>",
        "Внутри — несколько веток, каждая занимается своим делом.",
        "",
    ]
    for agent in agents:
        lines.append(f"<b>{agent.title}</b> — {agent.summary}")
    lines += [
        "",
        "Ветка переключается кнопкой ниже или командой /menu. "
        "Если пришлёте что-то узнаваемое — например ссылку на доставку — "
        "нужная ветка откроется сама.",
    ]
    return "\n".join(lines)


def menu_header(active: Agent | None) -> str:
    if active is None:
        return PICK_AGENT
    return f"Сейчас открыта ветка <b>{active.title}</b>.\n{PICK_AGENT}"


def switched(agent: Agent) -> str:
    return f"<b>{agent.title}</b>\n\n{agent.greeting}"


def unknown_without_agent(agents: list[Agent]) -> str:
    names = ", ".join(agent.title for agent in agents)
    return (
        "Не понял, к какой ветке это относится.\n"
        f"Выберите её кнопкой: {names}\n\n"
        "Или откройте меню — /menu."
    )
