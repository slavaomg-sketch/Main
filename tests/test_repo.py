"""Проверки слоя данных: подписки, отправки, статусы."""

from bot import repo


async def _employee(conn, tg_id=100, name="Иван Петров"):
    return await repo.upsert_user(conn, tg_id=tg_id, full_name=name, username="ivan", tz="UTC")


async def test_upsert_user_is_idempotent(conn):
    first = await _employee(conn)
    second = await repo.upsert_user(
        conn, tg_id=100, full_name="Иван Петров-Сидоров", username="ivan2", tz="UTC"
    )
    assert first["tg_id"] == second["tg_id"]
    assert second["full_name"] == "Иван Петров-Сидоров"
    assert len(await repo.list_users(conn)) == 1


async def test_mandatory_reminder_reaches_existing_and_new_employees(conn):
    admin = await repo.upsert_user(conn, tg_id=1, full_name="Босс", username=None, role="admin")
    await _employee(conn, 100)

    reminder_id = await repo.create_reminder(
        conn,
        title="Открытие смены",
        description=None,
        scope="global",
        owner_id=admin["tg_id"],
        default_time="09:00",
        days="1,2,3,4,5",
        is_mandatory=True,
    )
    assert await repo.subscribe_all_employees(conn, reminder_id, "09:00") == 2

    # Сотрудник, который пришёл позже, тоже получает обязательное напоминание.
    await _employee(conn, 200, "Пётр Новый")
    assert await repo.sync_mandatory_subscriptions(conn, 200) == 1

    subs = await repo.list_subscriptions(conn, 200)
    assert [s["title"] for s in subs] == ["Открытие смены"]
    assert subs[0]["time"] == "09:00"


async def test_employee_time_is_independent(conn):
    await repo.upsert_user(conn, tg_id=1, full_name="Босс", username=None, role="admin")
    await _employee(conn, 100)
    await _employee(conn, 200, "Пётр")
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "global", 1, "09:00", "1,2,3,4,5,6,7", True
    )
    await repo.subscribe(conn, 100, reminder_id, "09:00")
    sub_200 = await repo.subscribe(conn, 200, reminder_id, "09:00")

    await repo.set_subscription_time(conn, sub_200, "14:30")

    assert (await repo.list_subscriptions(conn, 100))[0]["time"] == "09:00"
    assert (await repo.list_subscriptions(conn, 200))[0]["time"] == "14:30"


async def test_delivery_is_not_duplicated_within_a_day(conn):
    await _employee(conn, 100)
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "personal", 100, "09:00", "1,2,3,4,5,6,7", False
    )
    sub_id = await repo.subscribe(conn, 100, reminder_id, "09:00")

    first = await repo.create_delivery(conn, sub_id, 100, reminder_id, "Обход", "2026-08-27", "09:00")
    second = await repo.create_delivery(conn, sub_id, 100, reminder_id, "Обход", "2026-08-27", "09:00")
    next_day = await repo.create_delivery(
        conn, sub_id, 100, reminder_id, "Обход", "2026-08-28", "09:00"
    )

    assert first is not None
    assert second is None, "повторная отправка в тот же день недопустима"
    assert next_day is not None


async def test_checklist_snapshot_and_status_transitions(conn):
    await _employee(conn, 100)
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "personal", 100, "09:00", "1,2,3,4,5,6,7", False
    )
    await repo.set_checklist(conn, reminder_id, ["Касса", "Журнал", "Фото"])
    sub_id = await repo.subscribe(conn, 100, reminder_id, "09:00")
    delivery_id = await repo.create_delivery(
        conn, sub_id, 100, reminder_id, "Обход", "2026-08-27", "09:00"
    )

    items = await repo.list_delivery_items(conn, delivery_id)
    assert [item["text"] for item in items] == ["Касса", "Журнал", "Фото"]

    assert await repo.refresh_delivery_status(conn, delivery_id) == "sent"

    await repo.toggle_delivery_item(conn, items[0]["id"])
    assert await repo.refresh_delivery_status(conn, delivery_id) == "partial"

    await repo.toggle_delivery_item(conn, items[1]["id"])
    await repo.toggle_delivery_item(conn, items[2]["id"])
    assert await repo.refresh_delivery_status(conn, delivery_id) == "done"

    # Снятая галочка возвращает статус в «частично».
    await repo.toggle_delivery_item(conn, items[2]["id"])
    assert await repo.refresh_delivery_status(conn, delivery_id) == "partial"


async def test_finalize_and_skip(conn):
    await _employee(conn, 100)
    reminder_id = await repo.create_reminder(
        conn, "Сверка", None, "personal", 100, "18:00", "1,2,3,4,5,6,7", False
    )
    sub_id = await repo.subscribe(conn, 100, reminder_id, "18:00")

    without_items = await repo.create_delivery(
        conn, sub_id, 100, reminder_id, "Сверка", "2026-08-27", "18:00"
    )
    assert await repo.finalize_delivery(conn, without_items) == "done"

    skipped = await repo.create_delivery(
        conn, sub_id, 100, reminder_id, "Сверка", "2026-08-28", "18:00"
    )
    await repo.skip_delivery(conn, skipped)
    delivery = await repo.get_delivery(conn, skipped)
    assert delivery["status"] == "missed"
    assert delivery["completed_at"] is not None


async def test_open_deliveries_close_as_missed(conn):
    await _employee(conn, 100)
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "personal", 100, "09:00", "1,2,3,4,5,6,7", False
    )
    sub_id = await repo.subscribe(conn, 100, reminder_id, "09:00")
    delivery_id = await repo.create_delivery(
        conn, sub_id, 100, reminder_id, "Обход", "2026-08-27", "09:00"
    )

    assert await repo.close_open_deliveries(conn, "2026-08-27") == 1
    assert (await repo.get_delivery(conn, delivery_id))["status"] == "missed"


async def test_deleting_reminder_keeps_history(conn):
    await _employee(conn, 100)
    reminder_id = await repo.create_reminder(
        conn, "Обход", None, "personal", 100, "09:00", "1,2,3,4,5,6,7", False
    )
    sub_id = await repo.subscribe(conn, 100, reminder_id, "09:00")
    await repo.create_delivery(conn, sub_id, 100, reminder_id, "Обход", "2026-08-27", "09:00")

    await repo.delete_reminder(conn, reminder_id)

    assert await repo.list_subscriptions(conn, 100) == []
    assert len(await repo.deliveries_for_date(conn, "2026-08-27")) == 1, "история должна сохраниться"
