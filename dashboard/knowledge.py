"""База знаний о товарах: что панель знает о каждом «родителе».

Зачем. Один и тот же физический товар — скажем, кабель USB Type-C 1 м
белый — продаётся тысячей карточек: «для Samsung S24», «для Tecno Spark
Go 3» и так далее. Карточек тысяча, а товар один, и характеристики у него
одни. Помощнику неоткуда их взять: в обращении покупателя их нет, а
выдумывать ему запрещено — поэтому он честно отвечает «нужен человек».

Владелец заполняет справку один раз на родителя, и она едет в запрос
вместе с обращением. После этого на вопрос «сколько вольт» помощник
отвечает сам, а не зовёт человека.

Откуда берётся родитель. В артикулах владельца он вынесен в скобки:

    CAB-PH-UA-TC-1M-WH-(UA-TC-1M-WH)-TECNO-SPARKGO3
                       ^^^^^^^^^^^^^  вот он

Если скобок нет, родителем считается сам артикул: лучше одна справка на
карточку, чем ошибочно склеенные разные товары.

Что важно про доверие. Справку пишет владелец — это надёжные данные.
Текст покупателя приходит от постороннего человека. В запросе к помощнику
они лежат в разных блоках, и подменить справку через текст обращения
нельзя.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from . import db

# Родитель вынесен в скобки. Берём первую пару — вложенных скобок в
# артикулах не встречается.
IN_BRACKETS = re.compile(r"\(([^()]+)\)")

# Сколько знаков справки отдаём помощнику. Больше в ответ покупателю всё
# равно не поместится, а длинный запрос только размывает правила.
MAX_FACTS = 2000


@dataclass(frozen=True)
class Facts:
    """Справка об одном родителе.

    `title` — как товар называет владелец, своими словами. `sample` — как
    его называет площадка в одной из карточек: по нему товар легко узнать
    в лицо, но для общения оно не годится.
    """

    parent: str
    title: str = ""
    facts: str = ""
    updated_at: str = ""
    cards: int = 0
    sample: str = ""
    # Главное изображение любой из карточек товара. Назвать своими словами
    # товар, которого не видишь, нельзя — а именно это справочник и просит.
    photo: str = ""

    @property
    def filled(self) -> bool:
        return bool(self.facts.strip())

    def to_dict(self) -> dict[str, Any]:
        return {
            "parent": self.parent,
            "title": self.title,
            "facts": self.facts,
            "filled": self.filled,
            "named": bool(self.title.strip()),
            "cards": self.cards,
            "sample": self.sample,
            "photo": self.photo,
            "updatedAt": self.updated_at,
        }


def parent_of(article: str) -> str:
    """Родитель по артикулу карточки."""
    article = (article or "").strip()
    if not article:
        return ""
    found = IN_BRACKETS.search(article)
    return (found.group(1) if found else article).strip().upper()


async def remember(articles: list[str], names: dict[str, str] | None = None) -> None:
    """Отметить, что такие родители существуют.

    Ни справка, ни название владельца не трогаются. Имя, под которым товар
    известен площадке, кладётся в отдельное поле `sample`: оно помогает
    узнать товар в лицо, но названием для общения не является — его
    владелец пишет сам.
    """
    names = names or {}
    parents = {parent_of(article) for article in articles if article}
    parents.discard("")
    if not parents:
        return

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    async with db.connect() as connection:
        for parent in sorted(parents):
            await connection.execute(
                """
                INSERT INTO product_facts (parent, title, facts, updated_at, sample)
                VALUES (?, '', '', ?, ?)
                ON CONFLICT(parent) DO UPDATE SET
                    sample = CASE WHEN product_facts.sample = ''
                                  THEN excluded.sample ELSE product_facts.sample END
                """,
                (parent, now, names.get(parent, "")),
            )
        await connection.commit()


async def get(parent: str) -> Facts | None:
    parent = (parent or "").strip().upper()
    if not parent:
        return None
    async with db.connect() as connection:
        cursor = await connection.execute(
            """
            SELECT parent, title, facts, updated_at, cards, sample
            FROM product_facts WHERE parent = ?
            """,
            (parent,),
        )
        row = await cursor.fetchone()
    if row is None:
        return None
    return Facts(
        parent=row["parent"], title=row["title"] or "",
        facts=row["facts"] or "", updated_at=row["updated_at"] or "",
        cards=int(row["cards"] or 0), sample=row["sample"] or "",
    )


async def for_article(article: str) -> str:
    """Текст справки для товара — то, что поедет помощнику."""
    found = await get(parent_of(article))
    return found.facts.strip()[:MAX_FACTS] if found else ""


async def save(parent: str, title: str, facts: str) -> Facts:
    parent = (parent or "").strip().upper()
    if not parent:
        raise ValueError("не указан родитель")

    title = str(title or "").strip()[:200]
    facts = str(facts or "").strip()[:MAX_FACTS * 4]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    async with db.connect() as connection:
        await connection.execute(
            """
            INSERT INTO product_facts (parent, title, facts, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(parent) DO UPDATE SET
                title = excluded.title,
                facts = excluded.facts,
                updated_at = excluded.updated_at
            """,
            (parent, title, facts, now),
        )
        await connection.commit()

    return Facts(parent=parent, title=title, facts=facts, updated_at=now)


async def all_parents(account_id: str = "") -> list[Facts]:
    """Все известные родители.

    Сверху — те, которым владелец ещё не дал название, и среди них первыми
    товары с наибольшим числом карточек: их описание окупается сильнее всего.

    `account_id` сужает список до товаров одного кабинета. Сама справка при
    этом общая: товар физически один, и характеристики у него одни, в каком
    бы кабинете он ни продавался. Иначе владельцу пришлось бы описывать
    один и тот же кабель дважды.
    """
    account_id = (account_id or "").strip()
    условие = ""
    значения: list[str] = []
    if account_id:
        условие = """
             WHERE f.parent IN (SELECT DISTINCT parent FROM product_cards
                                 WHERE connection_id = ? AND parent <> '')
        """
        значения = [account_id]

    async with db.connect() as connection:
        cursor = await connection.execute(
            f"""
            SELECT f.parent, f.title, f.facts, f.updated_at, f.cards, f.sample,
                   (SELECT MAX(c.photo) FROM product_cards c
                     WHERE c.parent = f.parent AND c.photo <> '') AS photo
              FROM product_facts f
            {условие}
            ORDER BY CASE WHEN TRIM(f.title) = '' THEN 0 ELSE 1 END,
                     f.cards DESC, f.parent
            """,
            значения,
        )
        rows = await cursor.fetchall()
    return [
        Facts(
            parent=row["parent"], title=row["title"] or "",
            facts=row["facts"] or "", updated_at=row["updated_at"] or "",
            cards=int(row["cards"] or 0), sample=row["sample"] or "",
            photo=row["photo"] or "",
        )
        for row in rows
    ]
