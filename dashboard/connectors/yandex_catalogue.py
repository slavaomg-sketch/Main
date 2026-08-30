"""Яндекс Маркет — каталог товаров кабинета.

Метод: `POST /v2/businesses/{businessId}/offer-mappings` на хосте
`api.partner.market.yandex.ru`. Отдаёт товары кабинета вместе с
названием, картинками и категорией, к которой площадка их отнесла.

Листается маркером: в ответе приходит `paging.nextPageToken`, его же
кладём в запрос следующей страницы. За раз площадка отдаёт не больше
двухсот товаров и пускает до 600 запросов в минуту — с запасом.

Как и у обращений, всё работает по **идентификатору бизнеса**. Если он
не заполнен на странице «Ключи», сбор честно скажет, чего не хватает,
и на остальных кабинетах это никак не отразится.
"""

from __future__ import annotations

import hashlib
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, Throttle
from .wb_catalogue import Card
from .yandex_inbox import MissingBusiness

PARTNER_URL = "https://api.partner.market.yandex.ru"
OFFER_MAPPINGS = "/v2/businesses/{business}/offer-mappings"

# Двести товаров за раз — предел метода.
PAGE = 200

INTERVAL = 0.5
PATIENCE = 60.0

# Предохранитель от бесконечного хождения по страницам: сто тысяч товаров.
MAX_PAGES = 500

# Номер карточки Яндекса — это его же артикул продавца, буквенный.
# Приставка нужна, чтобы он не столкнулся в общей таблице с номером
# карточки Wildberries.
PREFIX = "ya-"


class YandexCatalogue(HttpConnector):
    """Товары кабинета Яндекс Маркета."""

    code = "yandex"
    title = "Яндекс Маркет"
    base_url = PARTNER_URL

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
                "не заполнен «Номер бизнеса» — впишите его на странице «Ключи»"
            )
        return business

    def _key(self) -> str:
        raw = str(self.credentials.get("api_key") or "")
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    async def _post(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        async def send() -> httpx.Response:
            async with self.client() as client:
                return await client.post(path, params=params, json={})

        response = await Throttle.run(
            f"yandex-catalogue:{self._key()}", INTERVAL, send, max_wait=PATIENCE
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    async def cards(self, on_page=None) -> list[Card]:
        """Все товары кабинета, страницами."""
        path = OFFER_MAPPINGS.format(business=self.business_id)
        found: list[Card] = []
        token = ""

        for _ in range(MAX_PAGES):
            params: dict[str, Any] = {"limit": PAGE}
            if token:
                params["page_token"] = token

            body = await self._post(path, params)
            result = body.get("result")
            result = result if isinstance(result, dict) else {}

            страница = [
                card
                for card in (self._card(row) for row in self.as_list(result, "offerMappings"))
                if card is not None
            ]
            found.extend(страница)
            if on_page is not None and страница:
                await on_page(страница)

            paging = result.get("paging")
            paging = paging if isinstance(paging, dict) else {}
            следующий = str(paging.get("nextPageToken") or "")
            if not следующий or следующий == token:
                break
            token = следующий

        return found

    def _card(self, row: dict[str, Any]) -> Card | None:
        offer = row.get("offer")
        offer = offer if isinstance(offer, dict) else row
        mapping = row.get("mapping")
        mapping = mapping if isinstance(mapping, dict) else {}

        article = str(offer.get("offerId") or "").strip()
        if not article:
            return None

        return Card(
            article=article,
            name=str(offer.get("name") or "").strip(),
            nm_id=f"{PREFIX}{article}",
            brand=str(offer.get("vendor") or "").strip(),
            subject=self._category(offer, mapping),
            photos=self._photos(offer),
        )

    def _photos(self, offer: dict[str, Any]) -> tuple[str, ...]:
        """Картинки товара. Первая — геройская, её и показываем на плитке."""
        return tuple(
            picture.strip()
            for picture in offer.get("pictures", [])
            if isinstance(picture, str) and picture.strip()
        )

    def _category(self, offer: dict[str, Any], mapping: dict[str, Any]) -> str:
        """Категория товара — как её называет площадка.

        Числовой `marketCategoryId` сюда не годится: на полке в панели
        должно стоять слово, а не номер.
        """
        for source, field in (
            (mapping, "marketCategoryName"),
            (offer, "category"),
            (offer, "marketCategoryName"),
        ):
            value = source.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""
