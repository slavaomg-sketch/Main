"""Точка входа веб-панели.

Запуск: `python -m dashboard.main` или `make dashboard`.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import connections
from . import db
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
    yield


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

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon() -> FileResponse:
        return FileResponse(WEB_DIR / "favicon.svg")

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
