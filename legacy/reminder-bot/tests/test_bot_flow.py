"""Сквозные проверки: настоящие роутеры и мидлвари, подставной Telegram."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import (
    AnswerCallbackQuery,
    EditMessageReplyMarkup,
    EditMessageText,
    GetMe,
    SendMessage,
    TelegramMethod,
)
from aiogram.types import CallbackQuery, Chat, Message, Update
from aiogram.types import User as TgUser

from bot import repo
from bot.config import Config
from bot.main import build_dispatcher

ADMIN_ID = 1
EMPLOYEE_ID = 100


class MockSession(BaseSession):
    """Ловит вызовы Telegram API и возвращает правдоподобные ответы."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod] = []
        self._message_id = 1000

    async def close(self) -> None:  # pragma: no cover - ничего не держим
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover
        yield b""

    async def make_request(self, bot: Bot, method: TelegramMethod, timeout: int | None = None):
        self.calls.append(method)

        if isinstance(method, GetMe):
            return TgUser(id=42, is_bot=True, first_name="Bot", username="test_bot")
        if isinstance(method, (SendMessage, EditMessageText)):
            self._message_id += 1
            return Message(
                message_id=self._message_id,
                date=datetime.now(timezone.utc),
                chat=Chat(id=getattr(method, "chat_id", EMPLOYEE_ID) or EMPLOYEE_ID, type="private"),
                text=method.text,
            )
        if isinstance(method, (AnswerCallbackQuery, EditMessageReplyMarkup)):
            return True
        return True

    # --- удобные выборки для проверок -------------------------------------

    def texts(self) -> list[str]:
        return [
            call.text
            for call in self.calls
            if isinstance(call, (SendMessage, EditMessageText)) and call.text
        ]

    def last_text(self) -> str:
        texts = self.texts()
        assert texts, "бот ничего не ответил"
        return texts[-1]

    def alerts(self) -> list[str]:
        return [call.text for call in self.calls if isinstance(call, AnswerCallbackQuery) and call.text]

    def markups(self) -> list[Any]:
        return [
            call.reply_markup
            for call in self.calls
            if isinstance(call, (SendMessage, EditMessageText)) and call.reply_markup
        ]

    def clear(self) -> None:
        self.calls.clear()


TEST_CONFIG = Config(
    bot_token="42:TEST",
    admin_ids=[ADMIN_ID],
    db_path=Path("/tmp/never-used.db"),
    default_tz="UTC",
    report_time="20:00",
    nudge_after_minutes=60,
    catchup_minutes=15,
)


@pytest.fixture(scope="session")
def dispatcher():
    """Роутеры — объекты уровня модуля, поэтому диспетчер собирается один раз."""
    return build_dispatcher(conn=None, config=TEST_CONFIG)


@pytest_asyncio.fixture
async def bot() -> Bot:
    instance = Bot(
        token="42:TESTTOKENTESTTOKENTESTTOKENTESTTOKEN",
        session=MockSession(),
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    yield instance
    await instance.session.close()


@pytest.fixture
def session(bot: Bot) -> MockSession:
    return bot.session


@pytest.fixture
def dp(dispatcher, conn):
    """Свежее состояние FSM и своя база на каждый тест."""
    dispatcher.fsm.storage = MemoryStorage()
    dispatcher["conn"] = conn
    return dispatcher


def _user(user_id: int, name: str) -> TgUser:
    return TgUser(id=user_id, is_bot=False, first_name=name, username=f"u{user_id}")


_update_id = 0


def _next_update_id() -> int:
    global _update_id
    _update_id += 1
    return _update_id


async def send(dp, bot, user_id: int, text: str, name: str = "Иван") -> None:
    message = Message(
        message_id=_next_update_id(),
        date=datetime.now(timezone.utc),
        chat=Chat(id=user_id, type="private"),
        from_user=_user(user_id, name),
        text=text,
    )
    await dp.feed_update(bot, Update(update_id=_next_update_id(), message=message))


async def click(dp, bot, user_id: int, data: str, name: str = "Иван") -> None:
    message = Message(
        message_id=_next_update_id(),
        date=datetime.now(timezone.utc),
        chat=Chat(id=user_id, type="private"),
        from_user=_user(42, "Bot"),
        text="—",
    )
    callback = CallbackQuery(
        id=str(_next_update_id()),
        from_user=_user(user_id, name),
        chat_instance="test-instance",
        data=data,
        message=message,
    )
    await dp.feed_update(bot, Update(update_id=_next_update_id(), callback_query=callback))


def find_callback(markups, contains: str) -> str:
    """Находит callback_data кнопки, содержащей нужную подстроку."""
    for markup in reversed(markups):
        for row in getattr(markup, "inline_keyboard", []):
            for button in row:
                if button.callback_data and contains in button.callback_data:
                    return button.callback_data
    raise AssertionError(f"кнопка с '{contains}' не найдена")


# ---------------------------------------------------------------------- тесты


async def test_start_registers_employee(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")

    user = await repo.get_user(conn, EMPLOYEE_ID)
    assert user is not None
    assert user["role"] == "employee"
    assert "Привет" in session.last_text()


async def test_admin_from_env_gets_admin_role(dp, bot, session, conn):
    await send(dp, bot, ADMIN_ID, "/start", name="Босс")

    user = await repo.get_user(conn, ADMIN_ID)
    assert user["role"] == "admin"

    session.clear()
    await send(dp, bot, ADMIN_ID, "/admin", name="Босс")
    assert "Админка" in session.last_text()


async def test_employee_cannot_open_admin_panel(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    session.clear()
    await send(dp, bot, EMPLOYEE_ID, "/admin")

    assert "Админка" not in "".join(session.texts())


async def test_admin_creates_reminder_and_employee_receives_it(dp, bot, session, conn):
    await send(dp, bot, ADMIN_ID, "/start", name="Босс")
    await send(dp, bot, EMPLOYEE_ID, "/start")

    # Мастер создания: название → пояснение → чек-лист → время → дни
    await send(dp, bot, ADMIN_ID, "/admin", name="Босс")
    await click(dp, bot, ADMIN_ID, "nav:admin_new", name="Босс")
    await send(dp, bot, ADMIN_ID, "Открытие смены", name="Босс")
    await send(dp, bot, ADMIN_ID, "-", name="Босс")
    await send(dp, bot, ADMIN_ID, "Включить свет\nПроверить кассу", name="Босс")

    session.clear()
    await click(dp, bot, ADMIN_ID, "nav:items_done", name="Босс")
    await click(dp, bot, ADMIN_ID, "time|09:00", name="Босс")
    await click(dp, bot, ADMIN_ID, "day:save:", name="Босс")

    reminders = await repo.list_reminders(conn, scope="global")
    assert len(reminders) == 1
    assert reminders[0]["title"] == "Открытие смены"
    assert reminders[0]["default_time"] == "09:00"
    assert reminders[0]["is_mandatory"] == 1

    items = await repo.list_checklist(conn, reminders[0]["id"])
    assert [item["text"] for item in items] == ["Включить свет", "Проверить кассу"]

    # Обязательное напоминание автоматически подключено и админу, и сотруднику.
    assert len(await repo.list_subscriptions(conn, EMPLOYEE_ID)) == 1
    assert len(await repo.list_subscriptions(conn, ADMIN_ID)) == 1


async def test_employee_changes_own_time(dp, bot, session, conn):
    await send(dp, bot, ADMIN_ID, "/start", name="Босс")
    await send(dp, bot, EMPLOYEE_ID, "/start")

    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "global", ADMIN_ID, "09:00", "1,2,3,4,5", True
    )
    await repo.subscribe_all_employees(conn, reminder_id, "09:00")

    session.clear()
    await send(dp, bot, EMPLOYEE_ID, "/my")
    open_sub = find_callback(session.markups(), "sub:open")
    await click(dp, bot, EMPLOYEE_ID, open_sub)
    time_button = find_callback(session.markups(), "sub:time")
    await click(dp, bot, EMPLOYEE_ID, time_button)
    await click(dp, bot, EMPLOYEE_ID, "time|14:00")

    subs = await repo.list_subscriptions(conn, EMPLOYEE_ID)
    assert subs[0]["time"] == "14:00", "сотрудник должен сам выбирать время"

    # У другого сотрудника время осталось прежним.
    await send(dp, bot, 200, "/start", name="Мария")
    assert (await repo.list_subscriptions(conn, 200))[0]["time"] == "09:00"


async def test_employee_cannot_pause_mandatory_reminder(dp, bot, session, conn):
    await send(dp, bot, ADMIN_ID, "/start", name="Босс")
    await send(dp, bot, EMPLOYEE_ID, "/start")
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "global", ADMIN_ID, "09:00", "1,2,3,4,5", True
    )
    await repo.subscribe_all_employees(conn, reminder_id, "09:00")
    subs = await repo.list_subscriptions(conn, EMPLOYEE_ID)

    session.clear()
    await click(dp, bot, EMPLOYEE_ID, f"sub:pause:{subs[0]['id']}")

    assert any("обязательное" in alert for alert in session.alerts())
    assert (await repo.list_subscriptions(conn, EMPLOYEE_ID))[0]["is_active"] == 1


async def test_employee_creates_personal_reminder(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")

    await send(dp, bot, EMPLOYEE_ID, "/new")
    await send(dp, bot, EMPLOYEE_ID, "Полить цветы")
    await send(dp, bot, EMPLOYEE_ID, "Каждый вторник")
    await send(dp, bot, EMPLOYEE_ID, "Кабинет\nПриёмная")

    session.clear()
    await click(dp, bot, EMPLOYEE_ID, "nav:items_done")
    await click(dp, bot, EMPLOYEE_ID, "time|10:00")
    await click(dp, bot, EMPLOYEE_ID, "day:preset:2")
    await click(dp, bot, EMPLOYEE_ID, "day:save:")

    personal = await repo.list_reminders(conn, scope="personal", owner_id=EMPLOYEE_ID)
    assert len(personal) == 1
    assert personal[0]["title"] == "Полить цветы"
    assert personal[0]["days"] == "2"

    subs = await repo.list_subscriptions(conn, EMPLOYEE_ID)
    assert subs[0]["time"] == "10:00"


async def test_employee_marks_checklist_and_finishes(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "personal", EMPLOYEE_ID, "09:00", "1,2,3,4,5,6,7", False
    )
    await repo.set_checklist(conn, reminder_id, ["Касса", "Журнал"])
    sub_id = await repo.subscribe(conn, EMPLOYEE_ID, reminder_id, "09:00")
    delivery_id = await repo.create_delivery(
        conn, sub_id, EMPLOYEE_ID, reminder_id, "Обход", "2026-08-27", "09:00"
    )
    await repo.mark_delivery_sent(conn, delivery_id, 555)
    items = await repo.list_delivery_items(conn, delivery_id)

    await click(dp, bot, EMPLOYEE_ID, f"itm:{delivery_id}:{items[0]['id']}")
    assert (await repo.get_delivery(conn, delivery_id))["status"] == "partial"
    assert (await repo.get_delivery(conn, delivery_id))["first_response_at"] is not None

    await click(dp, bot, EMPLOYEE_ID, f"done:all:{delivery_id}")
    await click(dp, bot, EMPLOYEE_ID, f"done:finish:{delivery_id}")

    delivery = await repo.get_delivery(conn, delivery_id)
    assert delivery["status"] == "done"
    assert delivery["completed_at"] is not None


async def test_employee_cannot_touch_someone_elses_delivery(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    await send(dp, bot, 200, "/start", name="Мария")

    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "personal", EMPLOYEE_ID, "09:00", "1,2,3,4,5,6,7", False
    )
    await repo.set_checklist(conn, reminder_id, ["Касса"])
    sub_id = await repo.subscribe(conn, EMPLOYEE_ID, reminder_id, "09:00")
    delivery_id = await repo.create_delivery(
        conn, sub_id, EMPLOYEE_ID, reminder_id, "Обход", "2026-08-27", "09:00"
    )
    items = await repo.list_delivery_items(conn, delivery_id)

    session.clear()
    await click(dp, bot, 200, f"itm:{delivery_id}:{items[0]['id']}", name="Мария")

    assert any("чужое" in alert for alert in session.alerts())
    assert (await repo.list_delivery_items(conn, delivery_id))[0]["is_done"] == 0


async def test_blocked_employee_is_refused(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    await repo.set_user_active(conn, EMPLOYEE_ID, False)

    session.clear()
    await send(dp, bot, EMPLOYEE_ID, "/my")

    assert "отключён" in session.last_text()


async def test_admin_report_command(dp, bot, session, conn):
    await send(dp, bot, ADMIN_ID, "/start", name="Босс")
    session.clear()
    await send(dp, bot, ADMIN_ID, "/report", name="Босс")

    assert "Отчёт за" in session.last_text()


async def _prepare_delivery(conn, title="Обход", items=("Касса", "Журнал")):
    reminder_id = await repo.create_reminder(
        conn, title, None, "personal", EMPLOYEE_ID, "09:00", "1,2,3,4,5,6,7", False
    )
    await repo.set_checklist(conn, reminder_id, list(items))
    sub_id = await repo.subscribe(conn, EMPLOYEE_ID, reminder_id, "09:00")
    delivery_id = await repo.create_delivery(
        conn, sub_id, EMPLOYEE_ID, reminder_id, title, "2026-08-27", "09:00"
    )
    await repo.mark_delivery_sent(conn, delivery_id, 555)
    return delivery_id


async def test_employee_adds_comment_to_reminder(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    delivery_id = await _prepare_delivery(conn)

    session.clear()
    await click(dp, bot, EMPLOYEE_ID, f"done:comment:{delivery_id}")
    assert "Комментарий" in session.last_text()

    await send(dp, bot, EMPLOYEE_ID, "Не завезли товар, перенёс на завтра")

    delivery = await repo.get_delivery(conn, delivery_id)
    assert delivery["comment"] == "Не завезли товар, перенёс на завтра"
    assert "Записал" in session.last_text()


async def test_comment_can_be_edited_and_erased(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    delivery_id = await _prepare_delivery(conn)

    await click(dp, bot, EMPLOYEE_ID, f"done:comment:{delivery_id}")
    await send(dp, bot, EMPLOYEE_ID, "Первая версия")
    assert (await repo.get_delivery(conn, delivery_id))["comment"] == "Первая версия"

    await click(dp, bot, EMPLOYEE_ID, f"done:comment:{delivery_id}")
    await send(dp, bot, EMPLOYEE_ID, "Уточнение: поставщик подвёл")
    assert (await repo.get_delivery(conn, delivery_id))["comment"] == "Уточнение: поставщик подвёл"

    session.clear()
    await click(dp, bot, EMPLOYEE_ID, f"done:comment:{delivery_id}")
    await send(dp, bot, EMPLOYEE_ID, "-")
    assert (await repo.get_delivery(conn, delivery_id))["comment"] is None
    assert "удалён" in session.last_text()


async def test_comment_can_be_added_after_reminder_is_closed(dp, bot, session, conn):
    """Пояснить «почему не сделал» нужно уметь и после закрытия."""
    await send(dp, bot, EMPLOYEE_ID, "/start")
    delivery_id = await _prepare_delivery(conn)
    await click(dp, bot, EMPLOYEE_ID, f"done:finish:{delivery_id}")
    assert (await repo.get_delivery(conn, delivery_id))["completed_at"] is not None

    await click(dp, bot, EMPLOYEE_ID, f"done:comment:{delivery_id}")
    await send(dp, bot, EMPLOYEE_ID, "Журнал заполнил позже")

    assert (await repo.get_delivery(conn, delivery_id))["comment"] == "Журнал заполнил позже"


async def test_skip_asks_for_reason_and_saves_it(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    delivery_id = await _prepare_delivery(conn)

    session.clear()
    await click(dp, bot, EMPLOYEE_ID, f"done:skip:{delivery_id}")
    assert "Напишите причину" in "".join(session.texts())

    await send(dp, bot, EMPLOYEE_ID, "Был на другой точке")

    delivery = await repo.get_delivery(conn, delivery_id)
    assert delivery["status"] == "missed"
    assert delivery["comment"] == "Был на другой точке"


async def test_comment_can_be_declined(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    delivery_id = await _prepare_delivery(conn)

    await click(dp, bot, EMPLOYEE_ID, f"done:skip:{delivery_id}")
    await click(dp, bot, EMPLOYEE_ID, f"done:comment_skip:{delivery_id}")

    assert (await repo.get_delivery(conn, delivery_id))["comment"] is None

    # Состояние сброшено: следующее сообщение снова обычная команда, а не комментарий.
    session.clear()
    await send(dp, bot, EMPLOYEE_ID, "/my")
    assert "Мои напоминания" in session.last_text()


async def test_comment_state_does_not_swallow_cancel(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    delivery_id = await _prepare_delivery(conn)

    await click(dp, bot, EMPLOYEE_ID, f"done:comment:{delivery_id}")
    session.clear()
    await send(dp, bot, EMPLOYEE_ID, "/cancel")

    assert (await repo.get_delivery(conn, delivery_id))["comment"] is None
    assert "не сохранён" in session.last_text()


async def test_cannot_comment_on_someone_elses_reminder(dp, bot, session, conn):
    await send(dp, bot, EMPLOYEE_ID, "/start")
    await send(dp, bot, 200, "/start", name="Мария")
    delivery_id = await _prepare_delivery(conn)

    session.clear()
    await click(dp, bot, 200, f"done:comment:{delivery_id}", name="Мария")

    assert any("чужое" in alert for alert in session.alerts())
    assert (await repo.get_delivery(conn, delivery_id))["comment"] is None
