"""Планировщик: рассылка напоминаний, повторные толчки и вечерний отчёт."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import aiosqlite
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from bot import repo, reports
from bot.config import Config
from bot.keyboards import delivery_keyboard
from bot.messages import render_delivery, render_nudge
from bot.utils import now_utc, parse_time, parse_utc, tz_or_default

log = logging.getLogger(__name__)


class ReminderScheduler:
    """Раз в минуту проверяет, что пора отправить, и что пора закрыть."""

    def __init__(self, bot: Bot, conn: aiosqlite.Connection, config: Config) -> None:
        self.bot = bot
        self.conn = conn
        self.config = config
        self.scheduler = AsyncIOScheduler(timezone="UTC")

    def start(self) -> None:
        self.scheduler.add_job(
            self.tick,
            "interval",
            seconds=60,
            id="tick",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=120,
        )
        self.scheduler.start()
        log.info("Планировщик запущен (проверка каждую минуту)")

    async def shutdown(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    async def tick(self) -> None:
        try:
            await self.send_due_reminders()
        except Exception:
            log.exception("Ошибка при рассылке напоминаний")
        try:
            await self.send_nudges()
        except Exception:
            log.exception("Ошибка при отправке повторных напоминаний")
        try:
            await self.send_daily_reports()
        except Exception:
            log.exception("Ошибка при отправке отчёта")

    # ------------------------------------------------------------------ рассылка

    async def send_due_reminders(self) -> int:
        candidates = await repo.due_candidates(self.conn)
        sent = 0

        for candidate in candidates:
            local_now = now_utc().astimezone(tz_or_default(candidate["tz"], self.config.default_tz))
            if local_now.isoweekday() not in repo.subscription_days(candidate):
                continue

            planned = parse_time(candidate["time"])
            if not planned:
                log.warning("Подписка %s: некорректное время %r", candidate["sub_id"], candidate["time"])
                continue

            hour, minute = (int(part) for part in planned.split(":"))
            scheduled_at = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            delay = (local_now - scheduled_at).total_seconds() / 60
            if not 0 <= delay <= self.config.catchup_minutes:
                continue

            delivery_id = await repo.create_delivery(
                self.conn,
                sub_id=candidate["sub_id"],
                user_id=candidate["user_id"],
                reminder_id=candidate["reminder_id"],
                title=candidate["title"],
                local_date=local_now.strftime("%Y-%m-%d"),
                scheduled_time=planned,
            )
            if delivery_id is None:  # уже отправляли сегодня
                continue

            if await self._deliver(candidate, delivery_id, planned):
                sent += 1

        if sent:
            log.info("Отправлено напоминаний: %s", sent)
        return sent

    async def _deliver(self, candidate: aiosqlite.Row, delivery_id: int, planned: str) -> bool:
        items = await repo.list_delivery_items(self.conn, delivery_id)
        text = render_delivery(
            title=candidate["title"],
            description=candidate["description"],
            items=items,
            scheduled_time=planned,
        )
        try:
            message = await self.bot.send_message(
                chat_id=candidate["user_id"],
                text=text,
                reply_markup=delivery_keyboard(delivery_id, items),
            )
        except TelegramForbiddenError:
            log.warning("Сотрудник %s заблокировал бота", candidate["user_id"])
            await repo.mark_delivery_failed(self.conn, delivery_id)
            return False
        except TelegramAPIError as error:
            log.error("Не удалось отправить напоминание %s: %s", delivery_id, error)
            await repo.mark_delivery_failed(self.conn, delivery_id)
            return False

        await repo.mark_delivery_sent(self.conn, delivery_id, message.message_id)
        return True

    # ---------------------------------------------------------- повторный толчок

    async def send_nudges(self) -> int:
        if self.config.nudge_after_minutes <= 0:
            return 0

        threshold = now_utc() - timedelta(minutes=self.config.nudge_after_minutes)
        count = 0

        for delivery in await repo.pending_deliveries(self.conn):
            sent_at = parse_utc(delivery["sent_at"])
            if not sent_at or sent_at > threshold:
                continue
            try:
                await self.bot.send_message(
                    chat_id=delivery["user_id"],
                    text=render_nudge(delivery["title"], delivery["scheduled_time"]),
                    reply_to_message_id=delivery["chat_message_id"],
                    allow_sending_without_reply=True,
                )
            except TelegramAPIError as error:
                log.warning("Повторное напоминание %s не ушло: %s", delivery["id"], error)
            finally:
                await repo.mark_nudged(self.conn, delivery["id"])
            count += 1
        return count

    # -------------------------------------------------------------------- отчёты

    async def send_daily_reports(self) -> int:
        report_time = parse_time(self.config.report_time) or "20:00"
        hour, minute = (int(part) for part in report_time.split(":"))
        count = 0

        for admin in await repo.list_users(self.conn, role="admin", only_active=True):
            local_now = now_utc().astimezone(tz_or_default(admin["tz"], self.config.default_tz))
            due_at = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if local_now < due_at:
                continue

            local_date = local_now.strftime("%Y-%m-%d")
            if await repo.report_already_sent(self.conn, admin["tg_id"], local_date):
                continue

            await repo.close_open_deliveries(self.conn, local_date)
            await self.deliver_report(admin["tg_id"], local_date)
            await repo.mark_report_sent(self.conn, admin["tg_id"], local_date)
            count += 1

        return count

    async def deliver_report(self, admin_id: int, local_date: str) -> None:
        text = await reports.build_daily_report(self.conn, local_date)
        for part in reports.chunk(text):
            try:
                await self.bot.send_message(chat_id=admin_id, text=part)
            except TelegramAPIError as error:
                log.error("Отчёт администратору %s не доставлен: %s", admin_id, error)
                return
        log.info("Отчёт за %s отправлен администратору %s", local_date, admin_id)


def local_date_for(tz_name: str | None, default_tz: str, offset_days: int = 0) -> str:
    """Дата в поясе пользователя со смещением назад на offset_days."""
    moment: datetime = now_utc().astimezone(tz_or_default(tz_name, default_tz))
    return (moment - timedelta(days=offset_days)).strftime("%Y-%m-%d")
