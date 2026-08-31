"""Точка входа веб-панели.

Запуск: `python -m dashboard.main` или `make dashboard`.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import connections
from . import db
from . import warehouse
from .api import guarded, router
from .config import WEB_DIR, settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("dashboard")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()

    # Ключи живут и в .env, и в базе (страница «Ключи»), поэтому считаем
    # магазины по итоговому списку подключений, а не только по окружению.
    stores = await connections.load(settings)
    ready = [store for store in stores if store.enabled and store.configured]

    if settings.force_demo:
        log.info("Панель запущена в демо-режиме (DASHBOARD_DEMO=1)")
    elif ready:
        log.info(
            "Подключено магазинов: %d (%s)",
            len(ready),
            ", ".join(sorted({store.title for store in ready})),
        )
    else:
        log.info("Магазины не добавлены — панель покажет нули до ввода ключей")

    # Данные площадок выгружаются в фоне: страница читает их из базы и не ждёт
    # ответа маркетплейса.
    syncer = asyncio.create_task(warehouse.background_loop(settings)) if ready else None
    if syncer:
        log.info(
            "Фоновая выгрузка запущена: раз в %d мин, история %d дн.",
            settings.sync_minutes,
            settings.history_days,
        )

    try:
        yield
    finally:
        if syncer:
            syncer.cancel()
            with suppress(asyncio.CancelledError):
                await syncer


def create_app() -> FastAPI:
    app = FastAPI(
        title="Панель маркетплейсов",
        version="1.0.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.include_router(router)
    app.include_router(guarded)

    app.mount("/assets", StaticFiles(directory=WEB_DIR), name="assets")

    # Разделы панели. Все они — один и тот же файл оболочки: какой раздел
    # показать, решает уже браузер по адресу. Список явный, а не «всё
    # подряд»: иначе он проглотил бы /api и /assets.
    SECTIONS = (
        "/", "/actions", "/catalog", "/customers", "/finance",
        "/automations", "/settings",
        # Старые адреса. Оболочка сама переведёт их на новые, но сервер
        # обязан отдать по ним страницу: на них есть закладки и ссылки.
        "/products", "/knowledge", "/tasks",
    )

    def is_section(path: str) -> bool:
        """Адрес раздела или что-то внутри него — например /catalog/p/UA-TC."""
        return any(
            path == section or path.startswith(section.rstrip("/") + "/")
            for section in SECTIONS
        )

    @app.middleware("http")
    async def no_stale_assets(request: Request, call_next):
        """Заставить браузер проверять свежесть страницы и скриптов.

        Без этого браузер решает сам, и решает плохо: панель обновляется
        по нескольку раз в день, а он может отдать свежую страницу вместе
        со старым скриптом. Внешне это выглядит как «кнопка есть, но
        не работает» — именно так и случилось с разделом «Задачи».

        `no-cache` не запрещает кэш, а требует переспросить сервер. Файл
        не изменился — приходит короткий ответ «берите из кэша».
        """
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/") or path == "/favicon.svg" or is_section(path):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon() -> FileResponse:
        return FileResponse(WEB_DIR / "favicon.svg")

    # Ловит всё, что осталось, поэтому объявлен последним: до него уже
    # разобраны /api, /assets и значок.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def shell(full_path: str) -> FileResponse:
        """Оболочка панели: слева разделы, сверху контекст, внутри — раздел.

        Один файл на все адреса. Раздел выбирается в браузере по адресу,
        поэтому перезагрузка, «назад» и прямая ссылка работают сами собой,
        а переход между разделами не перезагружает страницу.

        Неизвестный адрес — тоже оболочка: она покажет «раздел не найден»
        и предложит вернуться. Молча ронять 404 в лицо владельцу незачем.
        """
        return FileResponse(WEB_DIR / "app.html")

    return app


app = create_app()


def main() -> None:
    uvicorn.run(
        "dashboard.main:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
