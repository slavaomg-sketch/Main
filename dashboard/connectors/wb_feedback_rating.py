"""Wildberries — оценка товара и число отзывов по одной карточке.

Метод: `GET /api/v1/feedbacks/products/rating/nmid?nmId=<номер>` на хосте
`feedbacks-api.wildberries.ru`. Отдаёт среднюю оценку (`valuation`) и
количество отзывов (`feedbacksCount`).

Спрашивается по требованию, когда владелец открывает карточку: карточек
у него десятки тысяч, и опрашивать их все незачем.
"""

from __future__ import annotations

import hashlib

import httpx

from ..config import settings
from .base import HttpConnector, RateLimited, Throttle

FEEDBACKS_URL = "https://feedbacks-api.wildberries.ru"
PRODUCT_RATING = "/api/v1/feedbacks/products/rating/nmid"

INTERVAL = 1.0
PATIENCE = 20.0


class WildberriesRating(HttpConnector):
    """Оценка одной карточки."""

    code = "wildberries"
    title = "Wildberries"
    base_url = FEEDBACKS_URL

    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
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

    async def product_rating(self, nm_id: str) -> tuple[float, int]:
        """Оценка и число отзывов. Число −1 означает «узнать не удалось».

        Ноль отзывов и «не спросили» — разные вещи: показать ноль вместо
        ошибки значит соврать, что отзывов нет.
        """
        async def send() -> httpx.Response:
            async with self.client() as client:
                return await client.get(PRODUCT_RATING, params={"nmId": str(nm_id)})

        try:
            response = await Throttle.run(
                f"wb-rating:{self._key()}", INTERVAL, send, max_wait=PATIENCE
            )
            response.raise_for_status()
            body = response.json()
        except (RateLimited, httpx.HTTPError, ValueError):
            return 0.0, -1

        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            return 0.0, -1

        return self.to_float(data.get("valuation")), self.to_int(data.get("feedbacksCount"))
