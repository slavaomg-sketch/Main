"""HTTP API панели."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from . import connections as conn
from . import db
from .aggregator import build_snapshot, cache, normalize_codes
from .blocks import BLOCK_CATALOG, default_layout, new_block
from .config import settings
from .connectors import MARKETPLACE_ORDER, REAL_CONNECTORS
from .diagnose import probe_to_dict, secret_values
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
    stores = await conn.load(settings)
    snapshot = await build_snapshot(
        period, codes, use_cache=not refresh, connections=stores
    )
    return snapshot.to_dict()


@guarded.get("/marketplaces")
async def marketplaces() -> dict[str, Any]:
    stores = await conn.load(settings)
    items = []
    for code in MARKETPLACE_ORDER:
        base = settings.marketplaces[code]
        ready = conn.active(stores, (code,))
        items.append(
            {
                "code": code,
                "title": base.title,
                "connected": bool(ready) and not settings.force_demo,
                "demo": not ready or settings.force_demo,
                "stores": len(ready),
                "storeTitles": [store.title for store in ready],
                "requires": list(base.required),
            }
        )
    return {"marketplaces": items, "forceDemo": settings.force_demo}


# --- магазины и их ключи --------------------------------------------------------


async def _connections_payload() -> dict[str, Any]:
    stores = await conn.load(settings)
    return {
        "marketplaces": conn.describe(stores, settings),
        "authEnabled": settings.auth_enabled,
        "secretIsDefault": conn.secret_is_default(),
        "forceDemo": settings.force_demo,
    }


@guarded.get("/connections")
async def read_connections() -> dict[str, Any]:
    """Состояние магазинов: что заполнено. Самих ключей здесь нет."""
    return await _connections_payload()


@guarded.post("/connections")
async def add_connection(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    code = str(payload.get("marketplace") or "")
    if code not in MARKETPLACE_ORDER:
        raise HTTPException(status_code=404, detail="Неизвестная площадка")
    title = str(payload.get("title") or "").strip() or f"{settings.marketplaces[code].title} — магазин"
    try:
        created = await conn.create(code, title, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return dict(await _connections_payload(), created=created.id)


@guarded.put("/connections/{connection_id}")
async def edit_connection(
    connection_id: str, payload: dict[str, Any] = Body(default_factory=dict)
) -> dict[str, Any]:
    try:
        if "title" in payload or "enabled" in payload:
            await conn.update(
                connection_id,
                title=str(payload["title"]) if "title" in payload else None,
                enabled=bool(payload["enabled"]) if "enabled" in payload else None,
            )
        values = payload.get("values")
        if isinstance(values, dict):
            await conn.save_values(
                connection_id, {str(key): str(value) for key, value in values.items()}
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await cache.clear()  # следующий запрос должен пойти уже с новыми ключами
    return await _connections_payload()


@guarded.delete("/connections/{connection_id}")
async def remove_connection(connection_id: str) -> dict[str, Any]:
    try:
        await conn.delete(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await cache.clear()
    return await _connections_payload()


@guarded.post("/connections/{connection_id}/test")
async def test_connection(connection_id: str) -> dict[str, Any]:
    """Сделать реальные запросы к площадке и вернуть структуру ответа."""
    store = await conn.get(connection_id, settings)
    if store is None:
        raise HTTPException(status_code=404, detail="Магазин не найден")

    credentials = store.credentials(settings)
    if not credentials.configured:
        return {
            "id": store.id,
            "ok": False,
            "reason": "Заполните обязательные поля",
            "missing": store.missing(settings),
            "probes": [],
        }

    connector = REAL_CONNECTORS[store.marketplace](credentials)
    period = Period.from_preset("7d")
    secrets = secret_values(settings) + [
        value for value in credentials.values.values() if value and len(value) >= 6
    ]

    probes = [probe_to_dict(probe, secrets) for probe in await connector.probe(period)]
    report = await connector.safe_fetch(period)

    return {
        "id": store.id,
        "ok": all(probe["ok"] for probe in probes) and not report.error,
        "period": period.to_dict(),
        "probes": probes,
        "summary": {
            "error": report.error,
            "days": len(report.series),
            "orders": report.orders,
            "products": len(report.products),
            "hasRevenue": bool(report.revenue),
            "hasStock": bool(report.stock_units),
        },
    }


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
