"""Яндекс Маркет — обращения покупателей: отзывы и чаты.

Документация: https://yandex.ru/dev/market/partner-api
Хост `api.partner.market.yandex.ru`, авторизация заголовком `Api-Key` —
тем же, что и для остальной статистики Яндекса.

Методы:

* отзывы — `POST /v2/businesses/{businessId}/goods-feedback`
           со статусом `NEED_REACTION`, ответ —
           `POST /v2/businesses/{businessId}/goods-feedback/comments/update`;
* чаты   — `POST /v2/businesses/{businessId}/chats` со статусом
           `WAITING_FOR_PARTNER`, история — `.../chats/history`,
           отправка — `.../chats/message`.

Важно: обе главы работают по **идентификатору бизнеса**, а не кампании.
Если `business_id` не заполнен на странице «Ключи», главы честно скажут,
чего им не хватает, и остальная панель от этого не пострадает.
"""

from __future__ import annotations

import hashlib
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, Throttle
from .dates import parse_moment
from .inbox_base import CHAT, FEEDBACK, InboxItem

PARTNER_URL = "https://api.partner.market.yandex.ru"

# Яндекс мягче остальных, но подряд идут две главы по каждому кабинету.
INTERVAL = 0.5
PATIENCE = 20.0

PAGE = 50


class MissingBusiness(RuntimeError):
    """Не заполнен идентификатор бизнеса — без него обращений не забрать."""


class YandexInbox(HttpConnector):
    """Обращения покупателей Яндекс Маркета: прочитать и ответить."""

    code = "yandex"
    title = "Яндекс Маркет"
    base_url = PARTNER_URL

    CHAPTERS: tuple[tuple[str, str], ...] = (
        (FEEDBACK, "Отзывы"),
        (CHAT, "Сообщения покупателей"),
    )

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Api-Key": self.credentials.get("api_key"),
        }

    def client(self, base_url: str | None = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    @property
    def business_id(self) -> str:
        business = str(self.credentials.get("business_id") or "").strip()
        if not business:
            raise MissingBusiness(
                "не заполнен «Идентификатор бизнеса» — впишите его на странице «Ключи»"
            )
        return business

    def _key(self) -> str:
        raw = str(self.credentials.get("api_key") or "")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async def send() -> httpx.Response:
            async with self.client() as client:
                return await client.post(path, json=payload)

        response = await Throttle.run(
            f"yandex-inbox:{self._key()}", INTERVAL, send, max_wait=PATIENCE
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    def _path(self, tail: str) -> str:
        return f"/v2/businesses/{self.business_id}{tail}"

    # --- списки --------------------------------------------------------------

    async def feedbacks(self) -> list[InboxItem]:
        """Отзывы, которые ждут реакции магазина."""
        body = await self._post(
            self._path("/goods-feedback"),
            {"reactionStatus": "NEED_REACTION", "paging": {"limit": PAGE}},
        )
        result = body.get("result") if isinstance(body.get("result"), dict) else body
        return [self._feedback(row) for row in self.as_list(result, "feedbacks")]

    async def chats(self) -> list[InboxItem]:
        """Чаты, где ждут ответа магазина."""
        body = await self._post(
            self._path("/chats"),
            {"statuses": ["WAITING_FOR_PARTNER"], "paging": {"limit": PAGE}},
        )
        result = body.get("result") if isinstance(body.get("result"), dict) else body
        return [self._chat(row) for row in self.as_list(result, "chats")]

    # --- ответы --------------------------------------------------------------

    async def answer_feedback(self, item_id: str, text: str) -> None:
        await self._post(
            self._path("/goods-feedback/comments/update"),
            {"feedbackId": self.to_int(item_id), "comment": {"text": text}},
        )

    async def answer_chat(self, item_id: str, text: str) -> None:
        await self._post(
            self._path("/chats/message"),
            {"chatId": self.to_int(item_id), "message": text},
        )

    async def answer(self, kind: str, item_id: str, text: str) -> None:
        if kind == FEEDBACK:
            await self.answer_feedback(item_id, text)
        elif kind == CHAT:
            await self.answer_chat(item_id, text)
        else:
            raise ValueError(f"неизвестный вид обращения: {kind}")

    async def load(self, kind: str) -> list[InboxItem]:
        loaders = {FEEDBACK: self.feedbacks, CHAT: self.chats}
        if kind not in loaders:
            raise ValueError(f"неизвестная глава: {kind}")
        return await loaders[kind]()

    # --- разбор --------------------------------------------------------------

    def _feedback(self, row: dict[str, Any]) -> InboxItem:
        description = row.get("description")
        description = description if isinstance(description, dict) else {}
        parts = [
            str(description.get("comment") or row.get("comment") or ""),
            f"Достоинства: {description['advantages']}" if description.get("advantages") else "",
            f"Недостатки: {description['disadvantages']}" if description.get("disadvantages") else "",
        ]
        identifiers = row.get("identifiers")
        identifiers = identifiers if isinstance(identifiers, dict) else {}

        return InboxItem(
            kind=FEEDBACK,
            id=str(row.get("feedbackId") or row.get("id") or ""),
            text="\n".join(part for part in parts if part).strip(),
            created_at=parse_moment(row.get("createdAt")),
            author=str(row.get("author") or ""),
            rating=self.to_int(row.get("statistics", {}).get("rating")
                               if isinstance(row.get("statistics"), dict)
                               else row.get("rating")),
            product=str(identifiers.get("offerName") or row.get("offerName") or ""),
            article=str(identifiers.get("offerId") or ""),
            nm_id=str(identifiers.get("shopSku") or ""),
            photos=[
                str(photo)
                for photo in self.as_list(row, "photos")
                if isinstance(photo, str)
            ],
        )

    def _chat(self, row: dict[str, Any]) -> InboxItem:
        return InboxItem(
            kind=CHAT,
            id=str(row.get("chatId") or row.get("id") or ""),
            text=str(row.get("lastMessageText") or "").strip(),
            created_at=parse_moment(row.get("updatedAt") or row.get("createdAt")),
            author=str(row.get("type") or ""),
            nm_id=str(row.get("orderId") or ""),
        )
