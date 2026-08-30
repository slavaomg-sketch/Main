"""Конвейер черновиков: разобрать пачку обращений разом.

Отвечать по одному там, где висит тысяча сообщений, — работа на несколько
дней. Поэтому панель умеет запустить помощника сразу на пачку: он пишет
черновики в фоне, а владелец потом просматривает готовый список и решает,
что отправлять.

Ничего не уходит покупателям само. Конвейер только готовит тексты и
раскладывает их на две стопки: «выглядит типовым» и «тут нужен человек».
Отправку по-прежнему запускает человек, отдельным действием.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from . import agent, inbox, knowledge
from .config import Settings, settings

# Сколько черновиков просим одновременно. Мост на сервере разбирает их
# в несколько рук, но заваливать его сотней сразу незачем.
LANES = 3

# Сколько обращений берём в одну пачку. Больше — и владелец не осилит
# просмотреть результат за один присест.
MAX_BATCH = 30

# Сколько держим разобранную пачку. Панель забирает её сразу, остальное —
# память впустую.
KEEP = timedelta(hours=2)


@dataclass
class Draft:
    """Черновик одного обращения внутри пачки."""

    item_id: str
    answer: str = ""
    needs_human: bool = False
    why: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.item_id,
            "answer": self.answer,
            "needsHuman": self.needs_human,
            "why": self.why,
            "error": self.error,
        }


@dataclass
class Batch:
    """Одна пачка: что разбираем, сколько готово и что получилось."""

    id: str
    account_id: str
    kind: str
    total: int
    started: datetime = field(default_factory=datetime.now)
    drafts: dict[str, Draft] = field(default_factory=dict)
    finished: bool = False
    task: asyncio.Task | None = None

    @property
    def done(self) -> int:
        return len(self.drafts)

    def to_dict(self) -> dict[str, Any]:
        drafts = list(self.drafts.values())
        return {
            "id": self.id,
            "accountId": self.account_id,
            "kind": self.kind,
            "total": self.total,
            "done": self.done,
            "finished": self.finished,
            # Сразу считаем, сколько из готового можно отправлять не глядя,
            # а сколько ждёт человека — это и есть смысл конвейера.
            "ready": sum(1 for draft in drafts if draft.answer and not draft.needs_human),
            "human": sum(1 for draft in drafts if draft.needs_human),
            "failed": sum(1 for draft in drafts if draft.error),
            "drafts": [draft.to_dict() for draft in drafts],
        }


_batches: dict[str, Batch] = {}


def _forget_old() -> None:
    edge = datetime.now() - KEEP
    for key in [key for key, batch in _batches.items()
                if batch.finished and batch.started < edge]:
        _batches.pop(key, None)


def get(batch_id: str) -> Batch | None:
    return _batches.get(batch_id)


def running_for(account_id: str, kind: str) -> Batch | None:
    """Незаконченная пачка по этой главе, если она есть."""
    for batch in _batches.values():
        if not batch.finished and batch.account_id == account_id and batch.kind == kind:
            return batch
    return None


async def _one(batch: Batch, item_id: str, config: Settings) -> None:
    item = inbox.find(batch.account_id, batch.kind, item_id)
    if item is None:
        batch.drafts[item_id] = Draft(item_id, error="обращение больше не найдено")
        return

    facts = await knowledge.for_article(item.article)

    try:
        written = await agent.draft(item.to_dict(), item.account_title, config, facts)
    except agent.AgentUnavailable as exc:
        batch.drafts[item_id] = Draft(item_id, error=str(exc))
        return

    batch.drafts[item_id] = Draft(
        item_id,
        answer=written.answer,
        needs_human=written.needs_human,
        why=written.why,
    )


async def _run(batch: Batch, item_ids: list[str], config: Settings) -> None:
    lane = asyncio.Semaphore(LANES)

    async def guarded(item_id: str) -> None:
        async with lane:
            await _one(batch, item_id, config)

    try:
        await asyncio.gather(*(guarded(item_id) for item_id in item_ids))
    finally:
        batch.finished = True


def start(
    account_id: str, kind: str, item_ids: list[str], config: Settings | None = None
) -> Batch:
    """Запустить разбор пачки. Возвращает управление сразу."""
    config = config or settings
    _forget_old()

    running = running_for(account_id, kind)
    if running is not None:
        return running

    picked = [str(item_id) for item_id in item_ids][:MAX_BATCH]
    batch = Batch(id=uuid.uuid4().hex, account_id=account_id, kind=kind, total=len(picked))
    _batches[batch.id] = batch

    if not picked:
        batch.finished = True
        return batch

    batch.task = asyncio.create_task(_run(batch, picked, config))
    return batch


async def send_all(
    account_id: str, kind: str, answers: dict[str, str], config: Settings | None = None
) -> dict[str, Any]:
    """Отправить разом то, что владелец утвердил.

    Отправляем по одному и по порядку: площадки не любят залпов, а
    оборвавшаяся на середине пачка должна оставить понятный след — что
    ушло, а что нет.
    """
    config = config or settings
    sent: list[str] = []
    failed: dict[str, str] = {}

    for item_id, text in answers.items():
        clean = str(text or "").strip()
        if not clean:
            failed[item_id] = "пустой ответ"
            continue
        try:
            await inbox.reply(account_id, kind, item_id, clean, config)
        except Exception as exc:  # noqa: BLE001 — площадка могла отказать
            failed[item_id] = type(exc).__name__
            continue
        sent.append(item_id)

    return {"sent": sent, "failed": failed}
