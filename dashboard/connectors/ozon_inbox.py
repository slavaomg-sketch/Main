"""Ozon — обращения покупателей: отзывы, вопросы, чаты.

Документация: https://docs.ozon.ru/api/seller
Хост `api-seller.ozon.ru`, авторизация заголовками `Client-Id` и `Api-Key` —
теми же, что и для остальной статистики Ozon.

Методы:

* отзывы   — `POST /v1/review/list`, ответ `POST /v1/review/comment/create`;
* вопросы  — `POST /v1/question/list`, ответ `POST /v1/question/answer/create`;
* чаты     — `POST /v3/chat/list` и `POST /v3/chat/history`,
             отправка `POST /v1/chat/send/message`.

Важно про отзывы: площадка отдаёт их **только при подписке Premium Plus**.
Без неё глава отзывов честно скажет, что доступа нет, а остальные главы
продолжат работать.
"""

from __future__ import annotations

import hashlib
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, Throttle
from .dates import parse_moment
from .inbox_base import CHAT, FEEDBACK, QUESTION, InboxItem

SELLER_URL = "https://api-seller.ozon.ru"

LIST_REVIEWS = "/v1/review/list"
ANSWER_REVIEW = "/v1/review/comment/create"
LIST_QUESTIONS = "/v1/question/list"
ANSWER_QUESTION = "/v1/question/answer/create"
LIST_CHATS = "/v3/chat/list"
CHAT_HISTORY = "/v3/chat/history"
SEND_MESSAGE = "/v1/chat/send/message"

# Ozon держит планку в два запроса в секунду — та же пауза, что и в основном
# коннекторе, иначе площадка отвечает 429.
INTERVAL = 1.5
PATIENCE = 20.0

PAGE = 100


class OzonInbox(HttpConnector):
    """Обращения покупателей Ozon: прочитать и ответить."""

    code = "ozon"
    title = "Ozon"
    base_url = SELLER_URL

    CHAPTERS: tuple[tuple[str, str], ...] = (
        (FEEDBACK, "Отзывы"),
        (QUESTION, "Вопросы"),
        (CHAT, "Сообщения покупателей"),
    )

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Client-Id": self.credentials.get("client_id"),
            "Api-Key": self.credentials.get("api_key"),
        }

    def client(self, base_url: str | None = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    def _key(self) -> str:
        raw = f"{self.credentials.get('client_id')}:{self.credentials.get('api_key')}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async def send() -> httpx.Response:
            async with self.client() as client:
                return await client.post(path, json=payload)

        response = await Throttle.run(
            f"ozon-inbox:{self._key()}", INTERVAL, send, max_wait=PATIENCE
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    # --- списки --------------------------------------------------------------

    async def reviews(self) -> list[InboxItem]:
        """Отзывы без ответа. Требует подписки Premium Plus."""
        body = await self._post(LIST_REVIEWS, {
            "limit": PAGE, "status": "UNPROCESSED", "sort_dir": "DESC",
        })
        return [self._review(row) for row in self.as_list(body, "reviews", "result")]

    async def questions(self) -> list[InboxItem]:
        """Вопросы о товарах, ожидающие ответа."""
        body = await self._post(LIST_QUESTIONS, {"status": "NEW"})
        return [self._question(row) for row in self.as_list(body, "questions", "result")]

    async def chats(self) -> list[InboxItem]:
        """Чаты, где последнее слово за покупателем."""
        body = await self._post(LIST_CHATS, {
            "limit": PAGE,
            "filter": {"unread_only": True},
        })
        rows = self.as_list(body, "chats", "result")

        items = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            items.append(self._chat(row))
        return items

    # --- ответы --------------------------------------------------------------

    async def answer_review(self, item_id: str, text: str) -> None:
        await self._post(ANSWER_REVIEW, {
            "review_id": item_id, "text": text, "mark_review_as_processed": True,
        })

    async def answer_question(self, item_id: str, text: str) -> None:
        await self._post(ANSWER_QUESTION, {"question_id": item_id, "text": text})

    async def answer_chat(self, item_id: str, text: str) -> None:
        await self._post(SEND_MESSAGE, {"chat_id": item_id, "text": text})

    async def answer(self, kind: str, item_id: str, text: str) -> None:
        if kind == FEEDBACK:
            await self.answer_review(item_id, text)
        elif kind == QUESTION:
            await self.answer_question(item_id, text)
        elif kind == CHAT:
            await self.answer_chat(item_id, text)
        else:
            raise ValueError(f"неизвестный вид обращения: {kind}")

    async def load(self, kind: str) -> list[InboxItem]:
        loaders = {FEEDBACK: self.reviews, QUESTION: self.questions, CHAT: self.chats}
        if kind not in loaders:
            raise ValueError(f"неизвестная глава: {kind}")
        return await loaders[kind]()

    # --- разбор --------------------------------------------------------------

    def _review(self, row: dict[str, Any]) -> InboxItem:
        photos = [
            str(photo.get("url") or "")
            for photo in self.as_list(row, "photos")
            if isinstance(photo, dict)
        ]
        return InboxItem(
            kind=FEEDBACK,
            id=str(row.get("id") or row.get("review_id") or ""),
            text=str(row.get("text") or "").strip(),
            created_at=parse_moment(row.get("published_at") or row.get("created_at")),
            author=str(row.get("author_name") or ""),
            rating=self.to_int(row.get("rating")),
            product=str(row.get("product_name") or ""),
            article=str(row.get("offer_id") or ""),
            nm_id=str(row.get("sku") or ""),
            photos=[photo for photo in photos if photo],
        )

    def _question(self, row: dict[str, Any]) -> InboxItem:
        return InboxItem(
            kind=QUESTION,
            id=str(row.get("id") or row.get("question_id") or ""),
            text=str(row.get("text") or "").strip(),
            created_at=parse_moment(row.get("published_at") or row.get("created_at")),
            author=str(row.get("author_name") or ""),
            product=str(row.get("product_name") or row.get("product_url") or ""),
            article=str(row.get("offer_id") or ""),
            nm_id=str(row.get("sku") or ""),
        )

    def _chat(self, row: dict[str, Any]) -> InboxItem:
        chat = row.get("chat")
        chat = chat if isinstance(chat, dict) else row
        return InboxItem(
            kind=CHAT,
            id=str(chat.get("chat_id") or chat.get("id") or ""),
            text=str(row.get("last_message_text") or chat.get("last_message_text") or "").strip(),
            created_at=parse_moment(
                row.get("last_message_at") or chat.get("created_at")
            ),
            author=str(chat.get("chat_type") or ""),
        )
