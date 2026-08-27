"""Мидлвари: регистрация пользователя и подстановка его записи в хендлеры."""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

import aiosqlite
from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject, Update, User

from bot import repo
from bot.config import Config

log = logging.getLogger(__name__)


class UserMiddleware(BaseMiddleware):
    """Создаёт запись сотрудника при первом обращении и кладёт её в data['user'].

    Регистрируется как outer-мидлварь на observer'е update: тогда 'user' и
    'is_admin' попадают в данные до того, как роутеры начнут проверять фильтры
    (админка отсеивает чужих именно фильтром уровня роутера).
    """

    def __init__(self, config: Config) -> None:
        self.config = config

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        tg_user: User | None = data.get("event_from_user")
        if tg_user is None or tg_user.is_bot:
            return await handler(event, data)

        conn: aiosqlite.Connection = data["conn"]

        user = await repo.get_user(conn, tg_user.id)
        full_name = tg_user.full_name or tg_user.username or str(tg_user.id)

        if user is None:
            role = "admin" if tg_user.id in self.config.admin_ids else "employee"
            user = await repo.upsert_user(
                conn=conn,
                tg_id=tg_user.id,
                full_name=full_name,
                username=tg_user.username,
                role=role,
                tz=self.config.default_tz,
            )
            added = await repo.sync_mandatory_subscriptions(conn, tg_user.id)
            log.info(
                "Новый пользователь %s (%s), роль %s, обязательных напоминаний: %s",
                full_name,
                tg_user.id,
                role,
                added,
            )
        elif user["full_name"] != full_name or user["username"] != tg_user.username:
            user = await repo.upsert_user(
                conn=conn,
                tg_id=tg_user.id,
                full_name=full_name,
                username=tg_user.username,
                role=user["role"],
                tz=user["tz"],
            )

        # Права из .env имеют приоритет над тем, что записано в базе.
        if tg_user.id in self.config.admin_ids and user["role"] != "admin":
            await repo.set_user_role(conn, tg_user.id, "admin")
            user = await repo.get_user(conn, tg_user.id)

        if user is not None and not user["is_active"]:
            await self._refuse(event)
            return None

        data["user"] = user
        data["is_admin"] = user is not None and user["role"] == "admin"
        return await handler(event, data)

    @staticmethod
    async def _refuse(event: TelegramObject) -> None:
        """Сообщает отключённому сотруднику, что доступа больше нет."""
        text = "⛔️ Ваш доступ к боту отключён администратором."
        inner = event.event if isinstance(event, Update) else event
        if isinstance(inner, Message):
            await inner.answer(text)
        elif isinstance(inner, CallbackQuery):
            await inner.answer(text, show_alert=True)
