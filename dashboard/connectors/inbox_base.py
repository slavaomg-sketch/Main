"""Общее устройство входящих: одно обращение и одна глава.

Обращения у площадок разные — отзыв Wildberries, вопрос Ozon, чат Яндекса, —
но панели и помощнику они нужны в одном виде: кто, когда, о чём, к какому
товару и куда отвечать. Всё, что специфично для площадки, живёт в её
собственном коннекторе; здесь только общая форма.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# Виды обращений, общие для всех площадок. Название главы у каждой площадки
# своё (у Wildberries «Заявки на возврат», у Ozon такого нет вовсе), а вид —
# общий, чтобы помощник знал, каким тоном отвечать.
FEEDBACK = "feedback"
QUESTION = "question"
CLAIM = "claim"
CHAT = "chat"


@dataclass
class InboxItem:
    """Одно обращение покупателя, приведённое к общему виду."""

    kind: str                       # feedback | question | claim | chat
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
    marketplace: str = ""

    @property
    def urgent(self) -> bool:
        """Требует человека: низкая оценка или заявка на возврат."""
        return self.kind == CLAIM or (self.kind == FEEDBACK and 0 < self.rating <= 3)

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
            "marketplace": self.marketplace,
            "urgent": self.urgent,
        }
