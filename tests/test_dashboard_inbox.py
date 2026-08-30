"""Входящие: обращения покупателей — сбор, разбор и ответ."""

import httpx
import pytest

from dashboard import connections as conn
from dashboard import db, inbox
from dashboard.config import settings
from dashboard.connectors.ozon_inbox import OzonInbox
from dashboard.connectors.wb_inbox import WildberriesInbox
from dashboard.connectors.yandex_inbox import MissingBusiness, YandexInbox


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

CHAT = {
    "chatID": "ch1",
    "clientName": "Ольга",
    "productName": "Кабель TC-TC 1 м",
    "nmId": 777,
    "replySign": "sign-1",
}

CHAT_EVENT = {
    "chatID": "ch1",
    "source": "client",
    "addTimestamp": "2026-08-28T12:00:00Z",
    "message": {"text": "Когда приедет замена?"},
}


def mock_inbox(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(WildberriesInbox, "client", client)


def handler_for(feedbacks=None, questions=None, claims=None, chats=None,
                events=None, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append((request.method, request.url.path))
        path = request.url.path

        # Чаты живут на своём хосте — разводим по нему, а не по пути.
        if request.url.host.startswith("buyer-chat"):
            if path == "/api/v1/seller/chats":
                return httpx.Response(200, json={"result": {"chats": chats or []}})
            if path == "/api/v1/seller/events":
                return httpx.Response(200, json={"result": {"events": events or []}})
            return httpx.Response(200, json={})

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


# --- чаты с покупателями --------------------------------------------------------


async def test_chat_takes_the_last_buyer_message(monkeypatch):
    """Чат показываем текстом последнего сообщения покупателя — иначе
    непонятно, на что отвечать."""
    mock_inbox(monkeypatch, handler_for(chats=[CHAT], events=[CHAT_EVENT]))

    item = (await WildberriesInbox({"token": "t"}).chats())[0]

    assert item.kind == "chat"
    assert item.text == "Когда приедет замена?"
    assert item.author == "Ольга"
    assert item.product == "Кабель TC-TC 1 м"
    # Отвечать площадка просит по подписи, а не по номеру чата.
    assert item.id == "sign-1"


async def test_own_messages_do_not_become_a_task(monkeypatch):
    """Своё же сообщение отвечать не нужно."""
    mine = dict(CHAT_EVENT, source="seller", message={"text": "Уже отправили"})
    mock_inbox(monkeypatch, handler_for(chats=[CHAT], events=[mine]))

    assert await WildberriesInbox({"token": "t"}).chats() == []


async def test_chat_survives_broken_events(monkeypatch):
    """Лента событий может быть недоступна — чаты всё равно нужны."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/seller/events":
            return httpx.Response(500, json={})
        return handler_for(chats=[dict(CHAT, lastEventTime="2026-08-28T12:00:00Z")])(request)

    mock_inbox(monkeypatch, handler)
    # Без текста сообщения чат в список не попадёт, но и падения нет.
    assert await WildberriesInbox({"token": "t"}).chats() == []


async def test_chat_answer_goes_to_the_chat_host(monkeypatch):
    seen: list[tuple[str, str]] = []
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        hosts.append(request.url.host)
        return httpx.Response(200, json={})

    mock_inbox(monkeypatch, handler)
    await WildberriesInbox({"token": "t"}).answer("chat", "sign-1", "Привезём завтра")

    assert seen == [("POST", "/api/v1/seller/message")]
    assert hosts[0].startswith("buyer-chat")


# --- сбор по площадкам и магазинам ----------------------------------------------


async def test_collect_builds_marketplace_store_chapter_tree(store, monkeypatch):
    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK], questions=[QUESTION]))

    result = await inbox.collect(settings)

    assert [place["code"] for place in result["marketplaces"]] == ["wildberries"]
    place = result["marketplaces"][0]
    assert place["title"] == "Wildberries"
    assert [shop["title"] for shop in place["stores"]] == ["ВБ Вячеслав"]

    chapters = {chapter["kind"]: chapter for chapter in place["stores"][0]["chapters"]}
    assert list(chapters) == ["feedback", "question", "claim", "chat"]
    assert chapters["feedback"]["count"] == 1
    assert chapters["feedback"]["urgent"] == 1
    assert chapters["question"]["count"] == 1
    assert result["total"] == 2
    assert result["urgent"] == 1
    # Обращение подписано магазином — их несколько, и отвечать нужно от нужного.
    assert chapters["feedback"]["items"][0]["accountTitle"] == "ВБ Вячеслав"
    assert chapters["feedback"]["items"][0]["marketplace"] == "wildberries"


async def test_two_stores_are_counted_apart(dashboard_db, monkeypatch):
    """У площадки несколько кабинетов, и у каждого свой счётчик."""
    await db.init_db()
    # Токен уходит в заголовок HTTP — он обязан быть без кириллицы.
    for title, token in (("ВБ Вячеслав", "token-a"), ("ВБ Наталья", "token-b")):
        created = await conn.create("wildberries", title)
        await conn.save_values(created.id, {"token": token})

    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK]))
    result = await inbox.collect(settings)

    shops = result["marketplaces"][0]["stores"]
    assert [shop["title"] for shop in shops] == ["ВБ Вячеслав", "ВБ Наталья"]
    assert all(shop["total"] == 1 for shop in shops)
    assert result["total"] == 2


async def test_broken_chapter_does_not_take_down_the_rest(store, monkeypatch):
    """Заявки могут быть недоступны по правам токена — отзывы при этом
    обязаны остаться на экране, и причина должна быть человеческой."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/claims":
            return httpx.Response(403, json={"detail": "no scope"})
        return handler_for(feedbacks=[FEEDBACK])(request)

    mock_inbox(monkeypatch, handler)
    result = await inbox.collect(settings)

    chapters = {
        chapter["kind"]: chapter
        for chapter in result["marketplaces"][0]["stores"][0]["chapters"]
    }
    assert chapters["feedback"]["count"] == 1
    assert chapters["claim"]["count"] == 0
    assert result["errors"][f"{store.id}:claim"] == "нет прав в ключе"


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


# --- Ozon -----------------------------------------------------------------------


def mock_ozon(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(OzonInbox, "client", client)


async def test_ozon_review_and_question_are_parsed(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/review/list":
            return httpx.Response(200, json={"reviews": [{
                "id": "r1", "text": "Не подошёл размер", "rating": 3,
                "author_name": "Анна", "product_name": "Кабель",
                "offer_id": "TC-1M", "sku": 9001,
                "published_at": "2026-08-28T08:00:00Z",
            }]})
        if request.url.path == "/v1/question/list":
            return httpx.Response(200, json={"questions": [{
                "id": "q1", "text": "Есть ли гарантия?", "author_name": "Игорь",
            }]})
        return httpx.Response(200, json={"chats": []})

    mock_ozon(monkeypatch, handler)
    connector = OzonInbox({"client_id": "1", "api_key": "k"})

    review = (await connector.reviews())[0]
    assert review.kind == "feedback"
    assert review.rating == 3
    assert review.urgent is True          # три звезды — зовём человека
    assert review.article == "TC-1M"

    question = (await connector.questions())[0]
    assert question.text == "Есть ли гарантия?"


async def test_ozon_answers_go_to_their_own_methods(monkeypatch):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json={})

    mock_ozon(monkeypatch, handler)
    connector = OzonInbox({"client_id": "1", "api_key": "k"})

    await connector.answer("feedback", "r1", "Спасибо")
    await connector.answer("question", "q1", "Гарантия год")
    await connector.answer("chat", "c1", "Здравствуйте")

    assert seen == [
        "/v1/review/comment/create",
        "/v1/question/answer/create",
        "/v1/chat/send/message",
    ]


async def test_ozon_has_no_returns_chapter():
    """У Ozon нет заявок на возврат — главу выдумывать нельзя."""
    assert [kind for kind, _ in OzonInbox.CHAPTERS] == ["feedback", "question", "chat"]


# --- Яндекс Маркет --------------------------------------------------------------


def mock_yandex(monkeypatch, handler):
    def client(self, base_url=None):
        return httpx.AsyncClient(
            base_url=base_url or self.base_url, headers=self.headers(),
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(YandexInbox, "client", client)


async def test_yandex_feedback_is_parsed(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/businesses/77/goods-feedback"
        return httpx.Response(200, json={"result": {"feedbacks": [{
            "feedbackId": 5, "createdAt": "2026-08-28T07:00:00Z", "author": "Мария",
            "description": {"comment": "Всё хорошо", "advantages": "Цена"},
            "statistics": {"rating": 5},
            "identifiers": {"offerId": "TC-2M", "offerName": "Кабель 2 м"},
        }]}})

    mock_yandex(monkeypatch, handler)
    connector = YandexInbox({"api_key": "k", "business_id": "77"})

    item = (await connector.feedbacks())[0]
    assert item.id == "5"
    assert "Всё хорошо" in item.text
    assert "Достоинства: Цена" in item.text
    assert item.rating == 5
    assert item.urgent is False


async def test_yandex_without_business_id_says_what_is_missing():
    """Без идентификатора бизнеса главы не работают — и должны сказать это
    словами, а не молча показать ноль."""
    connector = YandexInbox({"api_key": "k"})
    with pytest.raises(MissingBusiness, match="Идентификатор бизнеса"):
        await connector.feedbacks()


async def test_yandex_answer_uses_the_comment_method(monkeypatch):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json={})

    mock_yandex(monkeypatch, handler)
    connector = YandexInbox({"api_key": "k", "business_id": "77"})

    await connector.answer("feedback", "5", "Спасибо за отзыв")
    await connector.answer("chat", "9", "Добрый день")

    assert seen == [
        "/v2/businesses/77/goods-feedback/comments/update",
        "/v2/businesses/77/chats/message",
    ]


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


async def test_collect_does_not_wipe_what_another_screen_loaded(store, monkeypatch):
    """Память помощника — общая на два экрана. Пустой сбор одного из них
    не имеет права стирать обращения, загруженные другим."""
    mock_inbox(monkeypatch, handler_for(feedbacks=[FEEDBACK]))
    await inbox.collect(settings)
    assert inbox.find(store.id, "feedback", "f1") is not None

    # Кабинет выключили — сбор вернёт пустоту, но чужую память не тронет.
    await conn.update(store.id, enabled=False)
    await inbox.collect(settings)
    assert inbox.find(store.id, "feedback", "f1") is not None
