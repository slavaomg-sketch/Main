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
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, RateLimited, Throttle
from .dates import parse_moment

FEEDBACKS_URL = "https://feedbacks-api.wildberries.ru"

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


@dataclass
class InboxItem:
    """Одно обращение покупателя, приведённое к общему виду.

    Отзывы, вопросы и заявки на возврат устроены по-разному, но панели и
    агенту с ними работать одинаково: у каждого есть кто, когда, о чём и
    к какому товару.
    """

    kind: str                       # feedback | question | claim
    id: str
    text: str = ""
    created_at: datetime | None = None
    author: str = ""
    rating: int = 0
    product: str = ""
    article: str = ""
    nm_id: str = ""
    photos: list[str] = field(default_factory=list)
    answer: str = ""
    account_id: str = ""
    account_title: str = ""

    @property
    def urgent(self) -> bool:
        """Требует человека: низкая оценка или заявка на возврат."""
        return self.kind == "claim" or (self.kind == "feedback" and 0 < self.rating <= 3)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "id": self.id,
            "text": self.text,
            "createdAt": self.created_at.isoformat() if self.created_at else "",
            "author": self.author,
            "rating": int(self.rating),
            "product": self.product,
            "article": self.article,
            "nmId": self.nm_id,
            "photos": list(self.photos),
            "answer": self.answer,
            "accountId": self.account_id,
            "accountTitle": self.account_title,
            "urgent": self.urgent,
        }


class WildberriesInbox(HttpConnector):
    """Обращения покупателей Wildberries: прочитать и ответить."""

    code = "wildberries"
    title = "Wildberries"
    base_url = FEEDBACKS_URL

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": self.credentials.get("token"),
        }

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    def _key(self) -> str:
        raw = str(self.credentials.get("token") or "")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _call(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Запрос к обращениям с общей паузой между обращениями."""

        async def send() -> httpx.Response:
            async with self.client() as client:
                return await client.request(method, path, **kwargs)

        response = await Throttle.run(
            f"wb-inbox:{self._key()}", INTERVAL, send, max_wait=PATIENCE
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

    # --- ответы --------------------------------------------------------------

    async def answer_feedback(self, item_id: str, text: str) -> None:
        await self._call("POST", ANSWER_FEEDBACK, json={"id": item_id, "text": text})

    async def answer_question(self, item_id: str, text: str) -> None:
        await self._call(
            "PATCH", ANSWER_QUESTION, json={"id": item_id, "answer": {"text": text}}
        )

    async def answer_claim(self, item_id: str, text: str) -> None:
        await self._call("PATCH", ANSWER_CLAIM, json={"id": item_id, "comment": text})

    async def answer(self, kind: str, item_id: str, text: str) -> None:
        """Ответить на обращение любой главы — у каждой свой метод."""
        if kind == "feedback":
            await self.answer_feedback(item_id, text)
        elif kind == "question":
            await self.answer_question(item_id, text)
        elif kind == "claim":
            await self.answer_claim(item_id, text)
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
