"""Обучение на правках: diff между текстом конвейера и текстом после правок продавца -> правила в STYLE.md."""

from __future__ import annotations

import difflib
import logging
import re
from datetime import date
from pathlib import Path

from .cards import GENERATED_FILE, Card, get_section
from .claude_text import ClaudeError, parse_rules, run_claude
from .config import PipelineConfig
from .prompts import build_learn_prompt

log = logging.getLogger("pipeline.learn")

LEARNED_HEADER = "## Выученные правила"


def _strip_inputs(body: str) -> str:
    """Для сравнения убираем раздел «Вводные»: его правит продавец не как текст карточки, а как факты."""
    return re.sub(r"(?ms)^##\s+Вводные\s*$\n?.*?(?=^##\s|\Z)", "", body).strip()


def card_diff(card: Card) -> str:
    gen = card.dir / GENERATED_FILE
    if not gen.is_file():
        return ""
    before = _strip_inputs(gen.read_text(encoding="utf-8")).splitlines()
    after = _strip_inputs(card.body).splitlines()
    diff = difflib.unified_diff(before, after, fromfile="конвейер", tofile="продавец", lineterm="", n=1)
    return "\n".join(diff)


def existing_rules(style_path: Path) -> str:
    if not style_path.is_file():
        return ""
    text = style_path.read_text(encoding="utf-8")
    idx = text.find(LEARNED_HEADER)
    return text[idx + len(LEARNED_HEADER):].strip() if idx >= 0 else ""


def append_rules(style_path: Path, rules: list[str], slug: str) -> list[str]:
    text = style_path.read_text(encoding="utf-8") if style_path.is_file() else "# Стиль\n"
    known = {ln.strip().lstrip("-• ").strip().lower() for ln in existing_rules(style_path).splitlines()}
    fresh = [r for r in rules if r.strip().lower() not in known]
    if not fresh:
        return []
    if LEARNED_HEADER not in text:
        text = text.rstrip("\n") + f"\n\n{LEARNED_HEADER}\n"
    block = "\n".join(f"- {r}  <!-- {date.today().isoformat()}, {slug} -->" for r in fresh)
    text = text.rstrip("\n") + "\n" + block + "\n"
    style_path.write_text(text, encoding="utf-8")
    return fresh


def learn_from_card(card: Card, cfg: PipelineConfig) -> list[str]:
    diff = card_diff(card)
    notes = str(card.meta.get("notes", "") or "")
    if not diff.strip() and not notes.strip():
        log.info("%s: правок нет, учиться не на чем", card.slug)
        return []
    prompt = build_learn_prompt(
        slug=card.slug, diff=diff or "(текст не менялся)", notes=notes, status=card.status,
        existing_rules=existing_rules(cfg.style_path),
    )
    if cfg.dry_run:
        return []
    try:
        answer = run_claude(prompt, cfg)
    except ClaudeError as e:
        log.error("%s: обучение не удалось: %s", card.slug, e)
        return []
    rules = parse_rules(answer)
    added = append_rules(cfg.style_path, rules, card.slug)
    if added:
        log.info("%s: добавлено правил: %d", card.slug, len(added))
    return added


def open_questions(card: Card) -> list[str]:
    items = []
    for line in get_section(card.body, "Уточнить").splitlines():
        s = line.strip().lstrip("-•* ").strip()
        if s and s.lower() not in ("нет", "нет.", "—"):
            items.append(s)
    return items
