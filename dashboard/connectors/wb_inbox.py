"""Wildberries — обращения покупателей: отзывы, вопросы, заявки на возврат.

Это то, что в кабинете продавца висит красными кружками с числами и ждёт
ответа. Задача панели — собрать всё это в одном месте и довести до нуля.

Документация: https://dev.wildberries.ru
Хост `feedbacks-api.wildberries.ru`, токен передаётся заголовком
`Authorization`. В токене нужна категория «Вопросы и отзывы».

Отвечать умеет каждая глава, но по-своему:

* отзыв — `POST /api/v1/feedbacks/answer` с телом `{id, text}`;
* вопрос — `PATCH /api/v1/questions` с телом `{id, answer: {text}}`;
* заявка на возврат — `PATCH /api/v1/claim`.
"""

from __future__ import annotations

import hashlib
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, RateLimited, Throttle
from .dates import parse_moment
from .inbox_base import CHAT, CLAIM, FEEDBACK, QUESTION, InboxItem

__all__ = ["InboxItem", "WildberriesInbox"]

FEEDBACKS_URL = "https://feedbacks-api.wildberries.ru"

# Чаты с покупателями живут на отдельном хосте и требуют в токене
# отдельную категорию — «Чат с покупателями».
CHAT_URL = "https://buyer-chat-api.wildberries.ru"
LIST_CHATS = "/api/v1/seller/chats"
LIST_EVENTS = "/api/v1/seller/events"
SEND_MESSAGE = "/api/v1/seller/message"

COUNT_FEEDBACKS = "/api/v1/feedbacks/count-unanswered"
COUNT_QUESTIONS = "/api/v1/questions/count-unanswered"
LIST_FEEDBACKS = "/api/v1/feedbacks"
LIST_QUESTIONS = "/api/v1/questions"
LIST_CLAIMS = "/api/v1/claims"
ANSWER_FEEDBACK = "/api/v1/feedbacks/answer"
ANSWER_QUESTION = "/api/v1/questions"
ANSWER_CLAIM = "/api/v1/claim"

# Площадка пускает сюда мягче, чем к статистике, но пауза всё равно нужна:
# панель опрашивает три главы подряд по каждому магазину.
INTERVAL = 1.0
PATIENCE = 20.0

# Сколько обращений забираем за раз. Больше и не нужно: задача — довести
# счётчик до нуля, а не выгрузить всю историю.
PAGE = 100

# Чаты пускают мягче остального: 10 запросов за 10 секунд на кабинет.
CHAT_INTERVAL = 1.1


class WildberriesInbox(HttpConnector):
    """Обращения покупателей Wildberries: прочитать и ответить."""

    code = "wildberries"
    title = "Wildberries"
    base_url = FEEDBACKS_URL

    # Главы в том порядке, в котором их видит владелец панели.
    CHAPTERS: tuple[tuple[str, str], ...] = (
        (FEEDBACK, "Отзывы"),
        (QUESTION, "Вопросы"),
        (CLAIM, "Заявки на возврат"),
        (CHAT, "Сообщения покупателей"),
    )

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": self.credentials.get("token"),
        }

    def client(self, base_url: str | None = None) -> httpx.AsyncClient:
        # Отзывы и чаты живут на разных хостах, а токен и заголовки общие.
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    def _key(self) -> str:
        raw = str(self.credentials.get("token") or "")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _call(
        self, method: str, path: str, host: str | None = None, **kwargs
    ) -> httpx.Response:
        """Запрос к обращениям с общей паузой между обращениями."""

        async def send() -> httpx.Response:
            async with self.client(host) as client:
                return await client.request(method, path, **kwargs)

        # У чатов свой лимит и свой хост, поэтому и очередь ожидания своя.
        pause = CHAT_INTERVAL if host == CHAT_URL else INTERVAL
        queue = "wb-chat" if host == CHAT_URL else "wb-inbox"
        response = await Throttle.run(
            f"{queue}:{self._key()}", pause, send, max_wait=PATIENCE
        )
        response.raise_for_status()
        return response

    # --- счётчики ------------------------------------------------------------

    async def counts(self) -> dict[str, int]:
        """Сколько всего ждёт ответа. Это и есть те самые красные кружки."""
        result = {"feedbacks": 0, "questions": 0}
        for name, path in (("feedbacks", COUNT_FEEDBACKS), ("questions", COUNT_QUESTIONS)):
            try:
                body = (await self._call("GET", path)).json()
            except (RateLimited, httpx.HTTPError):
                continue
            data = body.get("data") if isinstance(body, dict) else None
            if isinstance(data, dict):
                result[name] = self.to_int(data.get("countUnanswered") or data.get("count"))
            else:
                result[name] = self.to_int(data)
        return result

    # --- списки --------------------------------------------------------------

    async def feedbacks(self, take: int = PAGE) -> list[InboxItem]:
        """Отзывы без ответа, новые сверху."""
        body = (await self._call("GET", LIST_FEEDBACKS, params={
            "isAnswered": "false", "take": take, "skip": 0, "order": "dateDesc",
        })).json()
        data = body.get("data") if isinstance(body, dict) else {}
        return [self._feedback(row) for row in self.as_list(data, "feedbacks")]

    async def questions(self, take: int = PAGE) -> list[InboxItem]:
        """Вопросы без ответа, новые сверху."""
        body = (await self._call("GET", LIST_QUESTIONS, params={
            "isAnswered": "false", "take": take, "skip": 0, "order": "dateDesc",
        })).json()
        data = body.get("data") if isinstance(body, dict) else {}
        return [self._question(row) for row in self.as_list(data, "questions")]

    async def claims(self) -> list[InboxItem]:
        """Заявки покупателей на возврат, ожидающие решения."""
        body = (await self._call("GET", LIST_CLAIMS, params={"is_overdue": 0})).json()
        rows = self.as_list(body, "claims", "data")
        return [self._claim(row) for row in rows]

    async def chats(self) -> list[InboxItem]:
        """Личные сообщения покупателей — те, где последнее слово за ними.

        Площадка отдаёт отдельно список чатов и отдельно ленту событий.
        Список даёт участника и товар, лента — текст последнего сообщения.
        Если лента недоступна, чаты всё равно показываем: пустая карточка
        полезнее, чем пропавшая глава.
        """
        body = (await self._call("GET", LIST_CHATS, host=CHAT_URL)).json()
        rows = self.as_list(body, "result", "data", "chats")

        try:
            events = await self._last_messages()
        except (RateLimited, httpx.HTTPError, ValueError):
            events = {}

        items = [self._chat(row, events) for row in rows]
        # Чат без единого сообщения покупателя отвечать не нужно.
        return [item for item in items if item.text or item.id in events]

    async def _last_messages(self) -> dict[str, dict[str, Any]]:
        """Последнее сообщение покупателя в каждом чате."""
        body = (await self._call("GET", LIST_EVENTS, host=CHAT_URL)).json()
        latest: dict[str, dict[str, Any]] = {}

        for event in self.as_list(body, "result", "data", "events"):
            if not isinstance(event, dict):
                continue
            chat_id = str(event.get("chatID") or event.get("chatId") or "")
            if not chat_id:
                continue
            # Сообщения продавца отвечать не нужно — нас интересует покупатель.
            sender = str(event.get("source") or event.get("sender") or "").lower()
            if sender in {"seller", "продавец"}:
                continue
            moment = parse_moment(event.get("addTimestamp") or event.get("eventDate"))
            known = latest.get(chat_id)
            if known is None or (moment and known.get("_at") and moment > known["_at"]) \
                    or known.get("_at") is None:
                latest[chat_id] = {**event, "_at": moment}

        return latest

    # --- главы ---------------------------------------------------------------

    async def load(self, kind: str) -> list[InboxItem]:
        """Обращения одной главы."""
        loaders = {
            FEEDBACK: self.feedbacks,
            QUESTION: self.questions,
            CLAIM: self.claims,
            CHAT: self.chats,
        }
        if kind not in loaders:
            raise ValueError(f"неизвестная глава: {kind}")
        return await loaders[kind]()

    # --- ответы --------------------------------------------------------------

    async def answer_feedback(self, item_id: str, text: str) -> None:
        await self._call("POST", ANSWER_FEEDBACK, json={"id": item_id, "text": text})

    async def answer_question(self, item_id: str, text: str) -> None:
        await self._call(
            "PATCH", ANSWER_QUESTION, json={"id": item_id, "answer": {"text": text}}
        )

    async def answer_claim(self, item_id: str, text: str) -> None:
        await self._call("PATCH", ANSWER_CLAIM, json={"id": item_id, "comment": text})

    async def answer_chat(self, item_id: str, text: str) -> None:
        # Площадка ждёт сообщение формой, а не JSON.
        await self._call(
            "POST", SEND_MESSAGE, host=CHAT_URL,
            data={"replySign": item_id, "message": text},
        )

    async def answer(self, kind: str, item_id: str, text: str) -> None:
        """Ответить на обращение любой главы — у каждой свой метод."""
        if kind == FEEDBACK:
            await self.answer_feedback(item_id, text)
        elif kind == QUESTION:
            await self.answer_question(item_id, text)
        elif kind == CLAIM:
            await self.answer_claim(item_id, text)
        elif kind == CHAT:
            await self.answer_chat(item_id, text)
        else:
            raise ValueError(f"неизвестный вид обращения: {kind}")

    # --- разбор --------------------------------------------------------------

    def _product(self, row: dict[str, Any]) -> tuple[str, str, str]:
        details = row.get("productDetails")
        details = details if isinstance(details, dict) else {}
        name = str(details.get("productName") or row.get("productName") or "")
        article = str(details.get("supplierArticle") or "")
        nm_id = str(details.get("nmId") or row.get("nmId") or "")
        return name, article, nm_id

    def _feedback(self, row: dict[str, Any]) -> InboxItem:
        name, article, nm_id = self._product(row)
        photos = [
            str(photo.get("fullSize") or photo.get("miniSize") or "")
            for photo in self.as_list(row, "photoLinks")
            if isinstance(photo, dict)
        ]
        # Отзыв бывает разбит на «достоинства» и «недостатки» — агенту и
        # человеку нужен весь текст сразу, поэтому склеиваем.
        parts = [
            str(row.get("text") or ""),
            f"Достоинства: {row.get('pros')}" if row.get("pros") else "",
            f"Недостатки: {row.get('cons')}" if row.get("cons") else "",
        ]
        return InboxItem(
            kind="feedback",
            id=str(row.get("id") or ""),
            text="\n".join(part for part in parts if part).strip(),
            created_at=parse_moment(row.get("createdDate")),
            author=str(row.get("userName") or ""),
            rating=self.to_int(row.get("productValuation")),
            product=name,
            article=article,
            nm_id=nm_id,
            photos=[photo for photo in photos if photo],
        )

    def _question(self, row: dict[str, Any]) -> InboxItem:
        name, article, nm_id = self._product(row)
        return InboxItem(
            kind="question",
            id=str(row.get("id") or ""),
            text=str(row.get("text") or ""),
            created_at=parse_moment(row.get("createdDate")),
            author=str(row.get("userName") or ""),
            product=name,
            article=article,
            nm_id=nm_id,
        )

    def _chat(self, row: dict[str, Any], events: dict[str, dict[str, Any]]) -> InboxItem:
        """Чат с покупателем как одно обращение.

        Отвечать площадка просит по `replySign` — подписи, которую она сама
        выдаёт вместе с чатом. Если её нет, держимся за номер чата.
        """
        chat_id = str(row.get("chatID") or row.get("chatId") or row.get("id") or "")
        last = events.get(chat_id) or {}
        message = last.get("message")
        message = message if isinstance(message, dict) else {}

        return InboxItem(
            kind=CHAT,
            id=str(row.get("replySign") or last.get("replySign") or chat_id),
            text=str(message.get("text") or last.get("text") or "").strip(),
            created_at=parse_moment(
                last.get("addTimestamp") or row.get("lastEventTime") or row.get("createDate")
            ),
            author=str(row.get("clientName") or row.get("userName") or ""),
            product=str(row.get("productName") or ""),
            nm_id=str(row.get("nmId") or row.get("nm_id") or ""),
        )

    def _claim(self, row: dict[str, Any]) -> InboxItem:
        return InboxItem(
            kind="claim",
            id=str(row.get("id") or ""),
            text=str(row.get("userComment") or row.get("claim_type") or ""),
            created_at=parse_moment(row.get("dt") or row.get("createdDate")),
            author=str(row.get("userName") or ""),
            product=str(row.get("productName") or row.get("subject_name") or ""),
            nm_id=str(row.get("nmId") or row.get("nm_id") or ""),
        )
