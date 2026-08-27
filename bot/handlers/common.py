"""Старт, меню, справка, настройки и часовой пояс."""

from __future__ import annotations

import aiosqlite
from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot import repo, reports
from bot.callbacks import Nav, TzCb
from bot.config import Config
from bot.handlers._helpers import show
from bot.keyboards import BTN_SETTINGS, BTN_STATS, main_menu, settings_keyboard, tz_keyboard
from bot.messages import ADMIN_HELP, GREETING, HELP
from bot.utils import POPULAR_TZ, escape, local_now

router = Router(name="common")


@router.message(CommandStart())
async def cmd_start(
    message: Message,
    state: FSMContext,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    is_admin: bool,
) -> None:
    await state.clear()
    added = await repo.sync_mandatory_subscriptions(conn, user["tg_id"])

    text = GREETING.format(name=escape(user["full_name"]))
    if added:
        text += f"\n\n🔔 Вам подключено обязательных напоминаний: <b>{added}</b>."
    await message.answer(text, reply_markup=main_menu(is_admin))


@router.message(Command("menu"))
async def cmd_menu(message: Message, state: FSMContext, is_admin: bool) -> None:
    await state.clear()
    await message.answer("Главное меню", reply_markup=main_menu(is_admin))


@router.message(Command("help"))
async def cmd_help(message: Message, is_admin: bool) -> None:
    await message.answer(HELP + ("\n\n" + ADMIN_HELP if is_admin else ""))


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext, is_admin: bool) -> None:
    await state.clear()
    await message.answer("Отменил.", reply_markup=main_menu(is_admin))


@router.callback_query(Nav.filter(F.to == "cancel"))
async def cb_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await show(callback, "Отменил. Откройте нужный раздел кнопками меню внизу.")


@router.message(F.text == BTN_STATS)
@router.message(Command("stats"))
async def cmd_stats(message: Message, conn: aiosqlite.Connection, user: aiosqlite.Row) -> None:
    await message.answer(await reports.build_user_summary(conn, user["tg_id"]))


# ---------------------------------------------------------------------- настройки


@router.message(F.text == BTN_SETTINGS)
@router.message(Command("settings"))
async def cmd_settings(
    message: Message, state: FSMContext, user: aiosqlite.Row, config: Config
) -> None:
    await state.clear()
    await message.answer(_settings_text(user, config), reply_markup=settings_keyboard(user["tz"]))


@router.callback_query(Nav.filter(F.to == "settings"))
async def cb_settings(callback: CallbackQuery, user: aiosqlite.Row, config: Config) -> None:
    await show(callback, _settings_text(user, config), settings_keyboard(user["tz"]))


@router.callback_query(Nav.filter(F.to == "tz"))
async def cb_tz_list(callback: CallbackQuery) -> None:
    await show(
        callback,
        "🌍 <b>Часовой пояс</b>\n\nВыберите свой город — от него зависит, "
        "в какое время придут напоминания.",
        tz_keyboard(),
    )


@router.callback_query(TzCb.filter())
async def cb_tz_set(
    callback: CallbackQuery,
    callback_data: TzCb,
    conn: aiosqlite.Connection,
    user: aiosqlite.Row,
    config: Config,
) -> None:
    if not 0 <= callback_data.index < len(POPULAR_TZ):
        await callback.answer("Не нашёл такой пояс", show_alert=True)
        return

    label, tz_name = POPULAR_TZ[callback_data.index]
    await repo.set_user_tz(conn, user["tg_id"], tz_name)
    updated = await repo.get_user(conn, user["tg_id"])
    assert updated is not None

    await callback.answer(f"Часовой пояс: {label}")
    await show(callback, _settings_text(updated, config), settings_keyboard(tz_name))


def _settings_text(user: aiosqlite.Row, config: Config) -> str:
    moment = local_now(user["tz"], config.default_tz)
    return (
        "⚙️ <b>Настройки</b>\n\n"
        f"🌍 Часовой пояс: <b>{escape(user['tz'])}</b>\n"
        f"🕐 Ваше текущее время: <b>{moment:%H:%M}</b>\n\n"
        "<i>Если время показано неверно — смените часовой пояс, иначе напоминания "
        "будут приходить не тогда, когда нужно.</i>"
    )
