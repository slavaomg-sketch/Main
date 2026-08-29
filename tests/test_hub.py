"""Хаб: меню веток, переключение, маршрутизация сообщений между ветками.

Ветки здесь ненастоящие — две заглушки. Так проверяется именно каркас:
что сообщение достаётся открытой ветке, что узнаваемый текст сам открывает
нужную, и что диалог одной ветки нельзя перебить другой.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
import pytest_asyncio
from aiogram import Bot, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import AnswerCallbackQuery, EditMessageText, GetMe, SendMessage, TelegramMethod
from aiogram.types import BotCommand, CallbackQuery, Chat, Message, Update
from aiogram.types import User as TgUser

from hub.callbacks import AgentCb
from hub.config import HubConfig
from hub.main import build_dispatcher, commands_for
from hub.registry import Agent, find
from hub.state import HubState

ME = 700
STRANGER = 701


# ------------------------------------------------------------------ подставные ветки


class Ask(StatesGroup):
    answer = State()


def build_notes_router() -> Router:
    router = Router(name="test-notes")

    @router.message(Command("note"))
    async def cmd_note(message: Message) -> None:
        await message.answer("заметка: команда")

    @router.message(Ask.answer, F.text)
    async def got_answer(message: Message, state: FSMContext) -> None:
        await state.clear()
        await message.answer(f"заметка: записал «{message.text}»")

    @router.message(F.text == "спроси")
    async def ask(message: Message, state: FSMContext) -> None:
        await state.set_state(Ask.answer)
        await message.answer("заметка: что записать?")

    @router.message(F.text)
    async def any_text(message: Message) -> None:
        await message.answer(f"заметка: {message.text}")

    return router


def build_weather_router() -> Router:
    router = Router(name="test-weather")

    @router.message(F.text)
    async def any_text(message: Message) -> None:
        await message.answer(f"погода: {message.text}")

    return router


class FakeBackground:
    def __init__(self) -> None:
        self.started = False
        self.stopped = False

    def start(self) -> None:
        self.started = True

    async def shutdown(self) -> None:
        self.stopped = True


@pytest.fixture(scope="session")
def agents() -> list[Agent]:
    return [
        Agent(
            slug="notes",
            title="📝 Заметки",
            summary="записываю, что попросите",
            greeting="Пришлите текст — запишу.",
            router=build_notes_router(),
            commands=[BotCommand(command="note", description="Заметка")],
        ),
        Agent(
            slug="weather",
            title="🌦 Погода",
            summary="рассказываю про погоду",
            greeting="Назовите город.",
            router=build_weather_router(),
            # Узнаёт свои сообщения по слову «погода» — как такси узнаёт ссылку.
            claims=lambda text: "погода" in text.lower(),
        ),
    ]


# ------------------------------------------------------------------------ фикстуры


class MockSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod] = []
        self._message_id = 2000

    async def close(self) -> None:  # pragma: no cover
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover
        yield b""

    async def make_request(self, bot: Bot, method: TelegramMethod, timeout: int | None = None):
        self.calls.append(method)
        if isinstance(method, GetMe):
            return TgUser(id=42, is_bot=True, first_name="Bot", username="hub_bot")
        if isinstance(method, (SendMessage, EditMessageText)):
            self._message_id += 1
            return Message(
                message_id=self._message_id,
                date=datetime.now(timezone.utc),
                chat=Chat(id=getattr(method, "chat_id", ME) or ME, type="private"),
                text=method.text,
            )
        return True

    def texts(self) -> list[str]:
        return [
            call.text
            for call in self.calls
            if isinstance(call, (SendMessage, EditMessageText)) and call.text
        ]

    def last_text(self) -> str:
        assert self.texts(), "бот ничего не ответил"
        return self.texts()[-1]

    def alerts(self) -> list[str]:
        return [
            call.text for call in self.calls if isinstance(call, AnswerCallbackQuery) and call.text
        ]

    def markups(self) -> list[Any]:
        return [
            call.reply_markup
            for call in self.calls
            if isinstance(call, (SendMessage, EditMessageText)) and call.reply_markup
        ]

    def clear(self) -> None:
        self.calls.clear()


def make_config(tmp_path, **overrides) -> HubConfig:
    params = {
        "token": "42:HUB",
        "state_path": tmp_path / "hub.json",
        "allowed_ids": [],
        "tz": "Europe/Moscow",
    }
    params.update(overrides)
    return HubConfig(**params)


@pytest.fixture(scope="session")
def two_agent_dispatcher(agents):
    """Свой диспетчер: роутеры подставных веток к общему подключать нельзя."""
    return build_dispatcher(config=None, agents=agents)


@pytest.fixture
def state(tmp_path) -> HubState:
    return HubState(tmp_path / "hub.json")


@pytest.fixture
def dp(two_agent_dispatcher, agents, state, tmp_path):
    two_agent_dispatcher.fsm.storage = MemoryStorage()
    two_agent_dispatcher["hub_config"] = make_config(tmp_path)
    two_agent_dispatcher["hub_state"] = state
    two_agent_dispatcher["agents"] = agents
    return two_agent_dispatcher


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


_update_id = 0


def _next_id() -> int:
    global _update_id
    _update_id += 1
    return _update_id


def _user(user_id: int) -> TgUser:
    return TgUser(id=user_id, is_bot=False, first_name="Слава", username=f"u{user_id}")


async def send(dp, bot, text: str, user_id: int = ME) -> None:
    message = Message(
        message_id=_next_id(),
        date=datetime.now(timezone.utc),
        chat=Chat(id=user_id, type="private"),
        from_user=_user(user_id),
        text=text,
    )
    await dp.feed_update(bot, Update(update_id=_next_id(), message=message))


async def click(dp, bot, data: str, user_id: int = ME) -> None:
    message = Message(
        message_id=_next_id(),
        date=datetime.now(timezone.utc),
        chat=Chat(id=user_id, type="private"),
        from_user=_user(42),
        text="—",
    )
    callback = CallbackQuery(
        id=str(_next_id()),
        from_user=_user(user_id),
        chat_instance="test-instance",
        data=data,
        message=message,
    )
    await dp.feed_update(bot, Update(update_id=_next_id(), callback_query=callback))


def buttons(session: MockSession) -> list[str]:
    return [
        item.text
        for markup in session.markups()
        for row in getattr(markup, "inline_keyboard", [])
        for item in row
    ]


# ------------------------------------------------------------------- меню и выбор


async def test_start_lists_all_agents(dp, bot, session):
    await send(dp, bot, "/start")

    text = session.texts()[0]
    assert "📝 Заметки" in text and "🌦 Погода" in text
    assert "записываю, что попросите" in text
    assert buttons(session) == ["📝 Заметки", "🌦 Погода"]


async def test_picking_agent_greets_and_remembers(dp, bot, session, state):
    await click(dp, bot, AgentCb(slug="notes").pack())

    assert "Пришлите текст — запишу." in session.last_text()
    assert "📝 Заметки" in session.alerts()
    assert state.agent_for(ME) == "notes"


async def test_menu_marks_active_agent(dp, bot, session):
    await click(dp, bot, AgentCb(slug="weather").pack())
    session.clear()

    await send(dp, bot, "/menu")

    assert "🌦 Погода" in session.last_text()
    assert "✅ 🌦 Погода" in buttons(session)


async def test_unknown_agent_is_reported(dp, bot, session):
    await click(dp, bot, AgentCb(slug="нет-такой").pack())
    assert "больше нет" in " ".join(session.alerts())


async def test_help_shows_open_agent(dp, bot, session):
    await click(dp, bot, AgentCb(slug="notes").pack())
    session.clear()

    await send(dp, bot, "/help")
    assert "Пришлите текст — запишу." in session.last_text()


# ---------------------------------------------------------------- маршрутизация


async def test_text_goes_to_the_open_agent_only(dp, bot, session):
    await click(dp, bot, AgentCb(slug="notes").pack())
    session.clear()

    await send(dp, bot, "купить хлеб")
    assert session.last_text() == "заметка: купить хлеб"

    await click(dp, bot, AgentCb(slug="weather").pack())
    session.clear()
    await send(dp, bot, "Москва")
    assert session.last_text() == "погода: Москва"


async def test_agent_command_works_only_in_its_branch(dp, bot, session):
    await click(dp, bot, AgentCb(slug="weather").pack())
    session.clear()

    await send(dp, bot, "/note")
    assert "заметка: команда" not in session.texts()

    await click(dp, bot, AgentCb(slug="notes").pack())
    session.clear()
    await send(dp, bot, "/note")
    assert session.last_text() == "заметка: команда"


async def test_recognized_text_opens_its_branch_itself(dp, bot, session, state):
    await click(dp, bot, AgentCb(slug="notes").pack())
    session.clear()

    await send(dp, bot, "какая погода в Казани?")

    assert session.last_text() == "погода: какая погода в Казани?"
    assert state.agent_for(ME) == "weather", "ветка переключилась сама"


async def test_dialog_of_one_branch_is_not_hijacked(dp, bot, session, state):
    """На середине вопроса «что записать?» ответ про погоду — это ответ, а не переключение."""
    await click(dp, bot, AgentCb(slug="notes").pack())
    session.clear()

    await send(dp, bot, "спроси")
    assert "что записать?" in session.last_text()

    await send(dp, bot, "погода была хорошая")

    assert session.last_text() == "заметка: записал «погода была хорошая»"
    assert state.agent_for(ME) == "notes"


async def test_commands_are_not_stolen_by_claims(dp, bot, session, state):
    await click(dp, bot, AgentCb(slug="notes").pack())
    session.clear()

    await send(dp, bot, "/note погода")

    assert session.last_text() == "заметка: команда"
    assert state.agent_for(ME) == "notes"


async def test_without_a_chosen_branch_hub_offers_the_menu(dp, bot, session):
    await send(dp, bot, "просто текст")

    assert "Не понял, к какой ветке" in session.last_text()
    assert buttons(session) == ["📝 Заметки", "🌦 Погода"]


async def test_branches_are_independent_per_chat(dp, bot, session, state):
    await click(dp, bot, AgentCb(slug="notes").pack(), user_id=ME)
    await click(dp, bot, AgentCb(slug="weather").pack(), user_id=STRANGER)

    session.clear()
    await send(dp, bot, "привет", user_id=ME)
    assert session.last_text() == "заметка: привет"

    session.clear()
    await send(dp, bot, "привет", user_id=STRANGER)
    assert session.last_text() == "погода: привет"


async def test_single_branch_opens_without_asking(two_agent_dispatcher, agents, bot, session, tmp_path):
    """Когда ветка одна, выбирать нечего — она активна сразу."""
    only = [agents[0]]
    two_agent_dispatcher["agents"] = only
    two_agent_dispatcher["hub_state"] = HubState(tmp_path / "single.json")
    two_agent_dispatcher.fsm.storage = MemoryStorage()

    await send(two_agent_dispatcher, bot, "привет")
    assert session.last_text() == "заметка: привет"

    two_agent_dispatcher["agents"] = agents


# --------------------------------------------------------------------- доступ


async def test_private_hub_ignores_strangers(dp, bot, session, tmp_path):
    dp["hub_config"] = make_config(tmp_path, allowed_ids=[ME])

    await send(dp, bot, "/start", user_id=STRANGER)
    assert "личный" in session.last_text()

    session.clear()
    await send(dp, bot, "/start", user_id=ME)
    assert "бот-хаб" in session.last_text().lower()


async def test_open_hub_allows_everyone(tmp_path):
    assert make_config(tmp_path).is_allowed(12345)


# ------------------------------------------------------------------- состояние


def test_hub_state_survives_restart(tmp_path):
    path = tmp_path / "hub.json"
    HubState(path).set_agent(ME, "notes")

    assert HubState(path).agent_for(ME) == "notes"

    HubState(path).clear(ME)
    assert HubState(path).agent_for(ME) is None


def test_hub_state_survives_broken_file(tmp_path):
    path = tmp_path / "hub.json"
    path.write_text("{ не json", encoding="utf-8")
    assert HubState(path).agent_for(ME) is None


# ------------------------------------------------------------------- настройки


def test_commands_merge_hub_and_agents(agents):
    commands = [command.command for command in commands_for(agents)]
    assert commands[:4] == ["start", "menu", "help", "cancel"]
    assert "note" in commands
    assert len(commands) == len(set(commands)), "дублей быть не должно"


def test_config_requires_its_own_token(monkeypatch):
    monkeypatch.delenv("HUB_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TRACKER_BOT_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="HUB_BOT_TOKEN"):
        HubConfig.from_env()


def test_config_rejects_token_shared_with_reminder_bot(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", "42:SAME")
    monkeypatch.setenv("HUB_BOT_TOKEN", "42:SAME")
    with pytest.raises(RuntimeError, match="отдельный бот"):
        HubConfig.from_env()


def test_config_accepts_old_variable_names(monkeypatch):
    """Кто уже прописал TRACKER_BOT_TOKEN — переименовывать ничего не нужно."""
    monkeypatch.delenv("HUB_BOT_TOKEN", raising=False)
    monkeypatch.delenv("HUB_ALLOWED_IDS", raising=False)
    monkeypatch.setenv("BOT_TOKEN", "1:OTHER")
    monkeypatch.setenv("TRACKER_BOT_TOKEN", "42:HUB")
    monkeypatch.setenv("TRACKER_ALLOWED_IDS", "500, 600")

    config = HubConfig.from_env()

    assert config.token == "42:HUB"
    assert config.allowed_ids == [500, 600]
    assert config.is_allowed(500) and not config.is_allowed(1)


def test_config_rejects_broken_whitelist(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", "1:OTHER")
    monkeypatch.setenv("HUB_BOT_TOKEN", "42:HUB")
    monkeypatch.setenv("HUB_ALLOWED_IDS", "я")
    with pytest.raises(RuntimeError, match="не является числом"):
        HubConfig.from_env()


# -------------------------------------------------------------------- реестр


def test_find_agent(agents):
    assert find(agents, "notes").title == "📝 Заметки"
    assert find(agents, "нет") is None
    assert find([], None) is None


def test_broken_claims_does_not_break_the_hub(agents):
    def explode(text: str) -> bool:
        raise ValueError("сломался")

    agent = Agent(
        slug="x", title="X", summary="", greeting="", router=Router(), claims=explode
    )
    assert agent.owns("что угодно") is False


def test_agent_without_claims_owns_nothing(agents):
    assert agents[0].owns("любой текст") is False


def test_background_tasks_start_and_stop(agents, bot, tmp_path):
    from hub.main import start_background

    task = FakeBackground()
    with_background = [
        Agent(
            slug="bg",
            title="BG",
            summary="",
            greeting="",
            router=Router(),
            background=lambda _bot, _data: task,
        )
    ]
    dispatcher = build_dispatcher(config=None, agents=with_background)

    started = start_background(bot, dispatcher, with_background)

    assert task.started and started == [task]
