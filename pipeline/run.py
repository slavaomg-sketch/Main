"""Главный цикл конвейера.

    python -m pipeline.run            # крутиться постоянно (systemd)
    python -m pipeline.run --once     # один проход и выход
    python -m pipeline.run --dry-run  # без вызовов claude/codex/git push/telegram

Один проход:
  1. git pull — забрать новые идеи и правки продавца
  2. новые идеи из ideas/inbox.md → текст карточки → картинки → commit+push → уведомление
  3. карточки со status: redo → пересобрать текст (картинки — если изменились сцены)
  4. карточки со status: redo-images → только картинки
  5. карточки со status: ready / rejected, ещё не «выученные» → правила в STYLE.md
"""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any

from . import gitops, notify
from .cards import (
    CARD_FILE, GENERATED_FILE, IDEA_FILE, STATUS_DRAFT, STATUS_ERROR, STATUS_READY, STATUS_REDO,
    STATUS_REDO_IMAGES, STATUS_REJECTED, Card, card_exists, list_cards, load_slides, now_iso,
    read_card, replace_section, save_slides, scenes_changed, slides_to_markdown, write_card,
)
from .claude_text import ClaudeError, generate_card_text
from .config import PipelineConfig
from .images import find_photos, generate_card_images
from .inbox import Idea, parse_block, parse_inbox
from .learn import learn_from_card, open_questions
from .prompts import build_card_prompt, read_marketplace_reference, read_skill, read_style

log = logging.getLogger("pipeline")

_stop = False


def _handle_stop(signum, frame):  # noqa: ANN001
    global _stop
    _stop = True
    log.info("получен сигнал %s, завершу текущую карточку и остановлюсь", signum)


# ----------------------------------------------------------------- вспомогательное

def _images_report_text(report: dict[str, Any]) -> str:
    n = len([f for f in report.get("files", []) if not f.startswith("images/native/")])
    text = f"картинок: {n}"
    if report.get("errors"):
        text += f", ошибок: {len(report['errors'])}"
    return text


def _notify_card(cfg: PipelineConfig, card: Card, images_report: dict[str, Any] | None, what: str) -> None:
    questions = open_questions(card)
    lines = [f"{what}: {card.meta.get('title', card.slug)}"]
    if images_report is not None:
        lines.append(_images_report_text(images_report))
    if card.meta.get("concept"):
        lines.append("КОНЦЕПТ: реальных фото нет, картинки помечены")
    if questions:
        lines.append("уточнить: " + "; ".join(questions[:5]))
    lines.append(notify.card_link(cfg, card.slug))
    notify.send(cfg, "\n".join(lines))


def _day_counter_path(cfg: PipelineConfig) -> Path:
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    return cfg.state_dir / "images-today.json"


def _images_today(cfg: PipelineConfig) -> int:
    p = _day_counter_path(cfg)
    try:
        data = json.loads(p.read_text())
        return int(data.get("count", 0)) if data.get("day") == time.strftime("%Y-%m-%d") else 0
    except (OSError, ValueError):
        return 0


def _add_images_today(cfg: PipelineConfig, n: int) -> None:
    p = _day_counter_path(cfg)
    p.write_text(json.dumps({"day": time.strftime("%Y-%m-%d"), "count": _images_today(cfg) + n}))


def _images_budget_ok(cfg: PipelineConfig) -> bool:
    if cfg.max_images_per_day <= 0:
        return True
    return _images_today(cfg) < cfg.max_images_per_day


def _commit_card(cfg: PipelineConfig, slug: str, message: str) -> None:
    if cfg.dry_run:
        return
    try:
        if gitops.commit(cfg, message, [cfg.cards_dir / slug, cfg.style_path]):
            gitops.push(cfg)
    except gitops.GitError as e:
        log.error("git: %s", e)


# ------------------------------------------------------------------ генерация текста

def _generate_text(cfg: PipelineConfig, idea: Idea, photos_count: int, inputs_override: str = "") -> tuple[str, dict[str, Any]]:
    style_md = read_style(cfg.style_path)
    prompt = build_card_prompt(
        idea,
        skill_md=read_skill(cfg.skill_dir),
        reference_md=read_marketplace_reference(cfg.skill_dir, idea.marketplace),
        style_md=style_md,
        photos_count=photos_count,
        slides_per_card=cfg.slides_per_card,
        inputs_override=inputs_override,
    )
    if cfg.dry_run:
        body = "## Заголовок\n(dry-run)\n\n## Ключевые характеристики\n- \n\n## Описание\n(dry-run)\n\n## Ключевые слова\n\n\n## Уточнить\n- нет\n"
        return body, {"main": {"scene": "dry-run", "badge": ""}, "slides": []}
    return generate_card_text(prompt, cfg)


def _assemble_body(idea_md: str, generated_body: str, slides: dict[str, Any]) -> str:
    inputs = idea_md.strip()
    # В карточке раздел «Вводные» — это идея без строки `## Название`
    inputs_lines = [ln for ln in inputs.splitlines() if not ln.startswith("## ")]
    body = "## Вводные\n" + "\n".join(inputs_lines).strip() + "\n\n" + generated_body.strip() + "\n"
    body = replace_section(body, "Инфографика", slides_to_markdown(slides))
    return body


# ------------------------------------------------------------------- новые идеи

def process_new_ideas(cfg: PipelineConfig) -> int:
    if not cfg.inbox_path.is_file():
        return 0
    ideas = parse_inbox(cfg.inbox_path.read_text(encoding="utf-8"), cfg.default_marketplace)
    new = [i for i in ideas if not card_exists(cfg.cards_dir, i.slug)]
    if cfg.max_ideas_per_run > 0:
        new = new[: cfg.max_ideas_per_run]
    done = 0
    for idea in new:
        if _stop:
            break
        done += int(process_idea(cfg, idea))
    return done


def process_idea(cfg: PipelineConfig, idea: Idea) -> bool:
    card_dir = cfg.cards_dir / idea.slug
    log.info("новая идея: %s → cards/%s", idea.title, idea.slug)
    photos = find_photos(cfg, idea.slug, idea.title, idea.photos)
    card_dir.mkdir(parents=True, exist_ok=True)
    (card_dir / IDEA_FILE).write_text(idea.as_markdown(), encoding="utf-8")

    meta: dict[str, Any] = {
        "status": STATUS_DRAFT,
        "title": idea.title,
        "marketplace": idea.marketplace,
        "created": now_iso(),
        "updated": now_iso(),
        "photos": len(photos),
        "concept": not photos,
        "image_text_mode": cfg.image_text_mode,
        "notes": "",
    }
    try:
        generated_body, slides = _generate_text(cfg, idea, len(photos))
    except ClaudeError as e:
        log.error("%s: текст не сгенерирован: %s", idea.slug, e)
        meta.update(status=STATUS_ERROR, error=str(e))
        write_card(card_dir / CARD_FILE, meta, "## Вводные\n" + idea.as_markdown())
        _commit_card(cfg, idea.slug, f"cards: {idea.slug} — ошибка генерации текста")
        notify.send(cfg, f"Ошибка: {idea.title}\n{e}\n{notify.card_link(cfg, idea.slug)}")
        return False

    body = _assemble_body(idea.as_markdown(), generated_body, slides)
    write_card(card_dir / CARD_FILE, meta, body)
    (card_dir / GENERATED_FILE).write_text(body, encoding="utf-8")
    save_slides(card_dir, slides)
    _commit_card(cfg, idea.slug, f"cards: {idea.slug} — текст")

    report = _make_images(cfg, card_dir, slides, photos)
    card = read_card(card_dir)
    if card:
        card.meta["updated"] = now_iso()
        card.meta["images"] = _images_report_text(report)
        if report.get("errors"):
            card.meta["image_errors"] = report["errors"]
        card.save()
    _commit_card(cfg, idea.slug, f"cards: {idea.slug} — картинки")
    if card:
        _notify_card(cfg, card, report, "Готово")
    return True


def _make_images(cfg: PipelineConfig, card_dir: Path, slides: dict[str, Any], photos: list[Path], *, reuse_raw: bool = False) -> dict[str, Any]:
    if not _images_budget_ok(cfg):
        log.warning("дневной лимит картинок исчерпан, %s ждёт завтра", card_dir.name)
        return {"generated": 0, "reused": 0, "errors": ["дневной лимит картинок исчерпан"], "files": []}
    report = generate_card_images(
        card_dir, slides, cfg, photos=photos, style_md=read_style(cfg.style_path), reuse_raw=reuse_raw,
    )
    _add_images_today(cfg, int(report.get("generated", 0)))
    return report


# ------------------------------------------------------------- redo / redo-images

def _idea_from_card(cfg: PipelineConfig, card: Card) -> Idea:
    inputs = card.section("Вводные")
    block = f"## {card.meta.get('title', card.slug)}\n{inputs}\n"
    idea = parse_block(block, cfg.default_marketplace) or Idea(title=card.slug, slug=card.slug)
    idea.slug = card.slug
    if card.meta.get("marketplace") and "площадка" not in inputs.lower():
        idea.marketplace = str(card.meta["marketplace"])
    return idea


def process_redo(cfg: PipelineConfig, card: Card) -> None:
    log.info("redo: %s", card.slug)
    idea = _idea_from_card(cfg, card)
    photos = find_photos(cfg, card.slug, idea.title, idea.photos)
    old_slides = load_slides(card.dir)
    try:
        generated_body, slides = _generate_text(cfg, idea, len(photos), inputs_override=idea.as_markdown())
    except ClaudeError as e:
        card.meta.update(status=STATUS_ERROR, error=str(e), updated=now_iso())
        card.save()
        _commit_card(cfg, card.slug, f"cards: {card.slug} — ошибка пересборки")
        notify.send(cfg, f"Ошибка пересборки: {idea.title}\n{e}")
        return
    body = _assemble_body(idea.as_markdown(), generated_body, slides)
    card.body = body
    card.meta.update(status=STATUS_DRAFT, updated=now_iso(), photos=len(photos), concept=not photos, learned=False)
    card.meta.pop("error", None)
    card.save()
    (card.dir / GENERATED_FILE).write_text(body, encoding="utf-8")
    save_slides(card.dir, slides)
    _commit_card(cfg, card.slug, f"cards: {card.slug} — текст пересобран")

    need_new_raw = scenes_changed(old_slides, slides)
    report = _make_images(cfg, card.dir, slides, photos, reuse_raw=not need_new_raw)
    card.meta["images"] = _images_report_text(report) + ("" if need_new_raw else " (сцены не менялись, только надписи)")
    card.save()
    _commit_card(cfg, card.slug, f"cards: {card.slug} — картинки обновлены")
    _notify_card(cfg, card, report, "Пересобрано")


def process_redo_images(cfg: PipelineConfig, card: Card) -> None:
    log.info("redo-images: %s", card.slug)
    slides = load_slides(card.dir)
    if not slides:
        card.meta.update(status=STATUS_ERROR, error="нет slides.json, нечего рисовать", updated=now_iso())
        card.save()
        _commit_card(cfg, card.slug, f"cards: {card.slug} — нет плана картинок")
        return
    idea = _idea_from_card(cfg, card)
    photos = find_photos(cfg, card.slug, idea.title, idea.photos)
    report = _make_images(cfg, card.dir, slides, photos)
    card.body = replace_section(card.body, "Инфографика", slides_to_markdown(slides))
    card.meta.update(status=STATUS_DRAFT, updated=now_iso(), images=_images_report_text(report), photos=len(photos), concept=not photos)
    card.save()
    _commit_card(cfg, card.slug, f"cards: {card.slug} — картинки перерисованы")
    _notify_card(cfg, card, report, "Картинки готовы")


def process_feedback(cfg: PipelineConfig, card: Card) -> None:
    if card.meta.get("learned"):
        return
    added = learn_from_card(card, cfg)
    card.meta["learned"] = True
    card.meta["updated"] = now_iso()
    card.save()
    _commit_card(cfg, card.slug, f"cards: {card.slug} — {card.status}, правил выучено: {len(added)}")
    if added:
        notify.send(cfg, f"Выучил из «{card.meta.get('title', card.slug)}»:\n" + "\n".join(f"- {r}" for r in added))


# --------------------------------------------------------------------- один проход

def run_once(cfg: PipelineConfig) -> dict[str, int]:
    stats = {"new": 0, "redo": 0, "redo_images": 0, "learned": 0}
    if not cfg.dry_run:
        gitops.pull(cfg)

    stats["new"] = process_new_ideas(cfg)

    for card in list_cards(cfg.cards_dir):
        if _stop:
            break
        try:
            if card.status == STATUS_REDO:
                process_redo(cfg, card)
                stats["redo"] += 1
            elif card.status == STATUS_REDO_IMAGES:
                process_redo_images(cfg, card)
                stats["redo_images"] += 1
            elif card.status in (STATUS_READY, STATUS_REJECTED) and not card.meta.get("learned"):
                process_feedback(cfg, card)
                stats["learned"] += 1
        except Exception as e:  # noqa: BLE001 — одна сломанная карточка не должна класть цикл
            log.exception("%s: необработанная ошибка: %s", card.slug, e)
    if not cfg.dry_run:
        try:
            gitops.push(cfg)
        except gitops.GitError as e:
            log.error("push: %s", e)
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Конвейер карточек товара")
    parser.add_argument("--once", action="store_true", help="один проход и выход")
    parser.add_argument("--dry-run", action="store_true", help="без claude/codex/push/telegram")
    parser.add_argument("--repo", type=Path, default=None, help="папка репозитория (по умолчанию PIPELINE_REPO_DIR или текущая)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if args.dry_run:
        os.environ["PIPELINE_DRY_RUN"] = "1"
    cfg = PipelineConfig.from_env(args.repo)
    log.info("репозиторий %s, ветка %s, режим надписей %s, опрос каждые %d с", cfg.repo_dir, cfg.branch, cfg.image_text_mode, cfg.poll_seconds)

    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    lock_file = open(cfg.state_dir / "lock", "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error("конвейер уже запущен (lock занят)")
        return 1

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    while True:
        try:
            stats = run_once(cfg)
            log.info("проход завершён: %s", stats)
        except Exception as e:  # noqa: BLE001
            log.exception("проход упал: %s", e)
        if args.once or _stop:
            break
        for _ in range(cfg.poll_seconds):
            if _stop:
                break
            time.sleep(1)
        if _stop:
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
