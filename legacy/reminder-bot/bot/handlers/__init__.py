"""Регистрация роутеров бота."""

from aiogram import Router

from bot.handlers import admin, checklist, common, employee

_root: Router | None = None


def build_router() -> Router:
    """Порядок важен: специализированные роутеры идут раньше общих.

    Роутеры в модулях — объекты уровня модуля, поэтому прикрепить их можно лишь
    один раз за процесс. Результат кэшируется, чтобы повторный вызов не падал.
    """
    global _root
    if _root is None:
        _root = Router(name="root")
        _root.include_router(checklist.router)
        _root.include_router(admin.router)
        _root.include_router(employee.router)
        _root.include_router(common.router)
    return _root


__all__ = ["build_router"]
