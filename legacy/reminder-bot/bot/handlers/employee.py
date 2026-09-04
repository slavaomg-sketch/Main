"""Раздел сотрудника: свои напоминания, каталог, создание личного напоминания."""

from __future__ import annotations

import aiosqlite
from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from bot import repo
from bot.callbacks import DayCb, Nav, RemCb, SubCb, TimeCb
from bot.handlers._helpers import show
from bot.keyboards import (
    BTN_CATALOG,
    BTN_MY,
    BTN_NEW,
    catalog_card,
    catalog_keyboard,
    checklist_edit_keyboard,
    days_keyboard,
    main_menu,
    subscription_card,
    subscriptions_keyboard,
    time_keyboard,
)
from bot.messages import render_reminder_card, render_subscription_card
from bot.utils import (
    WORKDAYS,
    days_to_str,
    escape,
    format_days,
    parse_days,
    parse_time,
)

router = Router(name="employee")


class SubEdit(StatesGroup):
    time = State()
    days = State()


class NewReminder(StatesGroup):
    title = State()
    description = State()
    items = State()
    time = State()
    days = State()


# ------------------------------------------------------------- мои напоминания


async def _my_view(conn: aiosqlite.Connection, user_id: int) -> tuple[str, object]:
    subs = await repo.list_subscriptions(conn, user_id, only_active=False)
    if not subs:
        text = (
            "📋 <b>Мои напоминания</b>\n\n"
            "Пока пусто. Загляните в 📚 «Каталог» или создайте своё через ➕."
        )
    else:
        lines = ["📋 <b>Мои напоминания</b>", ""]
        for sub in subs:
            mark = "🔔" if sub["is_active"] else "🔕"
            lock = " 🔒" if sub["scope"] == "global" and sub["is_mandatory"] else ""
            days = format_days(sub["days"] or sub["reminder_days"])
            lines.append(f"{mark} <b>{sub['time']}</b> — {escape(sub['title'])}{lock}")
            lines.append(f"      <i>{days}</i>")
        lines += ["", "<i>Нажмите на напоминание, чтобы изменить время или дни.</i>"]
        text = "\n".join(lines)
    return text, subscriptions_keyboard(subs)


@router.message(F.text == BTN_MY)
@router.message(Command("my"))
async def cmd_my(
    message: Message, state: FSMContext, conn: aiosqlite.Connection, user: aiosqlite.Row
) -> None:
    await state.clear()
    text, markup = await _my_view(conn, user["tg_id"])
    await message.answer(text, reply_markup=markup)


@router.callback_query(Nav.filter(F.to == "my"))
async def cb_my(
    callback: CallbackQuery, state: FSMContext, conn: aiosqlite.Connection, user: aiosqlite.Row
) -> None:
    await state.clear()
    text, markup = await _my_view(conn, user["tg_id"])
    await show(callback, text, markup)


@router.callback_query(SubCb.filter(F.action == "open"))
async def cb_sub_open(
    callback: CallbackQuery,
    callback_data: SubCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    sub = await repo.get_subscription(conn, callback_data.sub_id)
    if sub is None or sub["user_id"] != user["tg_id"]:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return
    items = await repo.list_checklist(conn, sub["reminder_id"])
    await show(callback, render_subscription_card(sub, items), subscription_card(sub))


@router.callback_query(SubCb.filter(F.action.in_({"pause", "resume"})))
async def cb_sub_toggle(
    callback: CallbackQuery,
    callback_data: SubCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    sub = await repo.get_subscription(conn, callback_data.sub_id)
    if sub is None or sub["user_id"] != user["tg_id"]:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return
    if sub["scope"] == "global" and sub["is_mandatory"]:
        await callback.answer("Это обязательное напоминание — отключить нельзя", show_alert=True)
        return

    resume = callback_data.action == "resume"
    await repo.set_subscription_active(conn, sub["id"], resume)
    updated = await repo.get_subscription(conn, sub["id"])
    assert updated is not None
    items = await repo.list_checklist(conn, updated["reminder_id"])
    await callback.answer("Включено" if resume else "Приостановлено")
    await show(callback, render_subscription_card(updated, items), subscription_card(updated))


# --------------------------------------------------------------- изменение времени


@router.callback_query(SubCb.filter(F.action == "time"))
async def cb_sub_time(
    callback: CallbackQuery,
    callback_data: SubCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    sub = await repo.get_subscription(conn, callback_data.sub_id)
    if sub is None or sub["user_id"] != user["tg_id"]:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return

    await state.set_state(SubEdit.time)
    await state.update_data(sub_id=sub["id"])
    await show(
        callback,
        f"🕐 <b>{escape(sub['title'])}</b>\n\nСейчас: <b>{sub['time']}</b>\n"
        "Выберите новое время или введите своё в формате ЧЧ:ММ.",
        time_keyboard(),
    )


@router.callback_query(SubEdit.time, TimeCb.filter())
async def cb_sub_time_pick(
    callback: CallbackQuery,
    callback_data: TimeCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
) -> None:
    if callback_data.value == "manual":
        await callback.answer()
        await callback.message.answer("Введите время в формате <b>ЧЧ:ММ</b>, например 09:30")
        return

    data = await state.get_data()
    await repo.set_subscription_time(conn, data["sub_id"], callback_data.value)
    sub = await repo.get_subscription(conn, data["sub_id"])
    await state.clear()

    assert sub is not None
    items = await repo.list_checklist(conn, sub["reminder_id"])
    await callback.answer(f"Время: {callback_data.value}")
    await show(callback, render_subscription_card(sub, items), subscription_card(sub))


@router.message(SubEdit.time)
async def msg_sub_time(message: Message, state: FSMContext, conn: aiosqlite.Connection) -> None:
    value = parse_time(message.text or "")
    if not value:
        await message.answer("Не понял время. Введите в формате <b>ЧЧ:ММ</b>, например 09:30")
        return

    data = await state.get_data()
    await repo.set_subscription_time(conn, data["sub_id"], value)
    sub = await repo.get_subscription(conn, data["sub_id"])
    await state.clear()

    assert sub is not None
    items = await repo.list_checklist(conn, sub["reminder_id"])
    await message.answer(
        f"✅ Время изменено на <b>{value}</b>\n\n" + render_subscription_card(sub, items),
        reply_markup=subscription_card(sub),
    )


# ------------------------------------------------------------------ изменение дней


@router.callback_query(SubCb.filter(F.action == "days"))
async def cb_sub_days(
    callback: CallbackQuery,
    callback_data: SubCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    sub = await repo.get_subscription(conn, callback_data.sub_id)
    if sub is None or sub["user_id"] != user["tg_id"]:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return

    selected = parse_days(sub["days"] or sub["reminder_days"])
    await state.set_state(SubEdit.days)
    await state.update_data(sub_id=sub["id"], days=selected)
    await show(
        callback,
        f"📅 <b>{escape(sub['title'])}</b>\n\nВ какие дни присылать?",
        days_keyboard(selected),
    )


@router.callback_query(SubEdit.days, DayCb.filter())
async def cb_sub_days_pick(
    callback: CallbackQuery,
    callback_data: DayCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
) -> None:
    data = await state.get_data()
    selected = set(data.get("days", []))

    if callback_data.action == "toggle":
        day = int(callback_data.value)
        selected.symmetric_difference_update({day})
    elif callback_data.action == "preset":
        selected = set(parse_days(callback_data.value))
    elif callback_data.action == "save":
        if not selected:
            await callback.answer("Выберите хотя бы один день", show_alert=True)
            return
        await repo.set_subscription_days(conn, data["sub_id"], days_to_str(selected))
        sub = await repo.get_subscription(conn, data["sub_id"])
        await state.clear()
        assert sub is not None
        items = await repo.list_checklist(conn, sub["reminder_id"])
        await callback.answer("Дни сохранены")
        await show(callback, render_subscription_card(sub, items), subscription_card(sub))
        return

    await state.update_data(days=sorted(selected))
    await callback.answer()
    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=days_keyboard(sorted(selected)))


# ---------------------------------------------------------------------- каталог


@router.message(F.text == BTN_CATALOG)
@router.message(Command("catalog"))
async def cmd_catalog(
    message: Message, state: FSMContext, conn: aiosqlite.Connection, user: aiosqlite.Row
) -> None:
    await state.clear()
    text, markup = await _catalog_view(conn, user["tg_id"])
    await message.answer(text, reply_markup=markup)


@router.callback_query(Nav.filter(F.to == "catalog"))
async def cb_catalog(
    callback: CallbackQuery, state: FSMContext, conn: aiosqlite.Connection, user: aiosqlite.Row
) -> None:
    await state.clear()
    text, markup = await _catalog_view(conn, user["tg_id"])
    await show(callback, text, markup)


async def _catalog_view(conn: aiosqlite.Connection, user_id: int) -> tuple[str, object]:
    reminders = await repo.list_reminders(conn, scope="global")
    subs = await repo.list_subscriptions(conn, user_id, only_active=False)
    subscribed = {sub["reminder_id"] for sub in subs if sub["is_active"]}

    if not reminders:
        return (
            "📚 <b>Каталог</b>\n\nОбщих напоминаний пока нет — их создаёт руководитель.",
            catalog_keyboard([], subscribed),
        )
    text = (
        "📚 <b>Каталог общих напоминаний</b>\n\n"
        "🔒 — обязательные, подключены всем автоматически\n"
        "✅ — вы уже подписаны\n\n"
        "<i>Нажмите, чтобы посмотреть чек-лист и настроить время.</i>"
    )
    return text, catalog_keyboard(reminders, subscribed)


@router.callback_query(RemCb.filter(F.action == "open"))
async def cb_reminder_open(
    callback: CallbackQuery,
    callback_data: RemCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None or not reminder["is_active"]:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return

    items = await repo.list_checklist(conn, reminder["id"])
    subs = await repo.list_subscriptions(conn, user["tg_id"], only_active=False)
    subscribed = any(s["reminder_id"] == reminder["id"] and s["is_active"] for s in subs)
    await show(callback, render_reminder_card(reminder, items), catalog_card(reminder, subscribed))


@router.callback_query(RemCb.filter(F.action.in_({"join", "leave"})))
async def cb_reminder_join(
    callback: CallbackQuery,
    callback_data: RemCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None or not reminder["is_active"]:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return

    if callback_data.action == "join":
        await repo.subscribe(conn, user["tg_id"], reminder["id"], reminder["default_time"])
        await callback.answer(f"Подписал. Время: {reminder['default_time']}")
        subscribed = True
    else:
        if reminder["is_mandatory"]:
            await callback.answer("Обязательное напоминание — отписаться нельзя", show_alert=True)
            return
        async with conn.execute(
            "SELECT id FROM subscriptions WHERE user_id = ? AND reminder_id = ?",
            (user["tg_id"], reminder["id"]),
        ) as cur:
            row = await cur.fetchone()
        if row:
            await repo.set_subscription_active(conn, row["id"], False)
        await callback.answer("Отписал")
        subscribed = False

    items = await repo.list_checklist(conn, reminder["id"])
    await show(callback, render_reminder_card(reminder, items), catalog_card(reminder, subscribed))


@router.callback_query(RemCb.filter(F.action == "time"))
async def cb_reminder_time(
    callback: CallbackQuery,
    callback_data: RemCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
) -> None:
    async with conn.execute(
        "SELECT id FROM subscriptions WHERE user_id = ? AND reminder_id = ?",
        (user["tg_id"], callback_data.rem_id),
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        await callback.answer("Сначала подпишитесь", show_alert=True)
        return

    await state.set_state(SubEdit.time)
    await state.update_data(sub_id=row["id"])
    await show(callback, "🕐 Во сколько присылать это напоминание?", time_keyboard())


# ------------------------------------------------- создание личного напоминания


@router.message(F.text == BTN_NEW)
@router.message(Command("new"))
async def cmd_new(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(NewReminder.title)
    await state.update_data(scope="personal")
    await message.answer(
        "➕ <b>Новое напоминание</b>\n\n"
        "Шаг 1 из 5. Как назвать?\n"
        "<i>Например: «Утренний обход» или «Отчёт по кассе».</i>\n\n"
        "Отмена — /cancel"
    )


@router.callback_query(Nav.filter(F.to == "new"))
async def cb_new(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(NewReminder.title)
    await state.update_data(scope="personal")
    await callback.answer()
    await callback.message.answer(
        "➕ <b>Новое напоминание</b>\n\nШаг 1 из 5. Как назвать?\n\nОтмена — /cancel"
    )


@router.message(NewReminder.title)
async def new_title(message: Message, state: FSMContext) -> None:
    title = (message.text or "").strip()
    if not 2 <= len(title) <= 100:
        await message.answer("Название должно быть от 2 до 100 символов. Попробуйте ещё раз.")
        return

    await state.update_data(title=title)
    await state.set_state(NewReminder.description)
    await message.answer(
        f"Шаг 2 из 5. Добавьте пояснение к «{escape(title)}» — "
        "его увидит сотрудник вместе с напоминанием.\n\n"
        "Отправьте <b>-</b>, если пояснение не нужно."
    )


@router.message(NewReminder.description)
async def new_description(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    await state.update_data(description=None if raw in ("-", "—", "") else raw[:500], items=[])
    await state.set_state(NewReminder.items)
    await message.answer(
        "Шаг 3 из 5. <b>Чек-лист.</b>\n\n"
        "Присылайте пункты по одному сообщением — они станут галочками.\n"
        "Можно отправить сразу несколько строк одним сообщением.\n\n"
        "<i>Например:</i>\n<code>Проверить кассу\nЗаполнить журнал\nОтправить фото</code>",
        reply_markup=checklist_edit_keyboard(0),
    )


@router.message(NewReminder.items)
async def new_items(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    items: list[str] = list(data.get("items", []))

    for line in (message.text or "").split("\n"):
        line = line.strip(" -•\t")
        if line:
            items.append(line[:120])
    items = items[:20]

    await state.update_data(items=items)
    listing = "\n".join(f"{index}. {escape(text)}" for index, text in enumerate(items, 1))
    await message.answer(
        f"<b>Пункты ({len(items)}):</b>\n{listing}\n\n"
        "Добавьте ещё или нажмите «Готово, дальше».",
        reply_markup=checklist_edit_keyboard(len(items)),
    )


@router.callback_query(NewReminder.items, Nav.filter(F.to.in_({"items_done", "items_skip"})))
async def new_items_done(
    callback: CallbackQuery, callback_data: Nav, state: FSMContext
) -> None:
    if callback_data.to == "items_skip":
        await state.update_data(items=[])

    await state.set_state(NewReminder.time)
    await callback.answer()
    await show(callback, "Шаг 4 из 5. Во сколько присылать?", time_keyboard())


@router.callback_query(NewReminder.time, TimeCb.filter())
async def new_time_pick(
    callback: CallbackQuery, callback_data: TimeCb, state: FSMContext
) -> None:
    if callback_data.value == "manual":
        await callback.answer()
        await callback.message.answer("Введите время в формате <b>ЧЧ:ММ</b>, например 09:30")
        return

    await state.update_data(time=callback_data.value, days=parse_days(WORKDAYS))
    await state.set_state(NewReminder.days)
    await callback.answer()
    await show(
        callback,
        f"Шаг 5 из 5. Время <b>{callback_data.value}</b>. В какие дни присылать?",
        days_keyboard(parse_days(WORKDAYS)),
    )


@router.message(NewReminder.time)
async def new_time_manual(message: Message, state: FSMContext) -> None:
    value = parse_time(message.text or "")
    if not value:
        await message.answer("Не понял время. Введите в формате <b>ЧЧ:ММ</b>, например 09:30")
        return

    await state.update_data(time=value, days=parse_days(WORKDAYS))
    await state.set_state(NewReminder.days)
    await message.answer(
        f"Шаг 5 из 5. Время <b>{value}</b>. В какие дни присылать?",
        reply_markup=days_keyboard(parse_days(WORKDAYS)),
    )


@router.callback_query(NewReminder.days, DayCb.filter())
async def new_days_pick(
    callback: CallbackQuery,
    callback_data: DayCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    is_admin: bool,
) -> None:
    data = await state.get_data()
    selected = set(data.get("days", []))

    if callback_data.action == "toggle":
        selected.symmetric_difference_update({int(callback_data.value)})
    elif callback_data.action == "preset":
        selected = set(parse_days(callback_data.value))
    elif callback_data.action == "save":
        if not selected:
            await callback.answer("Выберите хотя бы один день", show_alert=True)
            return
        await _finish_creation(callback, state, conn, user, is_admin, sorted(selected))
        return

    await state.update_data(days=sorted(selected))
    await callback.answer()
    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=days_keyboard(sorted(selected)))


async def _finish_creation(
    callback: CallbackQuery,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    is_admin: bool,
    days: list[int],
) -> None:
    data = await state.get_data()
    reminder_id = await repo.create_reminder(
        conn,
        title=data["title"],
        description=data.get("description"),
        scope="personal",
        owner_id=user["tg_id"],
        default_time=data["time"],
        days=days_to_str(days),
        is_mandatory=False,
    )
    await repo.set_checklist(conn, reminder_id, data.get("items", []))
    await repo.subscribe(conn, user["tg_id"], reminder_id, data["time"], days_to_str(days))
    await state.clear()

    reminder = await repo.get_reminder(conn, reminder_id)
    items = await repo.list_checklist(conn, reminder_id)
    assert reminder is not None

    await callback.answer("Напоминание создано")
    await show(callback, "✅ <b>Готово!</b>\n\n" + render_reminder_card(reminder, items))
    if callback.message:
        await callback.message.answer(
            "Напоминание будет приходить по расписанию.", reply_markup=main_menu(is_admin)
        )


@router.callback_query(RemCb.filter(F.action == "confirm_delete"))
async def cb_personal_delete_confirm(
    callback: CallbackQuery,
    callback_data: RemCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    is_admin: bool,
) -> None:
    from bot.keyboards import confirm_delete_keyboard

    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return
    if reminder["scope"] == "personal" and reminder["owner_id"] != user["tg_id"]:
        await callback.answer("Это не ваше напоминание", show_alert=True)
        return
    if reminder["scope"] == "global" and not is_admin:
        await callback.answer("Удалять общие напоминания может только администратор", show_alert=True)
        return

    back = "admin_list" if reminder["scope"] == "global" else "my"
    await show(
        callback,
        f"🗑 Удалить «{escape(reminder['title'])}»?\n\n"
        "<i>История выполнения и прошлые отчёты сохранятся.</i>",
        confirm_delete_keyboard(reminder["id"], back),
    )


@router.callback_query(RemCb.filter(F.action == "delete"))
async def cb_personal_delete(
    callback: CallbackQuery,
    callback_data: RemCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    is_admin: bool,
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None:
        await callback.answer("Напоминание не найдено", show_alert=True)
        return
    if reminder["scope"] == "personal" and reminder["owner_id"] != user["tg_id"]:
        await callback.answer("Это не ваше напоминание", show_alert=True)
        return
    if reminder["scope"] == "global" and not is_admin:
        await callback.answer("Недостаточно прав", show_alert=True)
        return

    await repo.delete_reminder(conn, reminder["id"])
    await callback.answer("Удалено")

    if reminder["scope"] == "global":
        reminders = await repo.list_reminders(conn, scope="global")
        from bot.keyboards import admin_reminders_keyboard

        await show(callback, "📋 <b>Общие напоминания</b>", admin_reminders_keyboard(reminders))
    else:
        text, markup = await _my_view(conn, user["tg_id"])
        await show(callback, text, markup)
