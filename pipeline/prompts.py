"""Тексты промптов для Claude (карточка, обучение на правках) и gpt-image-2 (картинки)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .inbox import Idea

MARKETPLACE_NAMES = {"wb": "Wildberries", "ozon": "Ozon", "amazon": "Amazon"}

CARD_FORMAT = """## Заголовок
[одна строка в пределах лимита площадки]

## Ключевые характеристики
- [свойство]: [значение]
(5–10 пунктов, самые важные сверху)

## Описание
[2–4 абзаца: выгода → свойства → сценарии использования → снятие возражений]

## Ключевые слова
[список через запятую, уже вписанные в текст выше]

## Уточнить
- [чего не хватает во вводных, по одному пункту на строку; если всё есть — одна строка «нет»]
"""

SLIDES_SCHEMA = """```json
{
  "main": {
    "scene": "описание главного фото на английском для генератора картинок: товар, ракурс, фон, свет",
    "badge": "короткая плашка на русском до 3 слов или пустая строка"
  },
  "slides": [
    {
      "scene": "описание сцены слайда на английском",
      "headline": "заголовок слайда на русском, до 5 слов",
      "lines": ["тезис 1 на русском до 6 слов", "тезис 2", "тезис 3"]
    }
  ]
}
```"""


def read_style(style_path: Path) -> str:
    return style_path.read_text(encoding="utf-8") if style_path.is_file() else ""


def style_yaml_block(style_md: str) -> dict[str, Any]:
    """Первый блок ```yaml в STYLE.md — машинные параметры оформления."""
    import yaml

    m = re.search(r"```ya?ml\n(.*?)```", style_md, re.S)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def style_prose(style_md: str) -> str:
    """STYLE.md без yaml-блока — то, что читает Claude."""
    return re.sub(r"```ya?ml\n.*?```", "", style_md, flags=re.S).strip()


def read_marketplace_reference(skill_dir: Path, marketplace: str) -> str:
    names = {"wb": "wildberries.md", "ozon": "ozon.md", "amazon": "amazon.md"}
    p = skill_dir / "references" / names.get(marketplace, "wildberries.md")
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def read_skill(skill_dir: Path) -> str:
    p = skill_dir / "SKILL.md"
    if not p.is_file():
        return ""
    text = p.read_text(encoding="utf-8")
    # убираем frontmatter скилла
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            text = parts[2]
    return text.strip()


def build_card_prompt(
    idea: Idea,
    *,
    skill_md: str,
    reference_md: str,
    style_md: str,
    photos_count: int,
    slides_per_card: int,
    inputs_override: str = "",
) -> str:
    market = MARKETPLACE_NAMES.get(idea.marketplace, idea.marketplace)
    inputs = inputs_override.strip() or idea.as_markdown().strip()
    photo_note = (
        f"Реальных фото товара: {photos_count}. Сцены для картинок описывай так, чтобы генератор "
        "использовал эти фото как референс товара."
        if photos_count
        else "Реальных фото товара нет. Картинки будут концептом по описанию, сцены описывай по фактам из вводных, "
        "ничего не додумывай про внешний вид сверх того, что дано."
    )
    return f"""Ты пишешь карточку товара для маркетплейса {market}. Работай молча, инструменты не используй, ответь одним сообщением строго в формате ниже.

# Правила написания карточек
{skill_md}

# Правила площадки {market}
{reference_md}

# Стиль и правила этого продавца (STYLE.md)
{style_prose(style_md) or "(пока пусто)"}

# Вводные от продавца
{inputs}

{photo_note}

# Жёсткие требования
- Не выдумывай характеристики, которых нет во вводных. Чего не хватает — пиши в раздел «Уточнить», а в тексте карточки не упоминай.
- Заголовок начинается с главного поискового запроса, не с бренда и не с маркетингового названия.
- Ключевые запросы из вводных должны встретиться в тексте 1–2 раза каждый, без переспама.
- Тон спокойный и конкретный, без «уникальный», «лучший», «премиальный» без фактов.
- Язык карточки: русский (для Amazon — английский).

# Формат ответа
Сначала markdown ровно с такими разделами второго уровня и в таком порядке:

{CARD_FORMAT}
Затем, после карточки, один блок json с планом картинок: главное фото и ровно {slides_per_card} слайда инфографики. Схема:

{SLIDES_SCHEMA}

Требования к плану картинок: сцены на английском, 1–2 предложения, без текста внутри сцены (надписи задаются отдельно полями). Заголовки и тезисы на русском, короткие, каждый слайд про одну выгоду или сценарий: слайд 1 — главная выгода, слайд 2 — характеристики и размеры, слайд 3 — сценарий использования или снятие возражения. Никаких других разделов, преамбул и пояснений вне указанного формата.
"""


def build_learn_prompt(*, slug: str, diff: str, notes: str, status: str, existing_rules: str) -> str:
    verdict = "продавец одобрил карточку" if status == "ready" else "продавец отклонил карточку"
    return f"""Ты ведёшь список правил стиля для автоматического написания карточек товара. Ниже — разница между текстом, который написал конвейер, и текстом после правок продавца ({verdict}). Инструменты не используй, ответь одним сообщением.

# Карточка: {slug}

# Уже известные правила
{existing_rules.strip() or "(пусто)"}

# Заметки продавца
{notes.strip() or "(нет)"}

# Diff (минус — было у конвейера, плюс — стало после правок)
```diff
{diff.strip()}
```

Выведи от 0 до 5 новых правил, которые обобщают эти правки и пригодятся для СЛЕДУЮЩИХ карточек других товаров. Правило — одна строка, начинается с дефиса, конкретное и проверяемое («не использовать слово X», «характеристики начинать с размера», «заголовок не длиннее N символов»). Не повторяй уже известные правила. Не описывай правки, специфичные только для этого товара. Если обобщать нечего — выведи ровно строку «нет».
"""


def build_image_prompt(
    *,
    kind: str,                 # "main" | "slide"
    scene: str,
    headline: str,
    lines: list[str],
    badge: str,
    style_md: str,
    text_mode: str,            # "overlay" | "native"
    size: str,
    photos: list[Path],
    concept: bool,
    out_name: str,
) -> str:
    style_params = style_yaml_block(style_md)
    prose = style_prose(style_md)
    accent = style_params.get("accent", "#FF6B35")
    background = style_params.get("background", "clean white or very light neutral studio background")

    parts = [
        f"Use the image generation tool to create ONE image and save it as ./{out_name} in the current working directory.",
        f"Size: {size} (portrait 3:4). This is a marketplace product card image for Wildberries/Ozon.",
        f"Scene: {scene}",
        f"Background: {background}. Accent color: {accent}. Photorealistic product rendering, sharp, evenly lit, no watermarks, no logos, no people unless the scene says so.",
    ]
    if photos:
        parts.append(
            "The attached photos show the REAL product. Reproduce the product exactly as in the photos "
            "(shape, colors, materials, details). Do not invent a different product."
        )
    if concept:
        parts.append("No reference photos are available; render the product strictly from the scene description.")
    if text_mode == "native":
        texts = []
        if kind == "main" and badge:
            texts.append(f'a small rounded badge in the top-left corner with the Russian text "{badge}"')
        if kind == "slide":
            if headline:
                texts.append(f'a large bold headline at the top: "{headline}"')
            for line in lines:
                texts.append(f'a bullet line: "{line}"')
        if texts:
            parts.append(
                "Render the following Russian text INSIDE the image, spelled exactly, in a clean modern sans-serif "
                "(Montserrat-like), high contrast, no spelling changes: " + "; ".join(texts) + "."
            )
        else:
            parts.append("No text in the image.")
    else:
        parts.append(
            "IMPORTANT: absolutely no text, letters, numbers, labels or logos anywhere in the image. "
            "Leave the top 32% of the image visually calm (plain background, no product parts) — text will be added later."
            if kind == "slide"
            else "IMPORTANT: absolutely no text, letters, numbers or labels anywhere in the image."
        )
    if prose:
        parts.append("Brand style notes (follow where relevant): " + " ".join(prose.split())[:1200])
    parts.append("Do not ask questions. Do not do anything else. When the file is saved, reply with the single word DONE.")
    return "\n".join(parts)


def dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)
