"""Товары: каталог глазами владельца.

Раздел отдельный от справочника ответов, и это не прихоть оформления.
Справочник — про то, что помощник говорит покупателю. Товары — про то,
что покупатель видит на площадке: фотографии, оценка, отзывы. Задачи
разные, и мешать их в одном окне не стоит.

Устройство трёхуровневое:

    товар (родитель)  →  его карточки  →  одна карточка

У одного товара карточек бывает несколько сотен: кабель Type-C продаётся
«для Samsung», «для Tecno» и так далее. Пройти их глазами — единственный
способ заметить, что где-то не то фото или пропало описание.

Оценка и число отзывов спрашиваются у площадки по требованию, когда
владелец открывает карточку: спрашивать их для всех двадцати трёх тысяч
разом никакого смысла нет.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from . import connections, db, knowledge
from .config import Settings, settings
from .connectors.wb_feedback_rating import WildberriesRating

# Сколько карточек показываем за раз.
PAGE = 60


@dataclass(frozen=True)
class Card:
    """Карточка товара в том виде, в каком её показывает панель."""

    nm_id: str
    parent: str
    article: str
    title: str
    brand: str
    subject: str
    photo: str
    photos: tuple[str, ...]
    rating: float
    feedbacks: int
    note: str
    connection_id: str

    @property
    def rating_known(self) -> bool:
        """Спрашивали ли мы уже оценку. Ноль отзывов и «не спрашивали» —
        разные вещи, и путать их нельзя."""
        return self.feedbacks >= 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "nmId": self.nm_id,
            "parent": self.parent,
            "article": self.article,
            "title": self.title,
            "brand": self.brand,
            "subject": self.subject,
            "photo": self.photo,
            "photos": list(self.photos),
            "photoCount": len(self.photos),
            "rating": self.rating,
            "feedbacks": self.feedbacks,
            "ratingKnown": self.rating_known,
            "note": self.note,
            "accountId": self.connection_id,
        }


def _card(row) -> Card:
    photos = tuple(part for part in (row["photos"] or "").split("\n") if part)
    return Card(
        nm_id=row["nm_id"],
        parent=row["parent"] or "",
        article=row["article"] or "",
        title=row["title"] or "",
        brand=row["brand"] or "",
        subject=row["subject"] or "",
        photo=row["photo"] or "",
        photos=photos,
        rating=float(row["rating"] or 0),
        feedbacks=int(row["feedbacks"] if row["feedbacks"] is not None else -1),
        note=row["note"] or "",
        connection_id=row["connection_id"] or "",
    )


async def save_cards(connection_id: str, cards: list) -> int:
    """Записать карточки кабинета. Правки владельца при этом не трогаются."""
    if not cards:
        return 0

    now = datetime.now().isoformat(timespec="seconds")
    async with db.connect() as connection:
        for card in cards:
            nm_id = str(getattr(card, "nm_id", "") or "").strip()
            if not nm_id:
                continue
            await connection.execute(
                """
                INSERT INTO product_cards
                    (nm_id, connection_id, parent, article, title, brand, subject,
                     photo, photos, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(nm_id) DO UPDATE SET
                    connection_id = excluded.connection_id,
                    parent = excluded.parent,
                    article = excluded.article,
                    title = excluded.title,
                    brand = excluded.brand,
                    subject = excluded.subject,
                    photo = excluded.photo,
                    photos = excluded.photos,
                    updated_at = excluded.updated_at
                """,
                (
                    nm_id, connection_id, knowledge.parent_of(card.article),
                    card.article, card.name, getattr(card, "brand", ""),
                    getattr(card, "subject", ""), card.photo,
                    "\n".join(card.photos), now,
                ),
            )
        await connection.commit()
    return len(cards)


async def parents() -> list[dict[str, Any]]:
    """Список товаров с картинкой и числом карточек — верхний уровень."""
    known = {item.parent: item for item in await knowledge.all_parents()}

    async with db.connect() as connection:
        cursor = await connection.execute(
            """
            SELECT parent,
                   COUNT(*) AS cards,
                   SUM(CASE WHEN photo = '' THEN 1 ELSE 0 END) AS without_photo,
                   SUM(CASE WHEN TRIM(note) <> '' THEN 1 ELSE 0 END) AS noted,
                   MAX(photo) AS photo,
                   MIN(title) AS sample
              FROM product_cards
             WHERE parent <> ''
             GROUP BY parent
             ORDER BY cards DESC, parent
            """
        )
        rows = await cursor.fetchall()

    found = []
    for row in rows:
        facts = known.get(row["parent"])
        found.append({
            "parent": row["parent"],
            "title": facts.title if facts else "",
            "sample": (facts.sample if facts and facts.sample else row["sample"]) or "",
            "cards": int(row["cards"] or 0),
            "withoutPhoto": int(row["without_photo"] or 0),
            "noted": int(row["noted"] or 0),
            "photo": row["photo"] or "",
            "described": bool(facts and facts.filled),
        })
    return found


async def cards_of(parent: str, offset: int = 0, limit: int = PAGE) -> dict[str, Any]:
    """Карточки одного товара."""
    parent = (parent or "").strip().upper()
    limit = max(1, min(int(limit or PAGE), PAGE))
    offset = max(0, int(offset or 0))

    async with db.connect() as connection:
        counter = await connection.execute(
            "SELECT COUNT(*) AS total FROM product_cards WHERE parent = ?", (parent,)
        )
        total = int((await counter.fetchone())["total"] or 0)

        cursor = await connection.execute(
            """
            SELECT * FROM product_cards
             WHERE parent = ?
             ORDER BY article, nm_id
             LIMIT ? OFFSET ?
            """,
            (parent, limit, offset),
        )
        rows = await cursor.fetchall()

    facts = await knowledge.get(parent)
    return {
        "parent": parent,
        "title": facts.title if facts else "",
        "total": total,
        "offset": offset,
        "cards": [_card(row).to_dict() for row in rows],
        "more": offset + len(rows) < total,
    }


async def card(nm_id: str) -> Card | None:
    async with db.connect() as connection:
        cursor = await connection.execute(
            "SELECT * FROM product_cards WHERE nm_id = ?", (str(nm_id),)
        )
        row = await cursor.fetchone()
    return _card(row) if row else None


async def save_note(nm_id: str, note: str) -> Card | None:
    """Записать правку по карточке — что в ней надо поменять."""
    async with db.connect() as connection:
        await connection.execute(
            "UPDATE product_cards SET note = ? WHERE nm_id = ?",
            (str(note or "").strip()[:2000], str(nm_id)),
        )
        await connection.commit()
    return await card(nm_id)


async def rating(nm_id: str, config: Settings | None = None) -> Card | None:
    """Спросить у площадки оценку и число отзывов по карточке.

    Спрашиваем по требованию: у владельца двадцать три тысячи карточек,
    и опрашивать их все — недели работы впустую.
    """
    config = config or settings
    known = await card(nm_id)
    if known is None:
        return None

    store = await connections.get(known.connection_id, config)
    if store is None:
        return known

    source = WildberriesRating(store.credentials(config))
    valuation, feedbacks = await source.product_rating(nm_id)
    if feedbacks < 0:
        return known   # площадка не ответила — прежние данные не портим

    async with db.connect() as connection:
        await connection.execute(
            "UPDATE product_cards SET rating = ?, feedbacks = ? WHERE nm_id = ?",
            (valuation, feedbacks, str(nm_id)),
        )
        await connection.commit()
    return await card(nm_id)


async def notes() -> list[dict[str, Any]]:
    """Все карточки, по которым владелец написал правки."""
    async with db.connect() as connection:
        cursor = await connection.execute(
            """
            SELECT * FROM product_cards
             WHERE TRIM(note) <> ''
             ORDER BY parent, article
            """
        )
        rows = await cursor.fetchall()
    return [_card(row).to_dict() for row in rows]
