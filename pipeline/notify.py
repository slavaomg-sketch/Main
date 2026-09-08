"""Уведомления в Telegram через Bot API. Использует BOT_TOKEN и ADMIN_IDS."""

from __future__ import annotations

import json
import logging
import mimetypes
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .config import PipelineConfig

log = logging.getLogger("pipeline.notify")


def _enabled(cfg: PipelineConfig) -> bool:
    return bool(cfg.notify and cfg.bot_token and cfg.admin_ids)


def _post(cfg: PipelineConfig, method: str, payload: bytes, content_type: str) -> bool:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{cfg.bot_token}/{method}",
        data=payload, headers={"Content-Type": content_type}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        return True
    except urllib.error.HTTPError as e:
        log.warning("telegram %s: %s %s", method, e.code, e.read()[:200])
    except (urllib.error.URLError, OSError) as e:
        log.warning("telegram %s: %s", method, e)
    return False


def send(cfg: PipelineConfig, text: str) -> bool:
    if not _enabled(cfg):
        log.info("уведомление пропущено (notify выключен или нет BOT_TOKEN/ADMIN_IDS): %s", text[:80])
        return False
    if cfg.dry_run:
        log.info("dry-run уведомление: %s", text)
        return True
    ok = True
    for chat_id in cfg.admin_ids:
        payload = json.dumps({"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True}).encode("utf-8")
        ok = _post(cfg, "sendMessage", payload, "application/json") and ok
    return ok


def _multipart(fields: dict[str, str], files: dict[str, Path]) -> tuple[bytes, str]:
    boundary = "----cards" + uuid.uuid4().hex
    body = bytearray()
    for name, value in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8")
    for name, path in files.items():
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode("utf-8")
        body += path.read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode("utf-8")
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def send_photos(cfg: PipelineConfig, paths: list[Path], caption: str = "") -> bool:
    """До 10 картинок одним альбомом (sendMediaGroup). Подпись — к первой."""
    paths = [p for p in paths if p.is_file()][:10]
    if not paths:
        return False
    if not _enabled(cfg):
        return False
    if cfg.dry_run:
        log.info("dry-run альбом: %s", [p.name for p in paths])
        return True
    ok = True
    for chat_id in cfg.admin_ids:
        media = []
        files: dict[str, Path] = {}
        for i, p in enumerate(paths):
            key = f"photo{i}"
            files[key] = p
            item = {"type": "photo", "media": f"attach://{key}"}
            if i == 0 and caption:
                item["caption"] = caption[:1000]
            media.append(item)
        payload, ctype = _multipart({"chat_id": str(chat_id), "media": json.dumps(media, ensure_ascii=False)}, files)
        ok = _post(cfg, "sendMediaGroup", payload, ctype) and ok
    return ok


def card_link(cfg: PipelineConfig, slug: str) -> str:
    if not cfg.github_url:
        return f"cards/{slug}/card.md"
    return f"{cfg.github_url}/blob/{cfg.branch}/cards/{slug}/card.md"
