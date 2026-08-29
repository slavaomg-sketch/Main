"""Сквозные проверки бота-трекера: настоящие роутеры, подставные Telegram и Яндекс."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramForbiddenError
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.methods import (
    AnswerCallbackQuery,
    EditMessageText,
    GetMe,
    SendMessage,
    TelegramMethod,
)
from aiogram.types import CallbackQuery, Chat, Message, Update
from aiogram.types import User as TgUser

from tracker.models import ARRIVED, FINISHED, IN_PROGRESS, TripState
from tracker.providers import TrackerError
from tracker.store import TripStore
from trackerbot.callbacks import AlertCb, TripCb
from trackerbot.config import BotConfig
from trackerbot.main import build_dispatcher
from trackerbot.poller import TripPoller

KEY = "e90be707-1875-4406-b66a-4a6fc1e6955e"
OTHER_KEY = "11111111-2222-3333-4444-555555555555"
URL = f"https://dostavka.yandex.ru/route/{KEY}"
ME = 500
STRANGER = 999


# --------------------------------------------------------------- подставные сервисы


class MockSession(BaseSession):
    """Ловит вызовы Telegram API и возвращает правдоподобные ответы."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod] = []
        self.raise_forbidden = False
        self._message_id = 1000

    async def close(self) -> None:  # pragma: no cover - ничего не держим
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # pragma: no cover
        yield b""

    async def make_request(self, bot: Bot, method: TelegramMethod, timeout: int | None = None):
        if self.raise_forbidden and isinstance(method, SendMessage):
            raise TelegramForbiddenError(method=method, message="bot was blocked by the user")

        self.calls.append(method)
        if isinstance(method, GetMe):
            return TgUser(id=42, is_bot=True, first_name="Bot", username="tracker_bot")
        if isinstance(method, (SendMessage, EditMessageText)):
            self._message_id += 1
            return Message(
                message_id=self._message_id,
                date=datetime.now(timezone.utc),
                chat=Chat(id=getattr(method, "chat_id", ME) or ME, type="private"),
                text=method.text,
            )
        return True

    def sent(self) -> list[str]:
        return [call.text for call in self.calls if isinstance(call, SendMessage)]

    def edits(self) -> list[str]:
        return [call.text for call in self.calls if isinstance(call, EditMessageText)]

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


class FakeProvider:
    """Подставной Яндекс: отдаёт заданное состояние, в сеть не ходит."""

    def __init__(self, minutes: float | None = 20, status: str = IN_PROGRESS) -> None:
        self.set(minutes, status)
        self.error: TrackerError | None = None
        self.calls = 0

    def set(self, minutes: float | None, status: str = IN_PROGRESS) -> None:
        self.minutes = minutes
        self.status = status

    def _summary(self) -> str:
        if self.status == FINISHED:
            return "Заказ доставлен"
        if self.status == ARRIVED:
            return "Курьер на месте"
        return f"Курьер едет к получателю: ~{self.minutes} мин"

    def fetch(self, key: str) -> TripState:
        self.calls += 1
        if self.error:
            raise self.error
        return TripState(
            key=key,
            status=self.status,
            summary=self._summary(),
            eta_minutes=self.minutes,
            destination="Сколковская улица, 7Б",
            performer="Мария",
            vehicle="LADA Granta А123ВС777",
        )


# ------------------------------------------------------------------------ фикстуры


def make_config(tmp_path, **overrides) -> BotConfig:
    params = {
        "token": "42:TRACKER",
        "state_path": tmp_path / "trips.json",
        "default_alerts": [5],
        "allowed_ids": [],
        "poll_seconds": 10.0,
        "tz": "Europe/Moscow",
    }
    params.update(overrides)
    return BotConfig(**params)


@pytest.fixture
def config(tmp_path) -> BotConfig:
    return make_config(tmp_path)


@pytest.fixture
def store(config) -> TripStore:
    return TripStore(config.state_path)


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture(scope="session")
def dispatcher():
    """Роутер — объект уровня модуля, поэтому диспетчер собирается один раз."""
    return build_dispatcher(store=None, config=None)


@pytest.fixture
def dp(dispatcher, store, config, provider):
    """Свежее состояние FSM и свои зависимости на каждый тест."""
    dispatcher.fsm.storage = MemoryStorage()
    dispatcher["store"] = store
    dispatcher["config"] = config
    dispatcher["provider"] = provider
    return dispatcher


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


# --------------------------------------------------------------------------- тесты


async def test_start_explains_what_to_send(dp, bot, session):
    await send(dp, bot, "/start")
    assert "ссылку отслеживания" in session.last_text()


async def test_link_starts_tracking_and_shows_card(dp, bot, session, store):
    await send(dp, bot, URL)

    trips = store.load()
    assert len(trips) == 1
    assert trips[0].key == KEY
    assert trips[0].chat_id == ME
    assert trips[0].alerts == [5]

    card = session.last_text()
    assert "Курьер едет к получателю" in card
    assert "Сколковская улица, 7Б" in card
    assert "Напомню за: 5 мин" in card


async def test_card_shows_arrival_in_configured_timezone(dp, bot, session, store, provider):
    provider.set(60)
    await send(dp, bot, URL)

    moscow_hour = (datetime.now(timezone.utc) + timedelta(minutes=60)).astimezone(
        timezone(timedelta(hours=3))
    )
    assert f"Прибытие ~{moscow_hour:%H:%M}" in session.last_text()


async def test_link_inside_a_longer_message_is_found(dp, bot, store):
    await send(dp, bot, f"Привет! Вот моя доставка: {URL} — встретишь?")
    assert len(store.load()) == 1


async def test_two_links_in_one_message(dp, bot, store):
    await send(dp, bot, f"{URL}\nhttps://dostavka.yandex.ru/route/{OTHER_KEY}")
    assert sorted(trip.key for trip in store.load()) == sorted([KEY, OTHER_KEY])


async def test_message_without_link_gets_a_hint(dp, bot, session, store):
    await send(dp, bot, "привет, а где мой заказ?")
    assert "Не вижу ссылки" in session.last_text()
    assert store.load() == []


async def test_unreachable_yandex_still_shows_card(dp, bot, session, store, provider):
    provider.error = TrackerError("ссылка устарела")
    await send(dp, bot, URL)

    assert "ссылка устарела" in session.last_text()
    assert store.load(), "поездка сохраняется — Яндекс мог ответить разово"


async def test_card_keyboard_marks_chosen_intervals(dp, bot, session, store):
    await send(dp, bot, URL)

    labels = [
        item.text
        for markup in session.markups()
        for row in markup.inline_keyboard
        for item in row
    ]
    assert "✅ 5 мин" in labels, "выбранный интервал отмечен галочкой"
    assert "15 мин" in labels, "остальные интервалы предлагаются кнопками"
    assert "⏱ Свой интервал" in labels and "⏹ Не следить" in labels


async def test_interval_button_toggles_and_is_remembered(dp, bot, session, store):
    await send(dp, bot, URL)
    session.clear()

    await click(dp, bot, _alert_button(store, 15))

    trip = store.load()[0]
    assert 15 in trip.alerts
    assert store.chat_alerts(ME) == trip.alerts
    assert "Напомню за 15 мин" in session.alerts()
    assert "Напомню за: 15 мин, 5 мин" in session.last_text()


async def test_interval_button_switches_off(dp, bot, session, store):
    await send(dp, bot, URL)
    await click(dp, bot, _alert_button(store, 5))

    assert store.load()[0].alerts == []
    assert "Убрал напоминание за 5 мин" in session.alerts()


async def test_next_link_reuses_remembered_intervals(dp, bot, store):
    await send(dp, bot, URL)
    await click(dp, bot, _alert_button(store, 30))
    store.remove(KEY)

    await send(dp, bot, URL)
    assert store.load()[0].alerts == [30, 5]


async def test_turning_on_a_passed_threshold_does_not_fire_retroactively(dp, bot, session, store, provider):
    provider.set(3)
    await send(dp, bot, URL)
    # Порог 5 минут уже сработал при первом же опросе поллера — эмулируем это.
    trip = store.load()[0]
    trip.scheduled_arrival = datetime.now(timezone.utc) + timedelta(minutes=3)
    store.update(trip)

    await click(dp, bot, _alert_button(store, 15))

    trip = store.load()[0]
    assert 15 in trip.alerts and 15 in trip.fired
    assert "уже поздно" in " ".join(session.alerts())


async def test_custom_interval_flow(dp, bot, session, store):
    await send(dp, bot, URL)
    await click(dp, bot, _trip_button(store, "custom"))
    assert "Пришлите число" in session.last_text()

    await send(dp, bot, "7")
    assert 7 in store.load()[0].alerts
    assert "Напомню за 7 мин" in session.last_text()


async def test_custom_interval_rejects_nonsense(dp, bot, session, store):
    await send(dp, bot, URL)
    await click(dp, bot, _trip_button(store, "custom"))

    await send(dp, bot, "через полчасика")
    assert "Нужно число минут" in session.last_text()
    assert store.load()[0].alerts == [5]

    # Состояние не сбросилось — можно ответить правильно.
    await send(dp, bot, "12")
    assert 12 in store.load()[0].alerts


async def test_stop_button_removes_trip(dp, bot, session, store):
    await send(dp, bot, URL)
    await click(dp, bot, _trip_button(store, "stop"))

    assert store.load() == []
    assert "Больше не слежу" in session.last_text()


async def test_list_shows_tracked_trips(dp, bot, session, store):
    await send(dp, bot, "/list")
    assert "ни за чем не слежу" in session.last_text()

    await send(dp, bot, URL)
    session.clear()
    await send(dp, bot, "/list")
    assert "Курьер едет к получателю" in session.last_text()


async def test_list_shows_only_own_trips(dp, bot, session, store):
    await send(dp, bot, URL, user_id=ME)
    session.clear()
    await send(dp, bot, "/list", user_id=STRANGER)
    assert "ни за чем не слежу" in session.last_text()


async def test_private_bot_ignores_strangers(dp, bot, session, store, tmp_path):
    dp["config"] = make_config(tmp_path, allowed_ids=[ME])

    await send(dp, bot, URL, user_id=STRANGER)
    assert "личный" in session.last_text()
    assert store.load() == []

    session.clear()
    await send(dp, bot, URL, user_id=ME)
    assert store.load(), "своего бот пускает"


# ------------------------------------------------------------------------- поллер


def poller(bot, store, config, provider) -> TripPoller:
    return TripPoller(bot, store, config, provider=provider, sleep=lambda _: None)


async def test_poller_sends_alert_once(dp, bot, session, store, config, provider):
    await send(dp, bot, URL)
    session.clear()

    provider.set(4)
    watcher = poller(bot, store, config, provider)
    await watcher.tick()

    assert any("курьер через" in text for text in session.sent())
    assert store.load()[0].fired == [5]

    session.clear()
    await watcher.tick()
    assert not [text for text in session.sent() if "курьер через" in text]


async def test_poller_updates_card_without_new_messages(dp, bot, session, store, config, provider):
    await send(dp, bot, URL)
    session.clear()

    provider.set(12)
    await poller(bot, store, config, provider).tick()

    assert session.edits(), "карточка должна обновиться"
    assert session.sent() == [], "лишних сообщений быть не должно"


async def test_poller_announces_arrival_and_finish(dp, bot, session, store, config, provider):
    await send(dp, bot, URL)
    watcher = poller(bot, store, config, provider)

    session.clear()
    provider.set(None, ARRIVED)
    await watcher.tick()
    assert any("курьер на месте" in text.lower() for text in session.sent())

    session.clear()
    provider.set(None, FINISHED)
    await watcher.tick()
    assert any("завершён" in text for text in session.sent())
    assert store.load()[0].done is True
    assert store.active() == []


async def test_finished_card_loses_buttons_and_promises(dp, bot, session, store, config, provider):
    await send(dp, bot, URL)
    session.clear()

    provider.set(None, FINISHED)
    await poller(bot, store, config, provider).tick()

    edits = [call for call in session.calls if isinstance(call, EditMessageText)]
    assert edits and edits[-1].reply_markup is None
    assert "Напомню за" not in edits[-1].text, "завершённому заказу напоминания не обещаем"


async def test_poller_keeps_trip_after_network_error(dp, bot, session, store, config, provider):
    await send(dp, bot, URL)
    session.clear()

    provider.error = TrackerError("нет связи")
    delay = await poller(bot, store, config, provider).tick()

    assert delay > 0
    assert store.active(), "сетевой сбой не должен снимать поездку"
    assert session.sent() == []


async def test_poller_stops_tracking_when_bot_is_blocked(dp, bot, session, store, config, provider):
    await send(dp, bot, URL)
    provider.set(4)
    session.raise_forbidden = True

    await poller(bot, store, config, provider).tick()

    assert store.active() == [], "заблокировавшему бота больше не пишем"


async def test_poller_serves_two_chats_independently(dp, bot, session, store, config, provider):
    await send(dp, bot, URL, user_id=ME)
    await send(dp, bot, URL, user_id=STRANGER)
    assert len(store.load()) == 2

    session.clear()
    provider.set(4)
    await poller(bot, store, config, provider).tick()

    chats = {
        call.chat_id
        for call in session.calls
        if isinstance(call, SendMessage) and "курьер через" in (call.text or "")
    }
    assert chats == {ME, STRANGER}


async def test_poller_idles_without_trips(bot, store, config, provider):
    assert await poller(bot, store, config, provider).tick() >= 30


# ------------------------------------------------------------------- настройки


def test_config_requires_its_own_token(monkeypatch):
    monkeypatch.delenv("TRACKER_BOT_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="TRACKER_BOT_TOKEN"):
        BotConfig.from_env()


def test_config_rejects_token_shared_with_reminder_bot(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", "42:SAME")
    monkeypatch.setenv("TRACKER_BOT_TOKEN", "42:SAME")
    with pytest.raises(RuntimeError, match="отдельный бот"):
        BotConfig.from_env()


def test_config_reads_alerts_and_whitelist(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", "1:OTHER")
    monkeypatch.setenv("TRACKER_BOT_TOKEN", "42:TRACKER")
    monkeypatch.setenv("TRACKER_ALERTS", "5,15")
    monkeypatch.setenv("TRACKER_ALLOWED_IDS", "500, 600")

    config = BotConfig.from_env()

    assert config.default_alerts == [15, 5]
    assert config.allowed_ids == [500, 600]
    assert config.is_allowed(500) and not config.is_allowed(1)


def test_open_bot_allows_everyone(tmp_path):
    assert make_config(tmp_path).is_allowed(12345)


# ------------------------------------------------------------------ помощники


def _alert_button(store: TripStore, minutes: int) -> str:
    return AlertCb(trip_id=store.load()[0].id, minutes=minutes).pack()


def _trip_button(store: TripStore, action: str) -> str:
    return TripCb(action=action, trip_id=store.load()[0].id).pack()
