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


@pytest.fixture(autouse=True)
def reset_marketplace_state(monkeypatch):
    """Кэш ответов площадок и ограничитель частоты живут в памяти процесса —
    между тестами их нужно обнулять, иначе тесты влияют друг на друга.
    Паузы между запросами в тестах не нужны: проверяется логика, а не вежливость."""
    from dashboard.connectors import wildberries
    from dashboard.connectors.base import Throttle

    monkeypatch.setattr(wildberries, "STATISTICS_INTERVAL", 0.0)
    monkeypatch.setattr(wildberries, "ANALYTICS_INTERVAL", 0.0)
    monkeypatch.setattr(wildberries, "FINANCE_INTERVAL", 0.0)

    from dashboard.connectors import ozon

    monkeypatch.setattr(ozon, "REQUEST_INTERVAL", 0.0)

    from dashboard.connectors import ozon_inbox, wb_inbox, yandex_inbox

    monkeypatch.setattr(wb_inbox, "INTERVAL", 0.0)
    monkeypatch.setattr(wb_inbox, "CHAT_INTERVAL", 0.0)
    monkeypatch.setattr(ozon_inbox, "INTERVAL", 0.0)
    monkeypatch.setattr(yandex_inbox, "INTERVAL", 0.0)
    wildberries.reset_cache()
    Throttle._locks.clear()
    Throttle._next_allowed.clear()
    yield
    wildberries.reset_cache()
    Throttle._locks.clear()
    Throttle._next_allowed.clear()


@pytest.fixture
def dashboard_db(tmp_path):
    """Панель пишет раскладки во временную базу — настройки заморожены,
    поэтому подменяем поле напрямую и возвращаем прежнее значение после теста."""
    from dashboard.config import settings as dashboard_settings

    path = tmp_path / "dashboard.db"
    original = dashboard_settings.db_path
    object.__setattr__(dashboard_settings, "db_path", path)
    yield path
    object.__setattr__(dashboard_settings, "db_path", original)
