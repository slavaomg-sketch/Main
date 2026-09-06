from pipeline.cards import (
    get_section, read_card, render_frontmatter, replace_section, scenes_changed,
    slides_to_markdown, split_frontmatter, write_card,
)

BODY = """## Вводные
площадка: wb

## Заголовок
Шапка бини женская

## Описание
Абзац.

## Уточнить
- состав
"""


def test_frontmatter_roundtrip(tmp_path):
    meta = {"status": "draft", "title": "Шапка", "photos": 0, "concept": True}
    write_card(tmp_path / "card.md", meta, BODY)
    card = read_card(tmp_path)
    assert card is not None
    assert card.meta == meta
    assert card.section("Заголовок") == "Шапка бини женская"
    assert card.section("Уточнить") == "- состав"
    assert card.section("Нет такого") == ""


def test_split_frontmatter_without_it():
    meta, body = split_frontmatter("## Заголовок\nx\n")
    assert meta == {} and body.startswith("## Заголовок")


def test_render_frontmatter_keeps_order_and_unicode():
    text = render_frontmatter({"status": "ready", "title": "Шапка"})
    assert text == "---\nstatus: ready\ntitle: Шапка\n---\n"


def test_replace_section_existing_and_new():
    new = replace_section(BODY, "Описание", "Новый абзац.")
    assert get_section(new, "Описание") == "Новый абзац."
    assert get_section(new, "Заголовок") == "Шапка бини женская"
    added = replace_section(BODY, "Инфографика", "### Главное фото\nсцена: x")
    assert get_section(added, "Инфографика").startswith("### Главное фото")


def test_scenes_changed_ignores_text_only_edits():
    old = {"main": {"scene": "a", "badge": "x"}, "slides": [{"scene": "b", "headline": "h1", "lines": ["1"]}]}
    new = {"main": {"scene": "a", "badge": "y"}, "slides": [{"scene": "b", "headline": "h2", "lines": ["2"]}]}
    assert not scenes_changed(old, new)
    new["slides"][0]["scene"] = "c"
    assert scenes_changed(old, new)
    assert scenes_changed(None, new)


def test_slides_to_markdown():
    md = slides_to_markdown({"main": {"scene": "hat", "badge": "Хит"}, "slides": [{"scene": "s", "headline": "Тепло", "lines": ["до −15 °C"]}]})
    assert "### Главное фото" in md and "плашка: Хит" in md
    assert "### Слайд 1" in md and "- до −15 °C" in md
