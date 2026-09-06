"""Уведомления в Telegram через Bot API. Использует BOT_TOKEN и ADMIN_IDS бота напоминаний."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from .config import PipelineConfig

log = logging.getLogger("pipeline.notify")


def send(cfg: PipelineConfig, text: str) -> bool:
    if not cfg.notify or not cfg.bot_token or not cfg.admin_ids:
        log.info("уведомление пропущено (notify выключен или нет BOT_TOKEN/ADMIN_IDS): %s", text[:80])
        return False
    if cfg.dry_run:
        log.info("dry-run уведомление: %s", text)
        return True
    ok = True
    for chat_id in cfg.admin_ids:
        payload = json.dumps({
            "chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{cfg.bot_token}/sendMessage",
            data=payload, headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp.read()
        except (urllib.error.URLError, OSError) as e:
            log.warning("не отправилось в %s: %s", chat_id, e)
            ok = False
    return ok


def card_link(cfg: PipelineConfig, slug: str) -> str:
    if not cfg.github_url:
        return f"cards/{slug}/card.md"
    return f"{cfg.github_url}/blob/{cfg.branch}/cards/{slug}/card.md"
