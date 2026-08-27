"""Отметки в присланном напоминании: галочки, «Готово», «Не смогу»."""

from __future__ import annotations

import aiosqlite
from aiogram import F, Router
from aiogram.types import CallbackQuery

from bot import repo
from bot.callbacks import DoneCb, ItemCb
from bot.keyboards import delivery_keyboard
from bot.messages import render_delivery

router = Router(name="checklist")


async def _redraw(
    callback: CallbackQuery, conn: aiosqlite.Connection, delivery_id: int
) -> None:
    delivery = await repo.get_delivery(conn, delivery_id)
    if delivery is None:
        return

    items = await repo.list_delivery_items(conn, delivery_id)
    reminder = await repo.get_reminder(conn, delivery["reminder_id"])
    finalized = delivery["completed_at"] is not None
    skipped = finalized and delivery["status"] == "missed"

    text = render_delivery(
        title=delivery["title"],
        description=reminder["description"] if reminder else None,
        items=items,
        scheduled_time=delivery["scheduled_time"],
        finalized=finalized,
        skipped=skipped,
    )
    if callback.message:
        await callback.message.edit_text(
            text, reply_markup=delivery_keyboard(delivery_id, items, finalized=finalized)
        )


async def _guard(
    callback: CallbackQuery, conn: aiosqlite.Connection, user: aiosqlite.Row, delivery_id: int
) -> aiosqlite.Row | None:
    delivery = await repo.get_delivery(conn, delivery_id)
    if delivery is None:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return None
    if delivery["user_id"] != user["tg_id"]:
        await callback.answer("Это чужое напоминание", show_alert=True)
        return None
    if delivery["completed_at"] is not None:
        await callback.answer("Напоминание уже закрыто", show_alert=True)
        return None
    return delivery


@router.callback_query(ItemCb.filter())
async def cb_toggle_item(
    callback: CallbackQuery,
    callback_data: ItemCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    delivery = await _guard(callback, conn, user, callback_data.delivery_id)
    if delivery is None:
        return

    item = await repo.toggle_delivery_item(conn, callback_data.item_id)
    if item is None or item["delivery_id"] != delivery["id"]:
        await callback.answer("Пункт не найден", show_alert=True)
        return

    await repo.touch_first_response(conn, delivery["id"])
    await repo.refresh_delivery_status(conn, delivery["id"])
    await callback.answer("Снял отметку" if item["is_done"] else "Отметил ✅")
    await _redraw(callback, conn, delivery["id"])


@router.callback_query(DoneCb.filter(F.action == "all"))
async def cb_check_all(
    callback: CallbackQuery,
    callback_data: DoneCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    delivery = await _guard(callback, conn, user, callback_data.delivery_id)
    if delivery is None:
        return

    await repo.check_all_items(conn, delivery["id"])
    await repo.touch_first_response(conn, delivery["id"])
    await repo.refresh_delivery_status(conn, delivery["id"])
    await callback.answer("Отметил все пункты")
    await _redraw(callback, conn, delivery["id"])


@router.callback_query(DoneCb.filter(F.action == "finish"))
async def cb_finish(
    callback: CallbackQuery,
    callback_data: DoneCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    delivery = await _guard(callback, conn, user, callback_data.delivery_id)
    if delivery is None:
        return

    items = await repo.list_delivery_items(conn, delivery["id"])
    done = sum(1 for item in items if item["is_done"])
    status = await repo.finalize_delivery(conn, delivery["id"])

    if status == "done":
        await callback.answer("Отлично, всё выполнено! ✅")
    else:
        await callback.answer(f"Записал: {done} из {len(items)}. Остальное попадёт в отчёт.")
    await _redraw(callback, conn, delivery["id"])


@router.callback_query(DoneCb.filter(F.action == "skip"))
async def cb_skip(
    callback: CallbackQuery,
    callback_data: DoneCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    delivery = await _guard(callback, conn, user, callback_data.delivery_id)
    if delivery is None:
        return

    await repo.skip_delivery(conn, delivery["id"])
    await callback.answer("Отметил как невыполненное")
    await _redraw(callback, conn, delivery["id"])


@router.callback_query(DoneCb.filter(F.action == "noop"))
async def cb_noop(callback: CallbackQuery) -> None:
    await callback.answer("Это напоминание уже закрыто")
