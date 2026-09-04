"""Клавиатуры должны собираться и укладываться в лимиты Telegram.

Регрессия: двоеточие внутри времени ломало упаковку callback_data,
из-за чего падал весь экран выбора времени.
"""

import sqlite3

import pytest

from bot import keyboards
from bot.utils import POPULAR_TZ


def _row(**fields) -> sqlite3.Row:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    columns = ", ".join(f'? AS "{name}"' for name in fields)
    return connection.execute(f"SELECT {columns}", tuple(fields.values())).fetchone()


def _all_callback_data(markup) -> list[str]:
    return [
        button.callback_data
        for row in markup.inline_keyboard
        for button in row
        if button.callback_data
    ]


def _assert_valid(markup) -> None:
    for data in _all_callback_data(markup):
        encoded = data.encode("utf-8")
        assert len(encoded) <= 64, f"callback_data длиннее 64 байт: {data}"


def test_time_keyboard_packs_every_preset():
    markup = keyboards.time_keyboard()
    _assert_valid(markup)
    assert "time|09:00" in _all_callback_data(markup)
    assert "time|manual" in _all_callback_data(markup)


def test_days_keyboard():
    markup = keyboards.days_keyboard([1, 2, 3])
    _assert_valid(markup)
    labels = [button.text for row in markup.inline_keyboard for button in row]
    assert "✅ пн" in labels
    assert "▫️ сб" in labels


def test_tz_keyboard_covers_all_zones():
    markup = keyboards.tz_keyboard()
    _assert_valid(markup)
    assert len(_all_callback_data(markup)) == len(POPULAR_TZ) + 1  # плюс «Назад»


def test_delivery_keyboard_with_and_without_items():
    items = [_row(id=index, text=f"Пункт {index}", is_done=0) for index in range(1, 4)]
    markup = keyboards.delivery_keyboard(7, items)
    _assert_valid(markup)
    labels = [button.text for row in markup.inline_keyboard for button in row]
    assert "✅ Готово" in labels
    assert "☑️ Отметить всё" in labels

    empty = keyboards.delivery_keyboard(7, [])
    _assert_valid(empty)
    assert "✅ Выполнено" in [b.text for row in empty.inline_keyboard for b in row]


def test_delivery_keyboard_is_locked_after_finish():
    """Отмечаться повторно нельзя, но пояснить причину можно и после закрытия."""
    items = [_row(id=1, text="Пункт", is_done=1)]
    markup = keyboards.delivery_keyboard(7, items, finalized=True)
    labels = [button.text for row in markup.inline_keyboard for button in row]

    assert labels == ["✅ Отмечено", "💬 Добавить комментарий"]
    assert "done:finish" not in "".join(_all_callback_data(markup))


def test_comment_button_marks_existing_comment():
    items = [_row(id=1, text="Пункт", is_done=0)]
    labels = [
        button.text
        for row in keyboards.delivery_keyboard(7, items, has_comment=True).inline_keyboard
        for button in row
    ]
    assert "💬 Комментарий ✓" in labels

    finalized = [
        button.text
        for row in keyboards.delivery_keyboard(
            7, items, finalized=True, has_comment=True
        ).inline_keyboard
        for button in row
    ]
    assert "💬 Изменить комментарий" in finalized


def test_long_titles_do_not_break_callback_limits():
    subs = [
        _row(
            id=999999,
            reminder_id=888888,
            time="09:00",
            is_active=1,
            scope="global",
            is_mandatory=1,
            title="Очень длинное название процесса " * 5,
            days="1,2,3,4,5",
            reminder_days="1,2,3,4,5",
        )
    ]
    _assert_valid(keyboards.subscriptions_keyboard(subs))


@pytest.mark.parametrize("is_admin", [True, False])
def test_main_menu_shows_admin_button_only_to_admin(is_admin):
    labels = [button.text for row in keyboards.main_menu(is_admin).keyboard for button in row]
    assert (keyboards.BTN_ADMIN in labels) is is_admin
