"""Доступ к панели.

Если `DASHBOARD_PASSWORD` не задан, панель открыта — так удобно смотреть
её локально. Как только пароль задан, все `/api/*` требуют подписанную
cookie, которую выдаёт `/api/auth/login`.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import HTTPException, Request, status

from .config import settings

COOKIE_NAME = "dashboard_session"
SESSION_TTL = 60 * 60 * 24 * 30  # 30 дней


def issue_token(now: int | None = None) -> str:
    issued_at = now if now is not None else int(time.time())
    payload = str(issued_at)
    signature = hmac.new(
        settings.session_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{signature}"


def token_valid(token: str, now: int | None = None) -> bool:
    if not token or token.count(".") != 1:
        return False
    payload, signature = token.split(".", 1)
    expected = issue_token(int(payload)) if payload.isdigit() else ""
    if not expected or not hmac.compare_digest(expected.split(".", 1)[1], signature):
        return False
    current = now if now is not None else int(time.time())
    return current - int(payload) <= SESSION_TTL


def password_matches(candidate: str) -> bool:
    # Сравниваем байты: compare_digest не принимает строки с не-ASCII символами,
    # а пароль вполне может быть русским.
    return hmac.compare_digest(
        (candidate or "").encode("utf-8"),
        settings.password.encode("utf-8"),
    )


def is_authenticated(request: Request) -> bool:
    if not settings.auth_enabled:
        return True
    return token_valid(request.cookies.get(COOKIE_NAME, ""))


async def require_auth(request: Request) -> None:
    """Зависимость FastAPI: пускает дальше только авторизованных."""
    if not is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется вход в панель",
        )
