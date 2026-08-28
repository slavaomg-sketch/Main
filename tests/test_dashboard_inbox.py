"""Входящие: обращения покупателей — сбор, разбор и ответ."""

import httpx
import pytest

from dashboard import connections as conn
from dashboard import db, inbox
from dashboard.config import settings
from dashboard.connectors.wb_inbox import WildberriesInbox


@pytest.fixture
async def store(dashboard_db):
    await db.init_db()
    created = await conn.create("wildberries", "ВБ Вячеслав")
    await conn.save_values(created.id, {"token": "token-value"})
    return await conn.get(created.id)


FEEDBACK = {
    "id": "f1",
    "text": "Кабель перестал работать через неделю",
    "pros": "Быстрая доставка",
    "cons": "Хлипкий разъём",
    "productValuation": 2,
    "userName": "Ирина",
    "createdDate": "2026-08-27T10:15:00Z",
    "photoLinks": [{"fullSize": "https://example/1.jpg"}],
    "productDetails": {"productName": "Кабель TC-TC 1 м", "supplierArticle": "TC-TC-1M", "nmId": 777},
}

QUESTION = {
    "id": "q1",
    "text": "Подойдёт ли к MacBook Pro?",
    "userName": "Пётр",
    "createdDate": "2026-08-28T09:00:00Z",
    "productDetails": {"productName": "Кабель TC-TC 2 м", "supplierArticle": "TC-TC-2M", "nmId": 778},
}


def mock_inbox(monkeypatch, handler):
    def client(self):
        return httpx.AsyncClient(
            base_url=self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesInbox, "client", client)


def handler_for(feedbacks=None, questions=None, claims=None, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append((request.method, request.url.path))
        path = request.url.path
        if path.endswith("/count-unanswered"):
            count = len(questions or []) if "questions" in path else len(feedbacks or [])
            return httpx.Response(200, json={"data": {"countUnanswered": count}})
        if path == "/api/v1/feedbacks":
            return httpx.Response(200, json={"data": {"feedbacks": feedbacks or []}})
        if path == "/api/v1/questions" and request.method == "GET":
            return httpx.Response(200, json={"data": {"questions": questions or []}})
        if path == "/api/v1/claims":
            return httpx.Response(200, json={"claims": claims or []})
        return httpx.Response(200, json={})

    return handler


# --- разбор обращений -----------------------------------------------------------


async def test_feedback_keeps_the_whole_text_and_marks_the_urgent_one(monkeypatch):
    """«Достоинства» и «недостатки» — часть отзыва: и человеку, и агенту
    нужен весь текст. Две звезды — повод позвать человека."""
    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK]))
    connector = WildberriesInbox({"token": "t"})

    item = (await connector.feedbacks())[0]

    assert item.kind == "feedback"
    assert "перестал работать" in item.text
    assert "Достоинства: Быстрая доставка" in item.text
    assert "Недостатки: Хлипкий разъём" in item.text
    assert item.rating == 2
    assert item.urgent is True
    assert item.article == "TC-TC-1M"
    assert item.photos == ["https://example/1.jpg"]


async def test_high_rating_feedback_is_not_urgent(monkeypatch):
    calm = dict(FEEDBACK, id="f2", productValuation=5, text="Всё отлично")
    mock_inbox(monkeypatch, handler_for(feedbacks=[calm]))
    connector = WildberriesInbox({"token": "t"})

    assert (await connector.feedbacks())[0].urgent is False


async def test_question_is_parsed(monkeypatch):
    mock_inbox(monkeypatch, handler_for(questions=[QUESTION]))
    connector = WildberriesInbox({"token": "t"})

    item = (await connector.questions())[0]
    assert item.kind == "question"
    assert item.text == "Подойдёт ли к MacBook Pro?"
    assert item.urgent is False


# --- сбор по магазинам ----------------------------------------------------------


async def test_collect_groups_by_chapters(store, monkeypatch):
    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK], questions=[QUESTION]))

    result = await inbox.collect(settings)
    chapters = {chapter["kind"]: chapter for chapter in result["chapters"]}

    assert [chapter["kind"] for chapter in result["chapters"]] == [
        "feedback", "question", "claim",
    ]
    assert chapters["feedback"]["count"] == 1
    assert chapters["feedback"]["urgent"] == 1
    assert chapters["question"]["count"] == 1
    assert result["total"] == 2
    assert result["urgent"] == 1
    # Обращение подписано магазином — их несколько, и отвечать нужно от нужного.
    assert chapters["feedback"]["items"][0]["accountTitle"] == "ВБ Вячеслав"


async def test_broken_chapter_does_not_take_down_the_rest(store, monkeypatch):
    """Заявки могут быть недоступны по правам токена — отзывы при этом
    обязаны остаться на экране."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/claims":
            return httpx.Response(403, json={"detail": "no scope"})
        return handler_for(feedbacks=[FEEDBACK])(request)

    mock_inbox(monkeypatch, handler)
    result = await inbox.collect(settings)

    chapters = {chapter["kind"]: chapter for chapter in result["chapters"]}
    assert chapters["feedback"]["count"] == 1
    assert chapters["claim"]["count"] == 0
    assert any("claim" in key for key in result["errors"])


# --- ответы ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "kind, method, path",
    [
        ("feedback", "POST", "/api/v1/feedbacks/answer"),
        ("question", "PATCH", "/api/v1/questions"),
        ("claim", "PATCH", "/api/v1/claim"),
    ],
)
async def test_each_chapter_answers_its_own_way(monkeypatch, kind, method, path):
    """У каждой главы свой метод ответа — перепутать их нельзя."""
    seen: list[tuple[str, str]] = []
    mock_inbox(monkeypatch, handler_for(seen=seen))

    await WildberriesInbox({"token": "t"}).answer(kind, "42", "Спасибо за отзыв!")

    assert seen == [(method, path)]


async def test_unknown_chapter_is_refused(monkeypatch):
    mock_inbox(monkeypatch, handler_for())
    with pytest.raises(ValueError):
        await WildberriesInbox({"token": "t"}).answer("почта", "1", "текст")


# --- черновики помощника --------------------------------------------------------


async def test_collect_remembers_items_for_the_agent(store, monkeypatch):
    """Черновик пишется по тексту, который панель получила от площадки сама,
    а не по тому, что прислал браузер."""
    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK], questions=[QUESTION]))
    await inbox.collect(settings)

    found = inbox.find(store.id, "feedback", "f1")
    assert found is not None
    assert "перестал работать" in found.text
    assert inbox.find(store.id, "feedback", "нет такого") is None
    # Ключ учитывает главу: у отзыва и вопроса номера могут совпасть.
    assert inbox.find(store.id, "question", "f1") is None


async def test_empty_collect_forgets_previous_items(store, monkeypatch):
    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK]))
    await inbox.collect(settings)
    assert inbox.find(store.id, "feedback", "f1") is not None

    await conn.update(store.id, enabled=False)
    await inbox.collect(settings)
    assert inbox.find(store.id, "feedback", "f1") is None
