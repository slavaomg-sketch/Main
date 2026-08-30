"""Wildberries — каталог карточек продавца.

Нужен ради одного: собрать полный список «родителей». Панель видит товары
только тогда, когда по ним приходит вопрос или отзыв, — а владельцу нужен
весь список сразу, чтобы описать каждый товар словами один раз и больше
к этому не возвращаться.

Метод: `POST /content/v2/get/cards/list` на хосте `content-api.wildberries.ru`.
Листается курсором: в ответе приходят `updatedAt` и `nmID` последней
карточки, их же кладём в следующий запрос. Останавливаемся, когда площадка
вернула меньше карточек, чем просили.

Площадка пускает к разделу «Контент» до 100 запросов в минуту на кабинет,
поэтому между страницами выдерживается пауза.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, Throttle

CONTENT_URL = "https://content-api.wildberries.ru"
CARDS_LIST = "/content/v2/get/cards/list"

# Сто карточек за раз — предел метода.
PAGE = 100

# Площадка разрешает 100 запросов в минуту. Держимся вдвое ниже предела:
# каталог собирается редко, а лимит общий на весь раздел «Контент».
INTERVAL = 1.2
PATIENCE = 60.0

# Предохранитель от бесконечного хождения по страницам.
MAX_PAGES = 300


@dataclass(frozen=True)
class Card:
    """Одна карточка товара — ровно то, что нужно справочнику."""

    article: str
    name: str


class WildberriesCatalogue(HttpConnector):
    """Карточки товаров кабинета."""

    code = "wildberries"
    title = "Wildberries"
    base_url = CONTENT_URL

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": self.credentials.get("token"),
        }

    def client(self, base_url: str | None = None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=base_url or self.base_url,
            headers=self.headers(),
            timeout=httpx.Timeout(settings.request_timeout),
        )

    def _key(self) -> str:
        raw = str(self.credentials.get("token") or "")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _page(self, cursor: dict[str, Any]) -> dict[str, Any]:
        async def send() -> httpx.Response:
            async with self.client() as client:
                return await client.post(CARDS_LIST, json={
                    "settings": {"cursor": cursor, "filter": {"withPhoto": -1}},
                })

        response = await Throttle.run(
            f"wb-content:{self._key()}", INTERVAL, send, max_wait=PATIENCE
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    async def cards(self) -> list[Card]:
        """Все карточки кабинета, страница за страницей."""
        found: list[Card] = []
        cursor: dict[str, Any] = {"limit": PAGE}

        for _ in range(MAX_PAGES):
            body = await self._page(cursor)
            data = body.get("cards")
            if data is None:
                data = (body.get("data") or {}).get("cards") if isinstance(body.get("data"), dict) else None
            rows = data if isinstance(data, list) else []

            for row in rows:
                if not isinstance(row, dict):
                    continue
                article = str(row.get("vendorCode") or "").strip()
                if not article:
                    continue
                found.append(Card(article=article, name=self._name(row)))

            # Курсор для следующей страницы отдаёт сама площадка.
            answer_cursor = body.get("cursor")
            answer_cursor = answer_cursor if isinstance(answer_cursor, dict) else {}
            total = self.to_int(answer_cursor.get("total"))
            if total < PAGE or not rows:
                break

            cursor = {
                "limit": PAGE,
                "updatedAt": answer_cursor.get("updatedAt"),
                "nmID": answer_cursor.get("nmID"),
            }
            if not cursor["updatedAt"] and not cursor["nmID"]:
                break   # без курсора следующая страница повторит эту

        return found

    def _name(self, row: dict[str, Any]) -> str:
        """Человеческое имя карточки: заголовок, а без него — предмет и бренд."""
        title = str(row.get("title") or "").strip()
        if title:
            return title
        parts = [
            str(row.get("subjectName") or "").strip(),
            str(row.get("brand") or "").strip(),
        ]
        return " ".join(part for part in parts if part)
