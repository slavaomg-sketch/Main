"""Конвейер: разбор пачки обращений и массовая отправка."""

import asyncio

import pytest

from dashboard import agent, inbox, pipeline
from dashboard.config import settings
from dashboard.connectors.inbox_base import InboxItem


@pytest.fixture(autouse=True)
def чистый_стол():
    """Пачки живут в памяти процесса — между тестами их быть не должно."""
    pipeline._batches.clear()
    yield
    pipeline._batches.clear()


def запомнить(count: int, kind: str = "chat") -> list[str]:
    items = [
        InboxItem(kind=kind, id=f"i{number}", text=f"Сообщение {number}",
                  account_id="wb1", account_title="ВБ Вячеслав", marketplace="wildberries")
        for number in range(count)
    ]
    inbox.remember(items)
    return [item.id for item in items]


async def дождаться(batch: pipeline.Batch) -> None:
    if batch.task is not None:
        await batch.task


async def test_пачка_разбирается_целиком(monkeypatch):
    ids = запомнить(5)

    async def пишет(item, title, config):
        return agent.Draft(answer=f"Ответ на {item['id']}")

    monkeypatch.setattr(agent, "draft", пишет)
    batch = pipeline.start("wb1", "chat", ids, settings)
    await дождаться(batch)

    assert batch.finished is True
    assert batch.done == 5
    payload = batch.to_dict()
    assert payload["ready"] == 5
    assert payload["human"] == 0
    assert payload["drafts"][0]["answer"].startswith("Ответ на")


async def test_пачка_делит_на_типовые_и_требующие_человека(monkeypatch):
    """Смысл конвейера — разложить на две стопки, а не написать всё подряд."""
    ids = запомнить(4)

    async def пишет(item, title, config):
        трудный = item["id"] in {"i1", "i3"}
        return agent.Draft(
            answer="Разберёмся", needs_human=трудный,
            why="речь о деньгах" if трудный else "",
        )

    monkeypatch.setattr(agent, "draft", пишет)
    batch = pipeline.start("wb1", "chat", ids, settings)
    await дождаться(batch)

    payload = batch.to_dict()
    assert payload["ready"] == 2
    assert payload["human"] == 2
    отмеченные = [draft for draft in payload["drafts"] if draft["needsHuman"]]
    assert all(draft["why"] == "речь о деньгах" for draft in отмеченные)


async def test_сбой_одного_черновика_не_ломает_пачку(monkeypatch):
    ids = запомнить(3)

    async def пишет(item, title, config):
        if item["id"] == "i1":
            raise agent.AgentUnavailable("мост не ответил")
        return agent.Draft(answer="Готово")

    monkeypatch.setattr(agent, "draft", пишет)
    batch = pipeline.start("wb1", "chat", ids, settings)
    await дождаться(batch)

    payload = batch.to_dict()
    assert payload["done"] == 3
    assert payload["failed"] == 1
    assert payload["ready"] == 2
    сломанный = [draft for draft in payload["drafts"] if draft["error"]][0]
    assert сломанный["error"] == "мост не ответил"


async def test_пачка_ограничена_сверху(monkeypatch):
    """Больше тридцати за раз владелец всё равно не просмотрит."""
    ids = запомнить(pipeline.MAX_BATCH + 15)

    async def пишет(item, title, config):
        return agent.Draft(answer="Ответ")

    monkeypatch.setattr(agent, "draft", пишет)
    batch = pipeline.start("wb1", "chat", ids, settings)
    await дождаться(batch)

    assert batch.total == pipeline.MAX_BATCH


async def test_повторный_запуск_возвращает_ту_же_пачку(monkeypatch):
    """Двойное нажатие не должно гонять помощника дважды по одному и тому же."""
    ids = запомнить(3)
    держим = asyncio.Event()

    async def пишет(item, title, config):
        await держим.wait()
        return agent.Draft(answer="Ответ")

    monkeypatch.setattr(agent, "draft", пишет)
    первая = pipeline.start("wb1", "chat", ids, settings)
    вторая = pipeline.start("wb1", "chat", ids, settings)

    assert вторая.id == первая.id
    держим.set()
    await дождаться(первая)


async def test_исчезнувшее_обращение_не_роняет_разбор(monkeypatch):
    ids = запомнить(2)
    ids.append("которого-нет")

    async def пишет(item, title, config):
        return agent.Draft(answer="Ответ")

    monkeypatch.setattr(agent, "draft", пишет)
    batch = pipeline.start("wb1", "chat", ids, settings)
    await дождаться(batch)

    payload = batch.to_dict()
    assert payload["failed"] == 1
    assert payload["ready"] == 2


# --- массовая отправка ----------------------------------------------------------


async def test_отправка_идёт_по_одному_и_помнит_отказы(monkeypatch):
    отправлено: list[tuple[str, str]] = []

    async def отвечает(account, kind, item_id, text, config):
        if item_id == "i1":
            raise RuntimeError("площадка отказала")
        отправлено.append((item_id, text))

    monkeypatch.setattr(inbox, "reply", отвечает)
    result = await pipeline.send_all("wb1", "chat", {
        "i0": "Первый", "i1": "Второй", "i2": "Третий",
    }, settings)

    assert result["sent"] == ["i0", "i2"]
    assert result["failed"] == {"i1": "RuntimeError"}
    assert отправлено == [("i0", "Первый"), ("i2", "Третий")]


async def test_пустой_ответ_не_уходит(monkeypatch):
    """Стёртый черновик — это отказ владельца отправлять, а не пустое письмо."""
    async def отвечает(account, kind, item_id, text, config):
        raise AssertionError("пустой ответ не должен доходить до площадки")

    monkeypatch.setattr(inbox, "reply", отвечает)
    result = await pipeline.send_all("wb1", "chat", {"i0": "   "}, settings)

    assert result["sent"] == []
    assert result["failed"] == {"i0": "пустой ответ"}
