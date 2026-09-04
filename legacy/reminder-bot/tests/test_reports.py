"""Проверки содержимого отчётов."""

from bot import repo, reports


async def _deliver(conn, user_id, title, time, items, date="2026-08-27"):
    reminder_id = await repo.create_reminder(
        conn, title, None, "personal", user_id, time, "1,2,3,4,5,6,7", False
    )
    await repo.set_checklist(conn, reminder_id, list(items))
    sub_id = await repo.subscribe(conn, user_id, reminder_id, time)
    delivery_id = await repo.create_delivery(conn, sub_id, user_id, reminder_id, title, date, time)
    await repo.mark_delivery_sent(conn, delivery_id, message_id=1)
    return delivery_id


async def test_empty_day_report(conn):
    text = await reports.build_daily_report(conn, "2026-08-27")
    assert "напоминаний не отправлялось" in text


async def test_report_counts_statuses_and_lists_undone_items(conn):
    await repo.upsert_user(conn, tg_id=100, full_name="Иван Петров", username="ivan", tz="UTC")

    done = await _deliver(conn, 100, "Открытие смены", "09:00", ["Касса", "Свет"])
    for item in await repo.list_delivery_items(conn, done):
        await repo.toggle_delivery_item(conn, item["id"])
    await repo.finalize_delivery(conn, done)

    partial = await _deliver(conn, 100, "Обход зала", "13:00", ["Витрина", "Склад", "Журнал"])
    items = await repo.list_delivery_items(conn, partial)
    await repo.toggle_delivery_item(conn, items[0]["id"])
    await repo.finalize_delivery(conn, partial)

    await _deliver(conn, 100, "Вечерняя сверка", "20:00", ["Инкассация"])
    await repo.close_open_deliveries(conn, "2026-08-27")

    text = await reports.build_daily_report(conn, "2026-08-27")

    assert "Всего напоминаний: <b>3</b>" in text
    assert "✅ Выполнено полностью: <b>1</b>" in text
    assert "🟡 Частично: <b>1</b>" in text
    assert "❌ Не отмечено: <b>1</b>" in text
    assert "Иван Петров" in text
    # Невыполненные пункты названы поимённо — это главное для разбора с сотрудником.
    assert "Склад" in text
    assert "Журнал" in text
    assert "Инкассация" in text


async def test_report_separates_employees(conn):
    await repo.upsert_user(conn, tg_id=100, full_name="Иван", username=None, tz="UTC")
    await repo.upsert_user(conn, tg_id=200, full_name="Мария", username=None, tz="UTC")
    await _deliver(conn, 100, "Обход", "09:00", ["Касса"])
    await _deliver(conn, 200, "Отчёт", "10:00", ["Сводка"])

    text = await reports.build_daily_report(conn, "2026-08-27")
    assert "👤 <b>Иван</b>" in text
    assert "👤 <b>Мария</b>" in text


async def test_report_mentions_employees_without_reminders(conn):
    await repo.upsert_user(conn, tg_id=100, full_name="Иван", username=None, tz="UTC")
    await repo.upsert_user(conn, tg_id=200, full_name="Без задач", username=None, tz="UTC")
    await _deliver(conn, 100, "Обход", "09:00", ["Касса"])

    text = await reports.build_daily_report(conn, "2026-08-27")
    assert "Без напоминаний в этот день" in text
    assert "Без задач" in text


async def test_user_summary(conn):
    await repo.upsert_user(conn, tg_id=100, full_name="Иван", username=None, tz="UTC")
    assert "Пока нет ни одного" in await reports.build_user_summary(conn, 100)


def test_chunk_splits_long_text_without_breaking_lines():
    text = "\n".join(f"строка номер {index}" for index in range(1000))
    parts = reports.chunk(text, limit=500)

    assert len(parts) > 1
    assert all(len(part) <= 500 for part in parts)
    assert "\n".join(parts) == text


def test_chunk_keeps_short_text_intact():
    assert reports.chunk("коротко") == ["коротко"]


async def test_report_shows_employee_comments(conn):
    await repo.upsert_user(conn, tg_id=100, full_name="Иван Петров", username=None, tz="UTC")

    partial = await _deliver(conn, 100, "Обход зала", "13:00", ["Витрина", "Склад"])
    items = await repo.list_delivery_items(conn, partial)
    await repo.toggle_delivery_item(conn, items[0]["id"])
    await repo.set_delivery_comment(conn, partial, "Склад был закрыт, ключи у Сергея")
    await repo.finalize_delivery(conn, partial)

    text = await reports.build_daily_report(conn, "2026-08-27")

    assert "💬 С пояснением сотрудника: <b>1</b>" in text
    assert "Склад был закрыт, ключи у Сергея" in text
    assert "◻️ Склад" in text


async def test_comment_is_escaped_in_report(conn):
    """Сотрудник может написать что угодно — разметка не должна ломаться."""
    await repo.upsert_user(conn, tg_id=100, full_name="Иван", username=None, tz="UTC")
    delivery_id = await _deliver(conn, 100, "Обход", "09:00", ["Касса"])
    await repo.set_delivery_comment(conn, delivery_id, "<b>сломать</b> & разметку")

    text = await reports.build_daily_report(conn, "2026-08-27")
    assert "&lt;b&gt;сломать&lt;/b&gt; &amp; разметку" in text
