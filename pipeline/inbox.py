"""Разбор ideas/inbox.md: один файл, одна идея = блок, начинающийся с `## Название`."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MARKETPLACES = {
    "wb": "wb", "вб": "wb", "wildberries": "wb", "вайлдберриз": "wb", "вайлдберис": "wb",
    "ozon": "ozon", "озон": "ozon",
    "amazon": "amazon", "амазон": "amazon",
}

# Русские ключи, которые понимает конвейер. Всё остальное попадает в extra.
KEYS = {
    "площадка": "marketplace", "маркетплейс": "marketplace",
    "факты": "facts", "характеристики": "facts",
    "выгода": "benefit", "преимущество": "benefit",
    "стиль": "style", "визуал": "style",
    "запросы": "queries", "ключи": "queries", "ключевые слова": "queries",
    "аудитория": "audience", "для кого": "audience",
    "фото": "photos", "папка": "photos",
    "цена": "price",
    "бренд": "brand",
}

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(title: str, max_len: int = 48) -> str:
    out = []
    for ch in title.strip().lower():
        if ch in _TRANSLIT:
            out.append(_TRANSLIT[ch])
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        else:
            out.append("-")
    slug = re.sub(r"-+", "-", "".join(out)).strip("-")
    return slug[:max_len].rstrip("-") or "idea"


@dataclass
class Idea:
    title: str
    slug: str
    marketplace: str = "wb"
    facts: list[str] = field(default_factory=list)
    benefit: str = ""
    style: str = ""
    queries: list[str] = field(default_factory=list)
    audience: str = ""
    photos: str = ""            # имя папки в ideas/photos/, если задано явно
    price: str = ""
    brand: str = ""
    extra: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)   # строки без ключа
    raw: str = ""

    def as_markdown(self) -> str:
        """Идея в виде блока, который кладём в cards/<slug>/idea.md и в раздел «Вводные»."""
        lines = [f"## {self.title}", f"площадка: {self.marketplace}"]
        if self.brand:
            lines.append(f"бренд: {self.brand}")
        if self.facts:
            lines.append("факты:")
            lines += [f"- {f}" for f in self.facts]
        if self.benefit:
            lines.append(f"выгода: {self.benefit}")
        if self.audience:
            lines.append(f"аудитория: {self.audience}")
        if self.queries:
            lines.append("запросы: " + ", ".join(self.queries))
        if self.price:
            lines.append(f"цена: {self.price}")
        if self.style:
            lines.append(f"стиль: {self.style}")
        if self.photos:
            lines.append(f"фото: {self.photos}")
        for k, v in self.extra.items():
            lines.append(f"{k}: {v}")
        if self.notes:
            lines.append("")
            lines += self.notes
        return "\n".join(lines) + "\n"


def _split_list(value: str) -> list[str]:
    parts = re.split(r"[,;\n]", value)
    return [p.strip() for p in parts if p.strip()]


def parse_block(block: str, default_marketplace: str = "wb") -> Idea | None:
    lines = block.strip("\n").splitlines()
    if not lines or not lines[0].startswith("## "):
        return None
    title = lines[0][3:].strip()
    if not title:
        return None
    idea = Idea(title=title, slug=slugify(title), marketplace=default_marketplace, raw=block.strip("\n") + "\n")

    current_list: str | None = None   # какой ключ сейчас собирает список ("facts"/"queries")
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("<!--"):
            current_list = None if not stripped else current_list
            continue
        if stripped.startswith(("- ", "* ", "• ")) and current_list:
            item = stripped[2:].strip()
            if item:
                getattr(idea, current_list).append(item)
            continue
        m = re.match(r"^([^:：]{1,40})\s*[:：]\s*(.*)$", stripped)
        if m:
            key = m.group(1).strip().lower()
            value = m.group(2).strip()
            attr = KEYS.get(key)
            if attr in ("facts", "queries"):
                current_list = attr
                if value:
                    getattr(idea, attr).extend(_split_list(value))
                continue
            current_list = None
            if attr == "marketplace":
                idea.marketplace = MARKETPLACES.get(value.lower(), value.lower() or default_marketplace)
            elif attr:
                setattr(idea, attr, value)
            else:
                idea.extra[key] = value
            continue
        if stripped.startswith(("- ", "* ", "• ")):
            # список без ключа считаем фактами
            idea.facts.append(stripped[2:].strip())
            current_list = "facts"
            continue
        current_list = None
        idea.notes.append(stripped)
    return idea


def parse_inbox(text: str, default_marketplace: str = "wb") -> list[Idea]:
    """Возвращает идеи в порядке появления. Дубли по slug получают суффикс -2, -3."""
    # HTML-комментарии (в них лежит пример и заметки) вырезаем целиком,
    # всё до первого `## ` — шапка файла с инструкцией, её игнорируем.
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    blocks = re.split(r"(?m)^(?=## )", text)
    ideas: list[Idea] = []
    seen: dict[str, int] = {}
    for block in blocks:
        idea = parse_block(block, default_marketplace)
        if idea is None:
            continue
        n = seen.get(idea.slug, 0) + 1
        seen[idea.slug] = n
        if n > 1:
            idea.slug = f"{idea.slug}-{n}"
        ideas.append(idea)
    return ideas
