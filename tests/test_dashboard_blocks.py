"""Каталог блоков и проверка присланной раскладки."""

from dashboard.blocks import (
    BLOCK_CATALOG,
    BLOCK_TYPES,
    default_layout,
    new_block,
    sanitize_layout,
)


def test_every_block_has_valid_default_size():
    for definition in BLOCK_CATALOG:
        assert definition["defaultSize"] in definition["sizes"]
        assert definition["title"]
        assert definition["description"]
        assert definition["group"]


def test_block_types_are_unique():
    types = [definition["type"] for definition in BLOCK_CATALOG]
    assert len(types) == len(set(types))


def test_default_layout_uses_known_types_and_unique_ids():
    layout = default_layout()
    assert layout
    assert all(block["type"] in BLOCK_TYPES for block in layout)
    ids = [block["id"] for block in layout]
    assert len(ids) == len(set(ids))


def test_new_block_carries_default_settings():
    block = new_block("panel.goal")
    assert block["settings"]["goal"] > 0
    assert block["hidden"] is False


def test_sanitize_drops_unknown_block_types():
    layout = sanitize_layout([
        {"id": "a", "type": "kpi.revenue", "size": "sm"},
        {"id": "b", "type": "kpi.выдуманный", "size": "sm"},
    ])
    assert [block["type"] for block in layout] == ["kpi.revenue"]


def test_sanitize_replaces_unsupported_size_with_default():
    layout = sanitize_layout([{"id": "a", "type": "kpi.revenue", "size": "xl"}])
    assert layout[0]["size"] == BLOCK_TYPES["kpi.revenue"]["defaultSize"]


def test_sanitize_gives_duplicate_ids_new_values():
    layout = sanitize_layout([
        {"id": "same", "type": "kpi.revenue", "size": "sm"},
        {"id": "same", "type": "kpi.orders", "size": "sm"},
    ])
    assert layout[0]["id"] != layout[1]["id"]


def test_sanitize_keeps_only_known_settings():
    layout = sanitize_layout([
        {"id": "a", "type": "panel.goal", "size": "md",
         "settings": {"goal": 100, "runCommand": "rm -rf /"}},
    ])
    assert layout[0]["settings"] == {"goal": 100}


def test_sanitize_falls_back_to_default_layout_on_garbage():
    assert sanitize_layout("не список") == default_layout() or sanitize_layout([]) 
    assert len(sanitize_layout([{"type": "нет такого"}])) == len(default_layout())


def test_sanitize_limits_layout_length():
    huge = [{"id": str(i), "type": "kpi.revenue", "size": "sm"} for i in range(200)]
    assert len(sanitize_layout(huge)) == 60


def test_sanitize_preserves_hidden_flag_and_custom_title():
    layout = sanitize_layout([
        {"id": "a", "type": "kpi.revenue", "size": "sm", "hidden": True, "title": "Мой блок"},
    ])
    assert layout[0]["hidden"] is True
    assert layout[0]["title"] == "Мой блок"
