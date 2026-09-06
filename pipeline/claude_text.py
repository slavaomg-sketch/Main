"""Вызов Claude Code в headless-режиме (`claude -p`) и разбор ответа в карточку + план картинок."""

from __future__ import annotations

import json
import logging
import re
import subprocess
from typing import Any

from .config import PipelineConfig

log = logging.getLogger("pipeline.claude")

REQUIRED_SECTIONS = ("Заголовок", "Ключевые характеристики", "Описание", "Ключевые слова")


class ClaudeError(RuntimeError):
    pass


def run_claude(prompt: str, cfg: PipelineConfig) -> str:
    cmd = [cfg.claude_cmd, "-p", "--output-format", "text"]
    if cfg.claude_model:
        cmd += ["--model", cfg.claude_model]
    log.info("claude: %s (промпт %d символов)", " ".join(cmd[1:]), len(prompt))
    try:
        proc = subprocess.run(
            cmd, input=prompt, capture_output=True, text=True,
            timeout=cfg.claude_timeout, cwd=str(cfg.repo_dir),
        )
    except FileNotFoundError:
        raise ClaudeError(f"Команда {cfg.claude_cmd!r} не найдена. Установите Claude Code и выполните вход.")
    except subprocess.TimeoutExpired:
        raise ClaudeError(f"claude не ответил за {cfg.claude_timeout} с")
    if proc.returncode != 0:
        raise ClaudeError(f"claude завершился с кодом {proc.returncode}: {proc.stderr.strip()[:500]}")
    out = proc.stdout.strip()
    if not out:
        raise ClaudeError("claude вернул пустой ответ")
    return out


_JSON_BLOCK = re.compile(r"```json\s*\n(.*?)\n```", re.S)


def parse_card_output(text: str) -> tuple[str, dict[str, Any]]:
    """Возвращает (markdown карточки без json-блока, план картинок). Бросает ClaudeError, если формат нарушен."""
    blocks = _JSON_BLOCK.findall(text)
    slides: dict[str, Any] | None = None
    for raw in reversed(blocks):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and "slides" in data:
            slides = data
            break
    if slides is None:
        raise ClaudeError("в ответе нет json-блока с планом картинок")

    body = _JSON_BLOCK.sub("", text).strip()
    # Срезаем всё до первого раздела `## Заголовок`, если модель добавила преамбулу.
    m = re.search(r"(?m)^##\s+Заголовок", body)
    if m:
        body = body[m.start():]
    missing = [s for s in REQUIRED_SECTIONS if not re.search(rf"(?m)^##\s+{re.escape(s)}\s*$", body)]
    if missing:
        raise ClaudeError("в ответе нет разделов: " + ", ".join(missing))
    if not re.search(r"(?m)^##\s+Уточнить\s*$", body):
        body += "\n\n## Уточнить\n- нет\n"

    slides.setdefault("main", {})
    slides["main"] = {
        "scene": str(slides["main"].get("scene", "")).strip(),
        "badge": str(slides["main"].get("badge", "") or "").strip(),
    }
    clean_slides = []
    for s in slides.get("slides") or []:
        if not isinstance(s, dict):
            continue
        clean_slides.append({
            "scene": str(s.get("scene", "")).strip(),
            "headline": str(s.get("headline", "") or "").strip(),
            "lines": [str(x).strip() for x in (s.get("lines") or []) if str(x).strip()][:4],
        })
    slides["slides"] = clean_slides
    return body.strip() + "\n", slides


def generate_card_text(prompt: str, cfg: PipelineConfig, retries: int = 1) -> tuple[str, dict[str, Any]]:
    last: Exception | None = None
    for attempt in range(retries + 1):
        raw = run_claude(prompt, cfg)
        try:
            return parse_card_output(raw)
        except ClaudeError as e:
            last = e
            log.warning("ответ claude не разобран (попытка %d): %s", attempt + 1, e)
            prompt = prompt + "\n\nПредыдущий ответ был отклонён: " + str(e) + ". Ответь строго в требуемом формате."
    raise ClaudeError(str(last))


def parse_rules(text: str) -> list[str]:
    rules = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.lower() in ("нет", "нет.", "—", "-"):
            continue
        if s.startswith(("- ", "* ", "• ")):
            s = s[2:].strip()
        elif re.match(r"^\d+[.)]\s+", s):
            s = re.sub(r"^\d+[.)]\s+", "", s)
        else:
            continue
        if s:
            rules.append(s)
    return rules[:5]
