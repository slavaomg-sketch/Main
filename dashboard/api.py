"""HTTP API панели."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from . import db
from .aggregator import build_snapshot, cache, normalize_codes
from .blocks import BLOCK_CATALOG, default_layout, new_block
from .config import settings
from .connectors import MARKETPLACE_ORDER, build_connector
from .models import Period
from .security import COOKIE_NAME, SESSION_TTL, issue_token, is_authenticated, password_matches
from .security import require_auth

router = APIRouter(prefix="/api")
guarded = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


# --- служебное ---------------------------------------------------------------


@router.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "demo": settings.force_demo}


@router.get("/session")
async def session(request: Request) -> dict[str, Any]:
    return {
        "authEnabled": settings.auth_enabled,
        "authenticated": is_authenticated(request),
    }


@router.post("/auth/login")
async def login(response: Response, password: str = Body(embed=True, default="")) -> dict[str, Any]:
    if not settings.auth_enabled:
        return {"authenticated": True}
    if not password_matches(password):
        raise HTTPException(status_code=401, detail="Неверный пароль")
    response.set_cookie(
        COOKIE_NAME,
        issue_token(),
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
    )
    return {"authenticated": True}


@router.post("/auth/logout")
async def logout(response: Response) -> dict[str, Any]:
    response.delete_cookie(COOKIE_NAME)
    return {"authenticated": False}


# --- данные ------------------------------------------------------------------


def _period(preset: str, date_from: str | None, date_to: str | None) -> Period:
    if date_from and date_to:
        try:
            start = date.fromisoformat(date_from)
            end = date.fromisoformat(date_to)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Некорректная дата") from exc
        if start > end:
            start, end = end, start
        if (end - start).days > 366:
            raise HTTPException(status_code=400, detail="Период больше года не поддерживается")
        return Period(date_from=start, date_to=end, preset="custom")
    return Period.from_preset(preset)


@guarded.get("/overview")
async def overview(
    preset: str = Query("30d"),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    marketplaces: str | None = Query(None),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    period = _period(preset, date_from, date_to)
    codes = normalize_codes(marketplaces)
    snapshot = await build_snapshot(period, codes, use_cache=not refresh)
    return snapshot.to_dict()


@guarded.get("/marketplaces")
async def marketplaces() -> dict[str, Any]:
    items = []
    for code in MARKETPLACE_ORDER:
        credentials = settings.marketplaces[code]
        connector = build_connector(code)
        items.append(
            {
                "code": code,
                "title": credentials.title,
                "connected": credentials.configured and not settings.force_demo,
                "demo": type(connector).__name__ == "DemoConnector",
                "requires": list(credentials.required),
            }
        )
    return {"marketplaces": items, "forceDemo": settings.force_demo}


@guarded.post("/cache/clear")
async def clear_cache() -> dict[str, Any]:
    await cache.clear()
    return {"cleared": True}


# --- блоки и раскладки -------------------------------------------------------


@guarded.get("/blocks")
async def blocks() -> dict[str, Any]:
    return {"catalog": BLOCK_CATALOG}


@guarded.get("/layouts")
async def layouts() -> dict[str, Any]:
    items = await db.list_layouts()
    active = await db.get_preference("active_layout", items[0]["name"] if items else "")
    if not any(item["name"] == active for item in items) and items:
        active = items[0]["name"]
    return {"layouts": items, "active": active}


@guarded.put("/layouts/{name}")
async def put_layout(name: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict:
    name = name.strip()[:60]
    if not name:
        raise HTTPException(status_code=400, detail="Пустое имя раскладки")
    saved = await db.save_layout(name, payload.get("blocks"))
    await db.set_preference("active_layout", name)
    return saved


@guarded.delete("/layouts/{name}")
async def remove_layout(name: str) -> dict[str, Any]:
    deleted = await db.delete_layout(name)
    if not deleted:
        raise HTTPException(status_code=400, detail="Нельзя удалить последнюю раскладку")
    items = await db.list_layouts()
    if items:
        await db.set_preference("active_layout", items[0]["name"])
    return {"deleted": True}


@guarded.post("/layouts/{name}/rename")
async def move_layout(name: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict:
    new_name = str(payload.get("name") or "").strip()[:60]
    if not new_name:
        raise HTTPException(status_code=400, detail="Пустое имя раскладки")
    if not await db.rename_layout(name, new_name):
        raise HTTPException(status_code=409, detail="Раскладка с таким именем уже есть")
    await db.set_preference("active_layout", new_name)
    return {"name": new_name}


@guarded.post("/layouts/{name}/reset")
async def reset_layout(name: str) -> dict[str, Any]:
    return await db.save_layout(name, default_layout())


@guarded.post("/blocks/instance")
async def create_block(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    block_type = str(payload.get("type") or "")
    if block_type not in {item["type"] for item in BLOCK_CATALOG}:
        raise HTTPException(status_code=400, detail="Неизвестный тип блока")
    return new_block(block_type, payload.get("size"))


@guarded.post("/preferences/{key}")
async def save_preference(key: str, payload: dict[str, Any] = Body(default_factory=dict)) -> dict:
    await db.set_preference(key[:40], str(payload.get("value") or "")[:200])
    return {"saved": True}
