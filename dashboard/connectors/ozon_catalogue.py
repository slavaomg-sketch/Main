"""Ozon — каталог товаров продавца.

Собирается в два шага, потому что площадка так устроена:

1. `POST /v3/product/list` отдаёт список товаров кабинета — артикул продавца
   (`offer_id`) и внутренний номер (`product_id`). Листается по `last_id`.
2. `POST /v3/product/info/list` добирает по этим номерам название и
   картинки.

Честно про второй шаг: путь взят из документации площадки, но проверить
его на живом кабинете не удалось. Поэтому сбор устроен так, что без него
не рассыпается: список товаров и родители соберутся в любом случае, а
названия с картинками добавятся, если метод ответит. Пустая картинка
лучше сорванного сбора.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

import httpx

from ..config import settings
from .base import HttpConnector, RateLimited, Throttle
from .wb_catalogue import Card

log = logging.getLogger(__name__)

SELLER_URL = "https://api-seller.ozon.ru"
PRODUCT_LIST = "/v3/product/list"
PRODUCT_INFO = "/v3/product/info/list"

# Площадка держит планку около двух запросов в секунду.
INTERVAL = 1.5
PATIENCE = 60.0

# Сколько товаров просим за раз в каждом методе.
PAGE = 1000
INFO_PAGE = 100

MAX_PAGES = 200

# Номер карточки Ozon и номер карточки Wildberries — оба числовые и
# хранятся в одной таблице. Приставка нужна, чтобы они не столкнулись.
PREFIX = "ozon-"


class OzonCatalogue(HttpConnector):
    """Карточки товаров кабинета Ozon."""

    code = "ozon"
    title = "Ozon"
    base_url = SELLER_URL

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
            f"ozon-catalogue:{self._key()}", INTERVAL, send, max_wait=PATIENCE
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}

    async def cards(self, on_page=None) -> list[Card]:
        """Все товары кабинета, страницами."""
        found: list[Card] = []
        last_id = ""

        for _ in range(MAX_PAGES):
            body = await self._post(PRODUCT_LIST, {
                "filter": {"visibility": "ALL"},
                "limit": PAGE,
                "last_id": last_id,
            })
            result = body.get("result")
            result = result if isinstance(result, dict) else {}
            rows = result.get("items")
            rows = rows if isinstance(rows, list) else []
            if not rows:
                break

            страница = await self._describe(rows)
            found.extend(страница)
            if on_page is not None and страница:
                await on_page(страница)

            следующий = str(result.get("last_id") or "")
            if not следующий or следующий == last_id or len(rows) < PAGE:
                break
            last_id = следующий

        return found

    async def _describe(self, rows: list[dict[str, Any]]) -> list[Card]:
        """Добрать названия и картинки. Не вышло — отдаём то, что есть."""
        карточки: dict[str, Card] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            article = str(row.get("offer_id") or "").strip()
            if not article:
                continue
            product_id = str(row.get("product_id") or "").strip()
            if not product_id:
                continue
            карточки[article] = Card(
                article=article,
                name="",
                nm_id=f"{PREFIX}{product_id}",
                subject="",
                photos=(),
            )

        номера = [
            int(card.nm_id[len(PREFIX):])
            for card in карточки.values()
            if card.nm_id[len(PREFIX):].isdigit()
        ]
        for начало in range(0, len(номера), INFO_PAGE):
            кусок = номера[начало:начало + INFO_PAGE]
            try:
                body = await self._post(PRODUCT_INFO, {"product_id": кусок})
            except (RateLimited, httpx.HTTPError, ValueError) as exc:
                log.info("Ozon: подробности товаров недоступны (%s)", type(exc).__name__)
                break

            for item in self.as_list(body, "items", "result"):
                if not isinstance(item, dict):
                    continue
                article = str(item.get("offer_id") or "").strip()
                было = карточки.get(article)
                if было is None:
                    continue
                карточки[article] = Card(
                    article=article,
                    name=str(item.get("name") or "").strip(),
                    nm_id=было.nm_id,
                    brand="",
                    subject=self._category(item),
                    photos=self._photos(item),
                )

        return list(карточки.values())

    def _photos(self, item: dict[str, Any]) -> tuple[str, ...]:
        """Главная картинка первой, остальные следом."""
        found: list[str] = []
        главная = item.get("primary_image")
        if isinstance(главная, str) and главная:
            found.append(главная)
        elif isinstance(главная, list):
            found.extend(url for url in главная if isinstance(url, str) and url)

        # Картинки приходят то списком строк, то списком объектов —
        # площадка меняла это между версиями метода.
        images = item.get("images")
        for image in images if isinstance(images, list) else []:
            url = image
            if isinstance(image, dict):
                url = image.get("file_name") or image.get("url")
            if isinstance(url, str) and url and url not in found:
                found.append(url)
        return tuple(found)

    def _category(self, item: dict[str, Any]) -> str:
        """Категория товара. У Ozon это название типа товара."""
        for field in ("type_name", "description_category_name", "category_name"):
            value = item.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""
