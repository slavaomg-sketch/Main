"""HTTP API панели."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from . import connections as conn
from . import db
from . import warehouse
from . import agent, inbox, pipeline
from .aggregator import build_snapshot, cache, normalize_codes, normalize_stores
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
    # `agent` — виден ли панели мост к Codex. Ни ключей, ни данных здесь нет,
    # зато сразу понятно, почему кнопка черновика не появилась.
    return {"status": "ok", "demo": settings.force_demo, "agent": agent.available(settings)}


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


def _period(
    preset: str, date_from: str | None, date_to: str | None, skip_today: bool = False
) -> Period:
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
        until = datetime.now() if end >= date.today() else None
        return Period(date_from=start, date_to=end, preset="custom", until=until)
    return Period.from_preset(preset, skip_today=skip_today)


@guarded.get("/overview")
async def overview(
    preset: str = Query("30d"),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    marketplaces: str | None = Query(None),
    stores: str | None = Query(None),
    skip_today: bool = Query(False, alias="skipToday"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    period = _period(preset, date_from, date_to, skip_today)
    codes = normalize_codes(marketplaces)
    all_stores = await conn.load(settings)

    # Фильтр по магазинам сужает выбор внутри своей площадки и только там.
    # Иначе выбор кабинета Wildberries молча обнулял бы Ozon: у него в
    # отфильтрованном списке не осталось бы ни одного магазина.
    picked = normalize_stores(stores, all_stores)
    selected = conn.narrow(all_stores, picked)

    snapshot = await build_snapshot(
        period,
        codes,
        use_cache=not refresh,
        connections=selected,
        scope=",".join(picked),
    )
    return snapshot.to_dict()


@guarded.get("/marketplaces")
async def marketplaces() -> dict[str, Any]:
    stores = await conn.load(settings)
    items = []
    for code in MARKETPLACE_ORDER:
        base = settings.marketplaces[code]
        ready = conn.active(stores, (code,))
        if settings.force_demo:
            state = "demo"
        elif ready:
            state = "connected"
        else:
            state = "empty"
        items.append(
            {
                "code": code,
                "title": base.title,
                "state": state,
                "connected": state == "connected",
                "demo": state == "demo",
                "stores": len(ready),
                "storeTitles": [store.title for store in ready],
                "requires": list(base.required),
            }
        )
    # Плоский список кабинетов — для переключателя «все магазины / по одному».
    ready = conn.active(stores, tuple(MARKETPLACE_ORDER))
    return {
        "marketplaces": items,
        "stores": [
            {"id": store.id, "title": store.title, "marketplace": store.marketplace}
            for store in ready
        ],
        "forceDemo": settings.force_demo,
    }


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

    if isinstance(payload.get("values"), dict):
        # Ключи сменились — прежняя выгрузка относится к другому кабинету.
        await warehouse.forget(connection_id)
    await cache.clear()  # следующий запрос должен пойти уже с новыми ключами
    return await _connections_payload()


@guarded.delete("/connections/{connection_id}")
async def remove_connection(connection_id: str) -> dict[str, Any]:
    try:
        await conn.delete(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await warehouse.forget(connection_id)
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

    # Только пробные запросы: собирать полный отчёт здесь не нужно, а лишние
    # обращения упираются в лимиты площадок (Wildberries считает их строго).
    probes = [probe_to_dict(probe, secrets) for probe in await connector.probe(period)]
    working = [probe for probe in probes if probe["ok"]]

    return {
        "id": store.id,
        "ok": bool(working) and all(probe["ok"] for probe in probes),
        "partial": bool(working) and not all(probe["ok"] for probe in probes),
        "period": period.to_dict(),
        "probes": probes,
        "summary": {
            "working": len(working),
            "total": len(probes),
            "rows": sum(probe.get("rows") or 0 for probe in probes),
        },
    }


# --- входящие: обращения покупателей --------------------------------------------


@guarded.get("/inbox")
async def read_inbox() -> dict[str, Any]:
    """Всё, что ждёт ответа: отзывы, вопросы, заявки — по всем магазинам."""
    payload = await inbox.collect(settings)
    # Панель показывает кнопку черновика, только если помощник на связи.
    payload["agent"] = agent.available(settings)
    return payload


@guarded.post("/inbox/draft")
async def draft_inbox(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    """Черновик ответа от помощника. Никуда не отправляется — только в поле."""
    account = str(payload.get("accountId") or "").strip()
    kind = str(payload.get("kind") or "").strip()
    item_id = str(payload.get("id") or "").strip()

    if not (account and kind and item_id):
        raise HTTPException(status_code=400, detail="Не хватает данных для черновика")

    item = inbox.find(account, kind, item_id)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Обращение не найдено — обновите входящие и попробуйте снова",
        )

    try:
        written = await agent.draft(item.to_dict(), item.account_title, settings)
    except agent.AgentUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return written.to_dict()


@guarded.post("/inbox/batch")
async def start_batch(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    """Запустить разбор пачки. Черновики пишутся в фоне, ответ — сразу."""
    account = str(payload.get("accountId") or "").strip()
    kind = str(payload.get("kind") or "").strip()
    ids = payload.get("ids")

    if not (account and kind) or not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="Не хватает данных для разбора")
    if kind not in inbox.CHAPTER_TITLES:
        raise HTTPException(status_code=400, detail="Неизвестный раздел входящих")
    if not agent.available(settings):
        raise HTTPException(status_code=503, detail="Помощник не настроен на сервере")

    batch = pipeline.start(account, kind, [str(item) for item in ids], settings)
    return batch.to_dict()


@guarded.get("/inbox/batch/{batch_id}")
async def read_batch(batch_id: str) -> dict[str, Any]:
    """Как идёт разбор пачки и что уже написано."""
    batch = pipeline.get(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Пачка не найдена")
    return batch.to_dict()


@guarded.post("/inbox/send")
async def send_batch(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    """Отправить разом то, что владелец утвердил. Действие необратимое —
    вызывается только по явному нажатию в панели."""
    account = str(payload.get("accountId") or "").strip()
    kind = str(payload.get("kind") or "").strip()
    answers = payload.get("answers")

    if not (account and kind) or not isinstance(answers, dict) or not answers:
        raise HTTPException(status_code=400, detail="Нечего отправлять")
    if kind not in inbox.CHAPTER_TITLES:
        raise HTTPException(status_code=400, detail="Неизвестный раздел входящих")
    if len(answers) > pipeline.MAX_BATCH:
        raise HTTPException(status_code=400, detail="Слишком много ответов за раз")

    return await pipeline.send_all(
        account, kind, {str(key): str(value) for key, value in answers.items()}, settings
    )


@guarded.post("/inbox/answer")
async def answer_inbox(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    """Отправить ответ покупателю. Действие публичное и необратимое —
    поэтому вызывается только по явному нажатию в панели."""
    account = str(payload.get("accountId") or "").strip()
    kind = str(payload.get("kind") or "").strip()
    item_id = str(payload.get("id") or "").strip()
    text = str(payload.get("text") or "").strip()

    if not (account and kind and item_id and text):
        raise HTTPException(status_code=400, detail="Не хватает данных для ответа")
    if kind not in inbox.CHAPTER_TITLES:
        raise HTTPException(status_code=400, detail="Неизвестный раздел входящих")

    try:
        await inbox.reply(account, kind, item_id, text, settings)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Магазин не найден") from exc
    except Exception as exc:  # noqa: BLE001 — площадка могла отказать
        raise HTTPException(
            status_code=502, detail=f"Площадка не приняла ответ: {type(exc).__name__}"
        ) from exc

    return {"ok": True}


@guarded.post("/cache/clear")
async def clear_cache() -> dict[str, Any]:
    await cache.clear()
    return {"cleared": True}


@guarded.get("/sync")
async def sync_status() -> dict[str, Any]:
    """Когда данные последний раз выгружались с площадок."""
    return await warehouse.status(settings)


@guarded.post("/sync")
async def sync_now() -> dict[str, Any]:
    """Скачать свежие данные с площадок прямо сейчас."""
    results = await warehouse.sync_all(settings)
    await cache.clear()
    return {
        "started": True,
        "results": [result.to_dict() for result in results],
        "status": await warehouse.status(settings),
    }


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
