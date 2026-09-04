"""Админка: общие напоминания, сотрудники, отчёты."""

from __future__ import annotations

import aiosqlite
from aiogram import Bot, F, Router
from aiogram.filters import BaseFilter, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from bot import repo, reports
from bot.callbacks import DayCb, EmpCb, Nav, RemCb, ReportCb, TimeCb
from bot.config import Config
from bot.handlers._helpers import show
from bot.keyboards import (
    BTN_ADMIN,
    admin_menu,
    admin_reminder_card,
    admin_reminders_keyboard,
    checklist_edit_keyboard,
    days_keyboard,
    staff_card,
    staff_keyboard,
    time_keyboard,
)
from bot.messages import ADMIN_HELP, render_reminder_card
from bot.scheduler import local_date_for
from bot.utils import WORKDAYS, days_to_str, escape, format_days, parse_days, parse_time

router = Router(name="admin")


class IsAdmin(BaseFilter):
    async def __call__(self, event: Message | CallbackQuery, is_admin: bool = False) -> bool:
        return is_admin


router.message.filter(IsAdmin())
router.callback_query.filter(IsAdmin())


class AdminNew(StatesGroup):
    title = State()
    description = State()
    items = State()
    time = State()
    days = State()


class AdminEdit(StatesGroup):
    time = State()
    days = State()


# ------------------------------------------------------------------ главное меню


@router.message(F.text == BTN_ADMIN)
@router.message(Command("admin"))
async def cmd_admin(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(ADMIN_HELP, reply_markup=admin_menu())


@router.callback_query(Nav.filter(F.to == "admin"))
async def cb_admin(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await show(callback, ADMIN_HELP, admin_menu())


# ----------------------------------------------------- создание общего напоминания


@router.callback_query(Nav.filter(F.to == "admin_new"))
async def cb_admin_new(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(AdminNew.title)
    await callback.answer()
    await callback.message.answer(
        "➕ <b>Новое общее напоминание</b>\n\n"
        "Шаг 1 из 5. Название процесса.\n"
        "<i>Например: «Открытие смены» или «Вечерняя сверка кассы».</i>\n\n"
        "Отмена — /cancel"
    )


@router.message(AdminNew.title)
async def admin_title(message: Message, state: FSMContext) -> None:
    title = (message.text or "").strip()
    if not 2 <= len(title) <= 100:
        await message.answer("Название должно быть от 2 до 100 символов.")
        return
    await state.update_data(title=title)
    await state.set_state(AdminNew.description)
    await message.answer(
        "Шаг 2 из 5. Пояснение для сотрудника — что именно нужно сделать.\n\n"
        "Отправьте <b>-</b>, если не нужно."
    )


@router.message(AdminNew.description)
async def admin_description(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    await state.update_data(description=None if raw in ("-", "—", "") else raw[:500], items=[])
    await state.set_state(AdminNew.items)
    await message.answer(
        "Шаг 3 из 5. <b>Чек-лист.</b>\n\n"
        "Пункты, которые сотрудник будет отмечать галочками. "
        "Присылайте по одному или списком в одном сообщении.",
        reply_markup=checklist_edit_keyboard(0),
    )


@router.message(AdminNew.items)
async def admin_items(message: Message, state: FSMContext) -> None:
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
        f"<b>Пункты ({len(items)}):</b>\n{listing}\n\nДобавьте ещё или нажмите «Готово, дальше».",
        reply_markup=checklist_edit_keyboard(len(items)),
    )


@router.callback_query(AdminNew.items, Nav.filter(F.to.in_({"items_done", "items_skip"})))
async def admin_items_done(callback: CallbackQuery, callback_data: Nav, state: FSMContext) -> None:
    if callback_data.to == "items_skip":
        await state.update_data(items=[])
    await state.set_state(AdminNew.time)
    await callback.answer()
    await show(
        callback,
        "Шаг 4 из 5. Время по умолчанию.\n"
        "<i>Сотрудник сможет сдвинуть его под свой график.</i>",
        time_keyboard(cancel_to="admin"),
    )


@router.callback_query(AdminNew.time, TimeCb.filter())
async def admin_time_pick(callback: CallbackQuery, callback_data: TimeCb, state: FSMContext) -> None:
    if callback_data.value == "manual":
        await callback.answer()
        await callback.message.answer("Введите время в формате <b>ЧЧ:ММ</b>")
        return
    await state.update_data(time=callback_data.value, days=parse_days(WORKDAYS))
    await state.set_state(AdminNew.days)
    await callback.answer()
    await show(
        callback,
        f"Шаг 5 из 5. Время <b>{callback_data.value}</b>. В какие дни?",
        days_keyboard(parse_days(WORKDAYS)),
    )


@router.message(AdminNew.time)
async def admin_time_manual(message: Message, state: FSMContext) -> None:
    value = parse_time(message.text or "")
    if not value:
        await message.answer("Не понял время. Формат <b>ЧЧ:ММ</b>, например 09:30")
        return
    await state.update_data(time=value, days=parse_days(WORKDAYS))
    await state.set_state(AdminNew.days)
    await message.answer(
        f"Шаг 5 из 5. Время <b>{value}</b>. В какие дни?",
        reply_markup=days_keyboard(parse_days(WORKDAYS)),
    )


@router.callback_query(AdminNew.days, DayCb.filter())
async def admin_days_pick(
    callback: CallbackQuery,
    callback_data: DayCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
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

        reminder_id = await repo.create_reminder(
            conn,
            title=data["title"],
            description=data.get("description"),
            scope="global",
            owner_id=user["tg_id"],
            default_time=data["time"],
            days=days_to_str(sorted(selected)),
            is_mandatory=True,
        )
        await repo.set_checklist(conn, reminder_id, data.get("items", []))
        added = await repo.subscribe_all_employees(conn, reminder_id, data["time"])
        await state.clear()

        reminder = await repo.get_reminder(conn, reminder_id)
        items = await repo.list_checklist(conn, reminder_id)
        assert reminder is not None

        await callback.answer("Напоминание создано")
        await show(
            callback,
            f"✅ <b>Создано.</b> Подключено сотрудникам: <b>{added}</b>\n\n"
            + render_reminder_card(reminder, items, subscribers=added),
            admin_reminder_card(reminder),
        )
        return

    await state.update_data(days=sorted(selected))
    await callback.answer()
    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=days_keyboard(sorted(selected)))


# ------------------------------------------------------------ список напоминаний


@router.callback_query(Nav.filter(F.to == "admin_list"))
async def cb_admin_list(callback: CallbackQuery, state: FSMContext, conn: aiosqlite.Connection) -> None:
    await state.clear()
    reminders = await repo.list_reminders(conn, scope="global")
    if not reminders:
        await show(
            callback,
            "📋 <b>Общие напоминания</b>\n\nПока ни одного. Нажмите «Создать».",
            admin_reminders_keyboard([]),
        )
        return

    lines = ["📋 <b>Общие напоминания</b>", ""]
    for reminder in reminders:
        lock = "🔒" if reminder["is_mandatory"] else "🔓"
        subscribers = await repo.count_subscribers(conn, reminder["id"])
        lines.append(f"{lock} <b>{reminder['default_time']}</b> — {escape(reminder['title'])}")
        lines.append(f"      <i>{format_days(reminder['days'])} · подписано {subscribers}</i>")
    await show(callback, "\n".join(lines), admin_reminders_keyboard(reminders))


@router.callback_query(RemCb.filter(F.action == "admin_open"))
async def cb_admin_open(
    callback: CallbackQuery, callback_data: RemCb, conn: aiosqlite.Connection
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None:
        await callback.answer("Не найдено", show_alert=True)
        return
    items = await repo.list_checklist(conn, reminder["id"])
    subscribers = await repo.count_subscribers(conn, reminder["id"])
    await show(
        callback,
        render_reminder_card(reminder, items, subscribers=subscribers),
        admin_reminder_card(reminder),
    )


@router.callback_query(RemCb.filter(F.action == "toggle_mandatory"))
async def cb_toggle_mandatory(
    callback: CallbackQuery, callback_data: RemCb, conn: aiosqlite.Connection
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None:
        await callback.answer("Не найдено", show_alert=True)
        return

    new_value = 0 if reminder["is_mandatory"] else 1
    await repo.update_reminder(conn, reminder["id"], is_mandatory=new_value)
    if new_value:
        await repo.subscribe_all_employees(conn, reminder["id"], reminder["default_time"])

    updated = await repo.get_reminder(conn, reminder["id"])
    assert updated is not None
    items = await repo.list_checklist(conn, updated["id"])
    subscribers = await repo.count_subscribers(conn, updated["id"])
    await callback.answer("Обязательное" if new_value else "По желанию")
    await show(
        callback,
        render_reminder_card(updated, items, subscribers=subscribers),
        admin_reminder_card(updated),
    )


@router.callback_query(RemCb.filter(F.action == "push_all"))
async def cb_push_all(
    callback: CallbackQuery, callback_data: RemCb, conn: aiosqlite.Connection
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None:
        await callback.answer("Не найдено", show_alert=True)
        return
    added = await repo.subscribe_all_employees(conn, reminder["id"], reminder["default_time"])
    await callback.answer(
        f"Подключил новых сотрудников: {added}" if added else "Все уже подписаны", show_alert=True
    )


@router.callback_query(RemCb.filter(F.action == "admin_time"))
async def cb_admin_edit_time(
    callback: CallbackQuery, callback_data: RemCb, state: FSMContext
) -> None:
    await state.set_state(AdminEdit.time)
    await state.update_data(rem_id=callback_data.rem_id)
    await show(
        callback,
        "🕐 Новое время по умолчанию.\n"
        "<i>У тех, кто уже настроил своё время, оно не изменится.</i>",
        time_keyboard(cancel_to="admin_list"),
    )


@router.callback_query(AdminEdit.time, TimeCb.filter())
async def cb_admin_edit_time_pick(
    callback: CallbackQuery,
    callback_data: TimeCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
) -> None:
    if callback_data.value == "manual":
        await callback.answer()
        await callback.message.answer("Введите время в формате <b>ЧЧ:ММ</b>")
        return
    data = await state.get_data()
    await repo.update_reminder(conn, data["rem_id"], default_time=callback_data.value)
    await state.clear()
    await callback.answer(f"Время: {callback_data.value}")
    await _render_admin_card(callback, conn, data["rem_id"])


@router.message(AdminEdit.time)
async def msg_admin_edit_time(
    message: Message, state: FSMContext, conn: aiosqlite.Connection
) -> None:
    value = parse_time(message.text or "")
    if not value:
        await message.answer("Не понял время. Формат <b>ЧЧ:ММ</b>")
        return
    data = await state.get_data()
    await repo.update_reminder(conn, data["rem_id"], default_time=value)
    await state.clear()

    reminder = await repo.get_reminder(conn, data["rem_id"])
    assert reminder is not None
    items = await repo.list_checklist(conn, reminder["id"])
    await message.answer(
        f"✅ Время по умолчанию: <b>{value}</b>\n\n" + render_reminder_card(reminder, items),
        reply_markup=admin_reminder_card(reminder),
    )


@router.callback_query(RemCb.filter(F.action == "admin_days"))
async def cb_admin_edit_days(
    callback: CallbackQuery,
    callback_data: RemCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
) -> None:
    reminder = await repo.get_reminder(conn, callback_data.rem_id)
    if reminder is None:
        await callback.answer("Не найдено", show_alert=True)
        return
    selected = parse_days(reminder["days"])
    await state.set_state(AdminEdit.days)
    await state.update_data(rem_id=reminder["id"], days=selected)
    await show(callback, "📅 В какие дни присылать?", days_keyboard(selected))


@router.callback_query(AdminEdit.days, DayCb.filter())
async def cb_admin_edit_days_pick(
    callback: CallbackQuery,
    callback_data: DayCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
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
        await repo.update_reminder(conn, data["rem_id"], days=days_to_str(sorted(selected)))
        await state.clear()
        await callback.answer("Дни сохранены")
        await _render_admin_card(callback, conn, data["rem_id"])
        return

    await state.update_data(days=sorted(selected))
    await callback.answer()
    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=days_keyboard(sorted(selected)))


async def _render_admin_card(
    callback: CallbackQuery, conn: aiosqlite.Connection, reminder_id: int
) -> None:
    reminder = await repo.get_reminder(conn, reminder_id)
    if reminder is None:
        return
    items = await repo.list_checklist(conn, reminder_id)
    subscribers = await repo.count_subscribers(conn, reminder_id)
    await show(
        callback,
        render_reminder_card(reminder, items, subscribers=subscribers),
        admin_reminder_card(reminder),
    )


# ------------------------------------------------------------------- сотрудники


@router.callback_query(Nav.filter(F.to == "admin_staff"))
async def cb_staff(callback: CallbackQuery, state: FSMContext, conn: aiosqlite.Connection) -> None:
    await state.clear()
    employees = await repo.list_users(conn, only_active=False)
    if not employees:
        await show(callback, "👥 Пока никто не запустил бота.", staff_keyboard([]))
        return

    lines = ["👥 <b>Сотрудники</b>", ""]
    for employee in employees:
        mark = "🟢" if employee["is_active"] else "⛔️"
        role = " 👑" if employee["role"] == "admin" else ""
        subs = len(await repo.list_subscriptions(conn, employee["tg_id"]))
        lines.append(f"{mark} <b>{escape(employee['full_name'])}</b>{role}")
        lines.append(f"      <i>{escape(employee['tz'])} · напоминаний: {subs}</i>")
    lines += ["", "<i>Новый сотрудник появляется здесь после команды /start в боте.</i>"]
    await show(callback, "\n".join(lines), staff_keyboard(employees))


@router.callback_query(EmpCb.filter())
async def cb_staff_card(
    callback: CallbackQuery,
    callback_data: EmpCb,
    conn: aiosqlite.Connection,
    config: Config,
) -> None:
    employee = await repo.get_user(conn, callback_data.user_id)
    if employee is None:
        await callback.answer("Сотрудник не найден", show_alert=True)
        return

    if callback_data.action in ("block", "unblock"):
        if employee["tg_id"] in config.admin_ids and callback_data.action == "block":
            await callback.answer("Администратора из .env отключить нельзя", show_alert=True)
            return
        await repo.set_user_active(conn, employee["tg_id"], callback_data.action == "unblock")
        employee = await repo.get_user(conn, callback_data.user_id)
        assert employee is not None
        await callback.answer("Готово")

    subs = await repo.list_subscriptions(conn, employee["tg_id"])
    stats = await repo.user_stats(conn, employee["tg_id"], days=7)
    lines = [
        f"👤 <b>{escape(employee['full_name'])}</b>",
        f"ID: <code>{employee['tg_id']}</code>",
        f"Роль: {'администратор' if employee['role'] == 'admin' else 'сотрудник'}",
        f"Часовой пояс: {escape(employee['tz'])}",
        f"Статус: {'🟢 активен' if employee['is_active'] else '⛔️ отключён'}",
        "",
        f"🔔 Напоминаний: <b>{len(subs)}</b>",
    ]
    for sub in subs:
        lines.append(f"   • {sub['time']} — {escape(sub['title'])}")
    if stats and stats["total"]:
        lines += [
            "",
            f"📊 За 7 дней: ✅ {stats['done'] or 0} · 🟡 {stats['partial'] or 0} "
            f"· ❌ {stats['missed'] or 0} из {stats['total']}",
        ]
    await show(callback, "\n".join(lines), staff_card(employee))


# ----------------------------------------------------------------------- отчёты


@router.message(Command("report"))
async def cmd_report(
    message: Message, conn: aiosqlite.Connection, user: aiosqlite.Row, config: Config
) -> None:
    await _send_report(message, conn, user, config, offset=0)


@router.message(Command("report_yesterday"))
async def cmd_report_yesterday(
    message: Message, conn: aiosqlite.Connection, user: aiosqlite.Row, config: Config
) -> None:
    await _send_report(message, conn, user, config, offset=1)


async def _send_report(
    message: Message,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    config: Config,
    offset: int,
) -> None:
    local_date = local_date_for(user["tz"], config.default_tz, offset)
    text = await reports.build_daily_report(conn, local_date)
    for part in reports.chunk(text):
        await message.answer(part)


@router.callback_query(ReportCb.filter(F.action == "show"))
async def cb_report(
    callback: CallbackQuery,
    callback_data: ReportCb,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    config: Config,
) -> None:
    from bot.keyboards import report_nav

    await state.clear()
    local_date = local_date_for(user["tz"], config.default_tz, callback_data.offset)
    text = await reports.build_daily_report(conn, local_date)
    parts = reports.chunk(text)

    await show(callback, parts[0], report_nav(callback_data.offset) if len(parts) == 1 else None)
    for part in parts[1:-1]:
        await callback.message.answer(part)
    if len(parts) > 1:
        await callback.message.answer(parts[-1], reply_markup=report_nav(callback_data.offset))


@router.message(Command("broadcast"))
async def cmd_broadcast(message: Message, bot: Bot, conn: aiosqlite.Connection) -> None:
    text = (message.text or "").partition(" ")[2].strip()
    if not text:
        await message.answer("Использование: <code>/broadcast текст сообщения</code>")
        return

    sent = 0
    for employee in await repo.list_users(conn, only_active=True):
        try:
            await bot.send_message(employee["tg_id"], f"📢 <b>Объявление</b>\n\n{escape(text)}")
            sent += 1
        except Exception:  # noqa: BLE001 — один недоступный сотрудник не должен ломать рассылку
            continue
    await message.answer(f"Отправлено сотрудникам: <b>{sent}</b>")
