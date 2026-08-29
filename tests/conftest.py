"""Общие фикстуры: временная база и тестовая конфигурация."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bot import db  # noqa: E402
from bot.config import Config  # noqa: E402


@pytest_asyncio.fixture
async def conn(tmp_path):
    connection = await db.connect(tmp_path / "test.db")
    yield connection
    await connection.close()


@pytest.fixture(scope="session")
def hub_dispatcher():
    """Роутеры веток — объекты уровня модуля, поэтому диспетчер один на всю сессию.

    Зависимости в него кладут сами тесты: см. фикстуру `dp` в тестах хаба и веток.
    """
    from hub.main import build_dispatcher  # noqa: PLC0415 - тяжёлый импорт только для этих тестов

    return build_dispatcher(config=None)


@pytest.fixture
def config(tmp_path) -> Config:
    return Config(
        bot_token="test:token",
        admin_ids=[1],
        db_path=tmp_path / "test.db",
        default_tz="UTC",
        report_time="20:00",
        nudge_after_minutes=60,
        catchup_minutes=15,
    )


class FakeMessage:
    def __init__(self, message_id: int) -> None:
        self.message_id = message_id


class FakeBot:
    """Заглушка Telegram: запоминает отправленные сообщения."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self._counter = 0

    async def send_message(self, chat_id, text, **kwargs):
        self._counter += 1
        self.sent.append({"chat_id": chat_id, "text": text, **kwargs})
        return FakeMessage(self._counter)


@pytest.fixture
def fake_bot() -> FakeBot:
    return FakeBot()
