from pipeline.inbox import parse_block, parse_inbox, slugify

SAMPLE = """# Идеи

Шапка файла с инструкцией, её парсер игнорирует.

<!-- ## Закомментированная идея
факты:
- не должна попасть
-->

## Шапка-бини с помпоном
площадка: ВБ
бренд: Nata
факты:
- материал: акрил 100%
- размер: 54–58 см
выгода: не колется
запросы: шапка бини женская, шапка с помпоном
цена: 890
стиль: тёплые тона
сезон: зима

## Органайзер для косметики
площадка: ozon
- прозрачный акрил
- 4 отделения
запросы: органайзер для косметики; органайзер прозрачный
Просто заметка без ключа.

## Шапка-бини с помпоном
факты:
- дубль названия
"""


def test_slugify_translit():
    assert slugify("Шапка-бини с помпоном") == "shapka-bini-s-pomponom"
    assert slugify("  Hello, World!  ") == "hello-world"
    assert slugify("!!!") == "idea"


def test_parse_inbox_basic():
    ideas = parse_inbox(SAMPLE)
    assert [i.slug for i in ideas] == [
        "shapka-bini-s-pomponom", "organayzer-dlya-kosmetiki", "shapka-bini-s-pomponom-2",
    ]
    hat = ideas[0]
    assert hat.marketplace == "wb"
    assert hat.brand == "Nata"
    assert hat.facts == ["материал: акрил 100%", "размер: 54–58 см"]
    assert hat.benefit == "не колется"
    assert hat.queries == ["шапка бини женская", "шапка с помпоном"]
    assert hat.price == "890"
    assert hat.style == "тёплые тона"
    assert hat.extra == {"сезон": "зима"}


def test_parse_inbox_list_without_key_and_notes():
    org = parse_inbox(SAMPLE)[1]
    assert org.marketplace == "ozon"
    assert org.facts == ["прозрачный акрил", "4 отделения"]
    assert org.queries == ["органайзер для косметики", "органайзер прозрачный"]
    assert org.notes == ["Просто заметка без ключа."]


def test_commented_idea_ignored():
    slugs = [i.slug for i in parse_inbox(SAMPLE)]
    assert "zakommentirovannaya-ideya" not in slugs


def test_multiline_comment_with_heading_ignored():
    text = "# Идеи\n\n<!-- Пример:\n\n## Пример в комментарии\nфакты:\n- x\n\n-->\n\n## Настоящая\nфакты:\n- y\n"
    assert [i.slug for i in parse_inbox(text)] == ["nastoyaschaya"]


def test_repo_inbox_parses():
    from pathlib import Path
    inbox = Path(__file__).resolve().parents[1] / "ideas" / "inbox.md"
    ideas = parse_inbox(inbox.read_text(encoding="utf-8"))
    assert all(i.title and i.slug for i in ideas)


def test_as_markdown_roundtrip():
    idea = parse_inbox(SAMPLE)[0]
    again = parse_block(idea.as_markdown())
    assert again is not None
    assert again.facts == idea.facts
    assert again.queries == idea.queries
    assert again.marketplace == idea.marketplace
    assert again.extra == idea.extra


def test_empty_inbox():
    assert parse_inbox("# Идеи\n\nничего\n") == []
