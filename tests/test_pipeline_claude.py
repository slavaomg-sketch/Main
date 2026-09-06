import pytest

from pipeline.claude_text import ClaudeError, parse_card_output, parse_rules

GOOD = """Вот карточка:

## Заголовок
Шапка бини женская зимняя с помпоном

## Ключевые характеристики
- Материал: акрил 100%
- Размер: 54–58 см

## Описание
Тёплая шапка.

## Ключевые слова
шапка бини женская, шапка с помпоном

## Уточнить
- нет

```json
{
  "main": {"scene": "beige knit beanie on white background", "badge": "Хит"},
  "slides": [
    {"scene": "beanie close-up", "headline": "Не колется", "lines": ["акрил 100%", "мягкая", "лишний", "ещё", "пятый"]}
  ]
}
```
"""


def test_parse_good_output():
    body, slides = parse_card_output(GOOD)
    assert body.startswith("## Заголовок")
    assert "```json" not in body
    assert "Вот карточка" not in body
    assert slides["main"]["badge"] == "Хит"
    assert len(slides["slides"]) == 1
    assert len(slides["slides"][0]["lines"]) == 4  # не больше 4 тезисов


def test_missing_json_block():
    with pytest.raises(ClaudeError):
        parse_card_output(GOOD.split("```json")[0])


def test_missing_section():
    broken = GOOD.replace("## Описание\nТёплая шапка.\n", "")
    with pytest.raises(ClaudeError, match="Описание"):
        parse_card_output(broken)


def test_adds_clarify_section_when_absent():
    text = GOOD.replace("## Уточнить\n- нет\n", "")
    body, _ = parse_card_output(text)
    assert "## Уточнить" in body


def test_parse_rules():
    assert parse_rules("нет") == []
    assert parse_rules("- не писать «премиальный»\n* заголовок до 60 символов\n1. цифры вместо эпитетов\nпояснение без маркера") == [
        "не писать «премиальный»", "заголовок до 60 символов", "цифры вместо эпитетов",
    ]
