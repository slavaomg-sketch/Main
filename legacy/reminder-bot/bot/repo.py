"""Доступ к данным. Все функции принимают открытое соединение aiosqlite."""

from __future__ import annotations

from typing import Any, Iterable, Sequence

import aiosqlite

from bot.utils import parse_days, utc_iso

Row = aiosqlite.Row

# ---------------------------------------------------------------- пользователи


async def upsert_user(
    conn: aiosqlite.Connection,
    tg_id: int,
    full_name: str,
    username: str | None,
    role: str = "employee",
    tz: str = "Europe/Moscow",
) -> Row:
    """Создаёт сотрудника или обновляет его имя/логин при повторном /start."""
    await conn.execute(
        """
        INSERT INTO users (tg_id, username, full_name, role, tz, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (tg_id) DO UPDATE SET
            username  = excluded.username,
            full_name = excluded.full_name,
            is_active = 1
        """,
        (tg_id, username, full_name, role, tz, utc_iso()),
    )
    await conn.commit()
    user = await get_user(conn, tg_id)
    assert user is not None
    return user


async def get_user(conn: aiosqlite.Connection, tg_id: int) -> Row | None:
    async with conn.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,)) as cur:
        return await cur.fetchone()


async def set_user_tz(conn: aiosqlite.Connection, tg_id: int, tz: str) -> None:
    await conn.execute("UPDATE users SET tz = ? WHERE tg_id = ?", (tz, tg_id))
    await conn.commit()


async def set_user_role(conn: aiosqlite.Connection, tg_id: int, role: str) -> None:
    await conn.execute("UPDATE users SET role = ? WHERE tg_id = ?", (role, tg_id))
    await conn.commit()


async def set_user_active(conn: aiosqlite.Connection, tg_id: int, is_active: bool) -> None:
    await conn.execute(
        "UPDATE users SET is_active = ? WHERE tg_id = ?", (1 if is_active else 0, tg_id)
    )
    await conn.commit()


async def list_users(
    conn: aiosqlite.Connection, role: str | None = None, only_active: bool = True
) -> list[Row]:
    sql = "SELECT * FROM users WHERE 1 = 1"
    params: list[Any] = []
    if role:
        sql += " AND role = ?"
        params.append(role)
    if only_active:
        sql += " AND is_active = 1"
    sql += " ORDER BY full_name COLLATE NOCASE"
    async with conn.execute(sql, params) as cur:
        return list(await cur.fetchall())


async def ensure_admins(conn: aiosqlite.Connection, admin_ids: Iterable[int]) -> None:
    """Повышает до администратора всех, кто перечислен в ADMIN_IDS."""
    for admin_id in admin_ids:
        await conn.execute(
            "UPDATE users SET role = 'admin' WHERE tg_id = ? AND role <> 'admin'", (admin_id,)
        )
    await conn.commit()


# ------------------------------------------------------------------ напоминания


async def create_reminder(
    conn: aiosqlite.Connection,
    title: str,
    description: str | None,
    scope: str,
    owner_id: int,
    default_time: str,
    days: str,
    is_mandatory: bool = True,
) -> int:
    cur = await conn.execute(
        """
        INSERT INTO reminders
            (title, description, scope, owner_id, is_mandatory, default_time, days, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        """,
        (
            title,
            description,
            scope,
            owner_id,
            1 if is_mandatory else 0,
            default_time,
            days,
            utc_iso(),
        ),
    )
    await conn.commit()
    return int(cur.lastrowid)


async def get_reminder(conn: aiosqlite.Connection, reminder_id: int) -> Row | None:
    async with conn.execute("SELECT * FROM reminders WHERE id = ?", (reminder_id,)) as cur:
        return await cur.fetchone()


async def list_reminders(
    conn: aiosqlite.Connection,
    scope: str | None = None,
    owner_id: int | None = None,
    only_active: bool = True,
) -> list[Row]:
    sql = "SELECT * FROM reminders WHERE 1 = 1"
    params: list[Any] = []
    if scope:
        sql += " AND scope = ?"
        params.append(scope)
    if owner_id is not None:
        sql += " AND owner_id = ?"
        params.append(owner_id)
    if only_active:
        sql += " AND is_active = 1"
    sql += " ORDER BY default_time, id"
    async with conn.execute(sql, params) as cur:
        return list(await cur.fetchall())


async def update_reminder(conn: aiosqlite.Connection, reminder_id: int, **fields: Any) -> None:
    allowed = {"title", "description", "default_time", "days", "is_active", "is_mandatory"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    assignments = ", ".join(f"{key} = ?" for key in updates)
    await conn.execute(
        f"UPDATE reminders SET {assignments} WHERE id = ?", (*updates.values(), reminder_id)
    )
    await conn.commit()


async def delete_reminder(conn: aiosqlite.Connection, reminder_id: int) -> None:
    """Мягкое удаление: история отправок и отчёты остаются нетронутыми."""
    await conn.execute("UPDATE reminders SET is_active = 0 WHERE id = ?", (reminder_id,))
    await conn.execute(
        "UPDATE subscriptions SET is_active = 0 WHERE reminder_id = ?", (reminder_id,)
    )
    await conn.commit()


# --------------------------------------------------------------- пункты чек-листа


async def set_checklist(conn: aiosqlite.Connection, reminder_id: int, items: Sequence[str]) -> None:
    await conn.execute("DELETE FROM checklist_items WHERE reminder_id = ?", (reminder_id,))
    await conn.executemany(
        "INSERT INTO checklist_items (reminder_id, text, position) VALUES (?, ?, ?)",
        [(reminder_id, text, index) for index, text in enumerate(items)],
    )
    await conn.commit()


async def list_checklist(conn: aiosqlite.Connection, reminder_id: int) -> list[Row]:
    async with conn.execute(
        "SELECT * FROM checklist_items WHERE reminder_id = ? ORDER BY position, id", (reminder_id,)
    ) as cur:
        return list(await cur.fetchall())


# ------------------------------------------------------------------- подписки


async def subscribe(
    conn: aiosqlite.Connection,
    user_id: int,
    reminder_id: int,
    time: str,
    days: str | None = None,
) -> int:
    await conn.execute(
        """
        INSERT INTO subscriptions (user_id, reminder_id, time, days, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT (user_id, reminder_id) DO UPDATE SET
            time      = excluded.time,
            days      = excluded.days,
            is_active = 1
        """,
        (user_id, reminder_id, time, days, utc_iso()),
    )
    await conn.commit()
    async with conn.execute(
        "SELECT id FROM subscriptions WHERE user_id = ? AND reminder_id = ?", (user_id, reminder_id)
    ) as cur:
        row = await cur.fetchone()
    return int(row["id"])


async def get_subscription(conn: aiosqlite.Connection, sub_id: int) -> Row | None:
    async with conn.execute(
        """
        SELECT s.*, r.title, r.description, r.scope, r.is_mandatory,
               r.days AS reminder_days, r.is_active AS reminder_active
        FROM subscriptions s
        JOIN reminders r ON r.id = s.reminder_id
        WHERE s.id = ?
        """,
        (sub_id,),
    ) as cur:
        return await cur.fetchone()


async def list_subscriptions(
    conn: aiosqlite.Connection, user_id: int, only_active: bool = True
) -> list[Row]:
    sql = """
        SELECT s.*, r.title, r.description, r.scope, r.is_mandatory,
               r.days AS reminder_days, r.is_active AS reminder_active
        FROM subscriptions s
        JOIN reminders r ON r.id = s.reminder_id
        WHERE s.user_id = ? AND r.is_active = 1
    """
    if only_active:
        sql += " AND s.is_active = 1"
    sql += " ORDER BY s.time, r.title"
    async with conn.execute(sql, (user_id,)) as cur:
        return list(await cur.fetchall())


async def set_subscription_time(conn: aiosqlite.Connection, sub_id: int, time: str) -> None:
    await conn.execute("UPDATE subscriptions SET time = ? WHERE id = ?", (time, sub_id))
    await conn.commit()


async def set_subscription_days(conn: aiosqlite.Connection, sub_id: int, days: str | None) -> None:
    await conn.execute("UPDATE subscriptions SET days = ? WHERE id = ?", (days, sub_id))
    await conn.commit()


async def set_subscription_active(
    conn: aiosqlite.Connection, sub_id: int, is_active: bool
) -> None:
    await conn.execute(
        "UPDATE subscriptions SET is_active = ? WHERE id = ?", (1 if is_active else 0, sub_id)
    )
    await conn.commit()


async def subscribe_all_employees(
    conn: aiosqlite.Connection, reminder_id: int, time: str
) -> int:
    """Подписывает всех активных сотрудников на обязательное напоминание."""
    employees = await list_users(conn, only_active=True)
    count = 0
    for employee in employees:
        async with conn.execute(
            "SELECT 1 FROM subscriptions WHERE user_id = ? AND reminder_id = ?",
            (employee["tg_id"], reminder_id),
        ) as cur:
            if await cur.fetchone():
                continue
        await subscribe(conn, employee["tg_id"], reminder_id, time)
        count += 1
    return count


async def sync_mandatory_subscriptions(conn: aiosqlite.Connection, user_id: int) -> int:
    """Подписывает нового сотрудника на все действующие обязательные напоминания."""
    async with conn.execute(
        """
        SELECT r.id, r.default_time FROM reminders r
        WHERE r.scope = 'global' AND r.is_mandatory = 1 AND r.is_active = 1
          AND NOT EXISTS (
              SELECT 1 FROM subscriptions s WHERE s.reminder_id = r.id AND s.user_id = ?
          )
        """,
        (user_id,),
    ) as cur:
        pending = list(await cur.fetchall())
    for reminder in pending:
        await subscribe(conn, user_id, reminder["id"], reminder["default_time"])
    return len(pending)


async def due_candidates(conn: aiosqlite.Connection) -> list[Row]:
    """Все активные подписки активных сотрудников — планировщик отбирает нужные по времени."""
    async with conn.execute(
        """
        SELECT s.id AS sub_id, s.user_id, s.reminder_id, s.time, s.days AS sub_days,
               r.title, r.description, r.days AS reminder_days,
               u.tz, u.full_name
        FROM subscriptions s
        JOIN reminders r ON r.id = s.reminder_id
        JOIN users u     ON u.tg_id = s.user_id
        WHERE s.is_active = 1 AND r.is_active = 1 AND u.is_active = 1
        """
    ) as cur:
        return list(await cur.fetchall())


def subscription_days(row: Row) -> list[int]:
    """Дни недели подписки: собственные, если заданы, иначе из напоминания."""
    raw = row["sub_days"] if "sub_days" in row.keys() else row["days"]
    if not raw:
        raw = row["reminder_days"]
    return parse_days(raw)


# ------------------------------------------------------------------- отправки


async def create_delivery(
    conn: aiosqlite.Connection,
    sub_id: int,
    user_id: int,
    reminder_id: int,
    title: str,
    local_date: str,
    scheduled_time: str,
) -> int | None:
    """Регистрирует отправку. None — если за этот день она уже была (защита от дублей)."""
    cur = await conn.execute(
        """
        INSERT OR IGNORE INTO deliveries
            (subscription_id, user_id, reminder_id, title, local_date, scheduled_time, status)
        VALUES (?, ?, ?, ?, ?, ?, 'sent')
        """,
        (sub_id, user_id, reminder_id, title, local_date, scheduled_time),
    )
    if cur.rowcount == 0:
        await conn.commit()
        return None
    delivery_id = int(cur.lastrowid)

    items = await list_checklist(conn, reminder_id)
    await conn.executemany(
        "INSERT INTO delivery_items (delivery_id, text, position) VALUES (?, ?, ?)",
        [(delivery_id, item["text"], item["position"]) for item in items],
    )
    await conn.commit()
    return delivery_id


async def mark_delivery_sent(
    conn: aiosqlite.Connection, delivery_id: int, message_id: int | None
) -> None:
    await conn.execute(
        "UPDATE deliveries SET sent_at = ?, chat_message_id = ? WHERE id = ?",
        (utc_iso(), message_id, delivery_id),
    )
    await conn.commit()


async def mark_delivery_failed(conn: aiosqlite.Connection, delivery_id: int) -> None:
    await conn.execute(
        "UPDATE deliveries SET status = 'failed', sent_at = ? WHERE id = ?",
        (utc_iso(), delivery_id),
    )
    await conn.commit()


async def mark_nudged(conn: aiosqlite.Connection, delivery_id: int) -> None:
    await conn.execute(
        "UPDATE deliveries SET nudged_at = ? WHERE id = ?", (utc_iso(), delivery_id)
    )
    await conn.commit()


async def get_delivery(conn: aiosqlite.Connection, delivery_id: int) -> Row | None:
    async with conn.execute("SELECT * FROM deliveries WHERE id = ?", (delivery_id,)) as cur:
        return await cur.fetchone()


async def list_delivery_items(conn: aiosqlite.Connection, delivery_id: int) -> list[Row]:
    async with conn.execute(
        "SELECT * FROM delivery_items WHERE delivery_id = ? ORDER BY position, id", (delivery_id,)
    ) as cur:
        return list(await cur.fetchall())


async def toggle_delivery_item(conn: aiosqlite.Connection, item_id: int) -> Row | None:
    async with conn.execute("SELECT * FROM delivery_items WHERE id = ?", (item_id,)) as cur:
        item = await cur.fetchone()
    if item is None:
        return None
    new_state = 0 if item["is_done"] else 1
    await conn.execute(
        "UPDATE delivery_items SET is_done = ?, done_at = ? WHERE id = ?",
        (new_state, utc_iso() if new_state else None, item_id),
    )
    await conn.commit()
    return item


async def touch_first_response(conn: aiosqlite.Connection, delivery_id: int) -> None:
    await conn.execute(
        "UPDATE deliveries SET first_response_at = ? WHERE id = ? AND first_response_at IS NULL",
        (utc_iso(), delivery_id),
    )
    await conn.commit()


async def refresh_delivery_status(conn: aiosqlite.Connection, delivery_id: int) -> str:
    """Пересчитывает статус по отмеченным пунктам. Возвращает новый статус."""
    items = await list_delivery_items(conn, delivery_id)
    delivery = await get_delivery(conn, delivery_id)
    if delivery is None:
        return "missed"

    done = sum(1 for item in items if item["is_done"])
    finalized = delivery["completed_at"] is not None

    if not items:
        status = "done" if finalized else "sent"
    elif done == len(items):
        status = "done"
    elif done > 0:
        status = "partial"
    else:
        status = "partial" if finalized else "sent"

    if delivery["status"] == "failed":
        status = "failed"

    await conn.execute("UPDATE deliveries SET status = ? WHERE id = ?", (status, delivery_id))
    await conn.commit()
    return status


async def finalize_delivery(conn: aiosqlite.Connection, delivery_id: int) -> str:
    await conn.execute(
        "UPDATE deliveries SET completed_at = COALESCE(completed_at, ?) WHERE id = ?",
        (utc_iso(), delivery_id),
    )
    await conn.commit()
    await touch_first_response(conn, delivery_id)
    return await refresh_delivery_status(conn, delivery_id)


async def check_all_items(conn: aiosqlite.Connection, delivery_id: int) -> None:
    await conn.execute(
        "UPDATE delivery_items SET is_done = 1, done_at = COALESCE(done_at, ?) WHERE delivery_id = ?",
        (utc_iso(), delivery_id),
    )
    await conn.commit()


async def pending_deliveries(conn: aiosqlite.Connection) -> list[Row]:
    """Отправленные, но ещё не закрытые сотрудником — кандидаты на повторное напоминание."""
    async with conn.execute(
        """
        SELECT d.*, u.tz, u.full_name
        FROM deliveries d
        JOIN users u ON u.tg_id = d.user_id
        WHERE d.status IN ('sent', 'partial') AND d.completed_at IS NULL
              AND d.sent_at IS NOT NULL AND d.nudged_at IS NULL
        """
    ) as cur:
        return list(await cur.fetchall())


async def close_open_deliveries(
    conn: aiosqlite.Connection, local_date: str, user_id: int | None = None
) -> int:
    """В конце дня всё незакрытое переводится в «не отмечено»."""
    sql = """
        UPDATE deliveries SET status = 'missed'
        WHERE local_date = ? AND completed_at IS NULL AND status = 'sent'
    """
    params: list[Any] = [local_date]
    if user_id is not None:
        sql += " AND user_id = ?"
        params.append(user_id)
    cur = await conn.execute(sql, params)
    await conn.commit()
    return cur.rowcount


# --------------------------------------------------------------------- отчёты


async def deliveries_for_date(
    conn: aiosqlite.Connection, local_date: str, user_id: int | None = None
) -> list[Row]:
    sql = """
        SELECT d.*, u.full_name, u.username,
               (SELECT COUNT(*) FROM delivery_items i WHERE i.delivery_id = d.id) AS items_total,
               (SELECT COUNT(*) FROM delivery_items i WHERE i.delivery_id = d.id AND i.is_done = 1)
                   AS items_done
        FROM deliveries d
        JOIN users u ON u.tg_id = d.user_id
        WHERE d.local_date = ?
    """
    params: list[Any] = [local_date]
    if user_id is not None:
        sql += " AND d.user_id = ?"
        params.append(user_id)
    sql += " ORDER BY u.full_name COLLATE NOCASE, d.scheduled_time"
    async with conn.execute(sql, params) as cur:
        return list(await cur.fetchall())


async def undone_items(conn: aiosqlite.Connection, delivery_id: int) -> list[Row]:
    async with conn.execute(
        "SELECT * FROM delivery_items WHERE delivery_id = ? AND is_done = 0 ORDER BY position",
        (delivery_id,),
    ) as cur:
        return list(await cur.fetchall())


async def user_stats(conn: aiosqlite.Connection, user_id: int, days: int = 7) -> Row | None:
    async with conn.execute(
        """
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)    AS done,
               SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
               SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END)  AS missed
        FROM deliveries
        WHERE user_id = ? AND local_date >= date('now', ?)
        """,
        (user_id, f"-{days} days"),
    ) as cur:
        return await cur.fetchone()


async def report_already_sent(
    conn: aiosqlite.Connection, admin_id: int, local_date: str
) -> bool:
    async with conn.execute(
        "SELECT 1 FROM report_log WHERE admin_id = ? AND local_date = ?", (admin_id, local_date)
    ) as cur:
        return await cur.fetchone() is not None


async def mark_report_sent(conn: aiosqlite.Connection, admin_id: int, local_date: str) -> None:
    await conn.execute(
        "INSERT OR REPLACE INTO report_log (admin_id, local_date, sent_at) VALUES (?, ?, ?)",
        (admin_id, local_date, utc_iso()),
    )
    await conn.commit()


async def skip_delivery(conn: aiosqlite.Connection, delivery_id: int) -> None:
    """Сотрудник отметил «не смогу» — закрываем как невыполненное."""
    await conn.execute(
        """
        UPDATE deliveries
        SET status = 'missed',
            completed_at = COALESCE(completed_at, ?),
            first_response_at = COALESCE(first_response_at, ?)
        WHERE id = ?
        """,
        (utc_iso(), utc_iso(), delivery_id),
    )
    await conn.commit()


async def count_subscribers(conn: aiosqlite.Connection, reminder_id: int) -> int:
    async with conn.execute(
        "SELECT COUNT(*) AS n FROM subscriptions WHERE reminder_id = ? AND is_active = 1",
        (reminder_id,),
    ) as cur:
        row = await cur.fetchone()
    return int(row["n"]) if row else 0


async def set_delivery_comment(
    conn: aiosqlite.Connection, delivery_id: int, comment: str | None
) -> None:
    """Сохраняет пояснение сотрудника. Пустая строка стирает комментарий."""
    text = (comment or "").strip()[:500] or None
    await conn.execute(
        "UPDATE deliveries SET comment = ?, commented_at = ? WHERE id = ?",
        (text, utc_iso() if text else None, delivery_id),
    )
    await conn.commit()
    if text:
        await touch_first_response(conn, delivery_id)
