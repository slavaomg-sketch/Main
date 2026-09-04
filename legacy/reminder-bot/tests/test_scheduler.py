"""Проверки планировщика: что уходит, когда и ровно один раз."""

from datetime import datetime, timedelta, timezone

from bot import repo
from bot.config import Config
from bot.scheduler import ReminderScheduler, local_date_for


def _config(tmp_path, **overrides) -> Config:
    base = dict(
        bot_token="test:token",
        admin_ids=[1],
        db_path=tmp_path / "test.db",
        default_tz="UTC",
        report_time="20:00",
        nudge_after_minutes=60,
        catchup_minutes=15,
    )
    base.update(overrides)
    return Config(**base)


async def _setup(conn, time_utc: str, days: str = "1,2,3,4,5,6,7", items=("Касса", "Журнал")):
    await repo.upsert_user(conn, tg_id=100, full_name="Иван", username="ivan", tz="UTC")
    reminder_id = await repo.create_reminder(
        conn, "Утренний обход", "Пройти по точкам", "personal", 100, time_utc, days, False
    )
    await repo.set_checklist(conn, reminder_id, list(items))
    await repo.subscribe(conn, 100, reminder_id, time_utc)
    return reminder_id


def _now_hhmm(offset_minutes: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=offset_minutes)).strftime("%H:%M")


async def test_due_reminder_is_sent_once(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm())
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path))

    assert await scheduler.send_due_reminders() == 1
    assert await scheduler.send_due_reminders() == 0, "повторной отправки быть не должно"

    assert len(fake_bot.sent) == 1
    message = fake_bot.sent[0]
    assert message["chat_id"] == 100
    assert "Утренний обход" in message["text"]
    assert "Касса" in message["text"]
    assert message["reply_markup"] is not None


async def test_future_reminder_is_not_sent(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm(offset_minutes=30))
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path))

    assert await scheduler.send_due_reminders() == 0
    assert fake_bot.sent == []


async def test_stale_reminder_outside_catchup_window_is_skipped(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm(offset_minutes=-45))
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path, catchup_minutes=15))

    assert await scheduler.send_due_reminders() == 0


async def test_reminder_within_catchup_window_still_arrives(conn, fake_bot, tmp_path):
    """Бот перезапустили — напоминание всё равно уходит, если опоздание невелико."""
    await _setup(conn, _now_hhmm(offset_minutes=-5))
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path, catchup_minutes=15))

    assert await scheduler.send_due_reminders() == 1


async def test_wrong_weekday_is_skipped(conn, fake_bot, tmp_path):
    today = datetime.now(timezone.utc).isoweekday()
    other_days = ",".join(str(day) for day in range(1, 8) if day != today)
    await _setup(conn, _now_hhmm(), days=other_days)
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path))

    assert await scheduler.send_due_reminders() == 0


async def test_paused_subscription_is_skipped(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm())
    subs = await repo.list_subscriptions(conn, 100)
    await repo.set_subscription_active(conn, subs[0]["id"], False)

    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path))
    assert await scheduler.send_due_reminders() == 0


async def test_blocked_employee_is_skipped(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm())
    await repo.set_user_active(conn, 100, False)

    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path))
    assert await scheduler.send_due_reminders() == 0


async def test_nudge_sent_only_for_unanswered_reminders(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm())
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path, nudge_after_minutes=30))
    await scheduler.send_due_reminders()

    # Сдвигаем время отправки в прошлое, чтобы наступил момент напомнить повторно.
    past = (datetime.now(timezone.utc) - timedelta(minutes=45)).strftime("%Y-%m-%d %H:%M:%S")
    await conn.execute("UPDATE deliveries SET sent_at = ?", (past,))
    await conn.commit()

    assert await scheduler.send_nudges() == 1
    assert "не закрыто" in fake_bot.sent[-1]["text"]
    assert await scheduler.send_nudges() == 0, "повторный толчок шлём только один раз"


async def test_nudge_disabled_by_config(conn, fake_bot, tmp_path):
    await _setup(conn, _now_hhmm())
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path, nudge_after_minutes=0))
    await scheduler.send_due_reminders()

    past = (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S")
    await conn.execute("UPDATE deliveries SET sent_at = ?", (past,))
    await conn.commit()

    assert await scheduler.send_nudges() == 0


async def test_daily_report_goes_to_admin_once(conn, fake_bot, tmp_path):
    await repo.upsert_user(conn, tg_id=1, full_name="Босс", username=None, role="admin", tz="UTC")
    await _setup(conn, _now_hhmm())
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path, report_time="00:00"))
    await scheduler.send_due_reminders()
    fake_bot.sent.clear()

    assert await scheduler.send_daily_reports() == 1
    assert await scheduler.send_daily_reports() == 0, "отчёт за день отправляется один раз"

    report = fake_bot.sent[0]
    assert report["chat_id"] == 1
    assert "Отчёт за" in report["text"]
    assert "Иван" in report["text"]


async def test_unanswered_reminders_are_closed_when_report_is_built(conn, fake_bot, tmp_path):
    await repo.upsert_user(conn, tg_id=1, full_name="Босс", username=None, role="admin", tz="UTC")
    await _setup(conn, _now_hhmm())
    scheduler = ReminderScheduler(fake_bot, conn, _config(tmp_path, report_time="00:00"))
    await scheduler.send_due_reminders()

    await scheduler.send_daily_reports()

    today = local_date_for("UTC", "UTC")
    deliveries = await repo.deliveries_for_date(conn, today)
    assert [d["status"] for d in deliveries] == ["missed"]
