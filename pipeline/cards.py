"""Карточка = папка cards/<slug>/ с card.md (frontmatter + разделы), idea.md, slides.json, images/."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

STATUS_DRAFT = "draft"          # конвейер сделал, ждёт тебя
STATUS_READY = "ready"          # ты одобрила
STATUS_REJECTED = "rejected"    # ты отклонила
STATUS_REDO = "redo"            # пересобрать текст (и картинки, если изменились слайды)
STATUS_REDO_IMAGES = "redo-images"  # только картинки заново
STATUS_ERROR = "error"          # конвейер не смог, причина в frontmatter

ALL_STATUSES = (STATUS_DRAFT, STATUS_READY, STATUS_REJECTED, STATUS_REDO, STATUS_REDO_IMAGES, STATUS_ERROR)

CARD_FILE = "card.md"
IDEA_FILE = "idea.md"
SLIDES_FILE = "slides.json"
GENERATED_FILE = ".generated.md"   # копия текста на момент генерации, для обучения на правках
IMAGES_DIR = "images"

_FM_RE = re.compile(r"^---\n(.*?)\n---\n?", re.S)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().replace(microsecond=0).isoformat()


@dataclass
class Card:
    dir: Path
    meta: dict[str, Any]
    body: str

    @property
    def slug(self) -> str:
        return self.dir.name

    @property
    def status(self) -> str:
        return str(self.meta.get("status", STATUS_DRAFT))

    @property
    def path(self) -> Path:
        return self.dir / CARD_FILE

    @property
    def images_dir(self) -> Path:
        return self.dir / IMAGES_DIR

    def section(self, name: str) -> str:
        return get_section(self.body, name)

    def save(self) -> None:
        write_card(self.path, self.meta, self.body)


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, text[m.end():]


def render_frontmatter(meta: dict[str, Any]) -> str:
    dumped = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, default_flow_style=False).strip()
    return f"---\n{dumped}\n---\n"


def write_card(path: Path, meta: dict[str, Any], body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_frontmatter(meta) + "\n" + body.strip("\n") + "\n", encoding="utf-8")


def read_card(card_dir: Path) -> Card | None:
    path = card_dir / CARD_FILE
    if not path.is_file():
        return None
    meta, body = split_frontmatter(path.read_text(encoding="utf-8"))
    return Card(dir=card_dir, meta=meta, body=body)


def list_cards(cards_dir: Path) -> list[Card]:
    if not cards_dir.is_dir():
        return []
    out = []
    for d in sorted(cards_dir.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            card = read_card(d)
            if card:
                out.append(card)
    return out


def card_exists(cards_dir: Path, slug: str) -> bool:
    return (cards_dir / slug / IDEA_FILE).is_file() or (cards_dir / slug / CARD_FILE).is_file()


def get_section(body: str, name: str) -> str:
    """Текст раздела `## name` до следующего `## `. Регистр и пробелы не важны."""
    pattern = re.compile(rf"(?ms)^##\s+{re.escape(name)}\s*$\n?(.*?)(?=^##\s|\Z)", re.I)
    m = pattern.search(body)
    return m.group(1).strip() if m else ""


def replace_section(body: str, name: str, new_text: str) -> str:
    pattern = re.compile(rf"(?ms)(^##\s+{re.escape(name)}\s*$\n?)(.*?)(?=^##\s|\Z)", re.I)
    if pattern.search(body):
        return pattern.sub(lambda m: m.group(1) + new_text.strip("\n") + "\n\n", body, count=1)
    return body.rstrip("\n") + f"\n\n## {name}\n{new_text.strip()}\n"


def load_slides(card_dir: Path) -> dict[str, Any] | None:
    p = card_dir / SLIDES_FILE
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_slides(card_dir: Path, slides: dict[str, Any]) -> None:
    (card_dir / SLIDES_FILE).write_text(
        json.dumps(slides, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def slides_to_markdown(slides: dict[str, Any]) -> str:
    """Человекочитаемая копия slides.json для раздела «Инфографика»."""
    out: list[str] = []
    main = slides.get("main") or {}
    out.append("### Главное фото")
    out.append(f"сцена: {main.get('scene', '')}")
    if main.get("badge"):
        out.append(f"плашка: {main['badge']}")
    for i, s in enumerate(slides.get("slides") or [], start=1):
        out.append("")
        out.append(f"### Слайд {i}")
        out.append(f"сцена: {s.get('scene', '')}")
        if s.get("headline"):
            out.append(f"заголовок: {s['headline']}")
        for line in s.get("lines") or []:
            out.append(f"- {line}")
    return "\n".join(out)


def scenes_changed(old: dict[str, Any] | None, new: dict[str, Any]) -> bool:
    """Нужно ли перегенерировать картинки: сравниваем только сцены, не надписи."""
    if not old:
        return True

    def scenes(d: dict[str, Any]) -> list[str]:
        result = [str((d.get("main") or {}).get("scene", "")).strip()]
        result += [str(s.get("scene", "")).strip() for s in d.get("slides") or []]
        return result

    return scenes(old) != scenes(new)
