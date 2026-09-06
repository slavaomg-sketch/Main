"""Картинки карточки: gpt-image-2 через Codex CLI, затем нормализация и надписи."""

from __future__ import annotations

import logging
import os
import shlex
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from .cards import IMAGES_DIR
from .config import PipelineConfig
from .overlay import normalize, render_overlay, stamp_concept
from .prompts import build_image_prompt, style_yaml_block

log = logging.getLogger("pipeline.images")

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}


class ImageError(RuntimeError):
    pass


def find_photos(cfg: PipelineConfig, slug: str, title: str, explicit: str = "") -> list[Path]:
    """Папка с фото: явно указанная в идее, либо по slug, либо по названию (без учёта регистра)."""
    root = cfg.photos_dir
    if not root.is_dir():
        return []
    wanted = [n for n in (explicit, slug, title) if n]
    for d in root.iterdir():
        if not d.is_dir():
            continue
        if any(d.name.strip().lower() == w.strip().lower() for w in wanted):
            return sorted(p for p in d.iterdir() if p.suffix.lower() in PHOTO_EXT)
    return []


def _codex_generated_dir() -> Path:
    home = Path(os.getenv("CODEX_HOME", Path.home() / ".codex"))
    return home / "generated_images"


def _newest_png(directory: Path, since: float) -> Path | None:
    if not directory.is_dir():
        return None
    candidates = [p for p in directory.rglob("*.png") if p.stat().st_mtime >= since - 1]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def codex_generate(prompt: str, out_path: Path, cfg: PipelineConfig, photos: list[Path]) -> Path:
    """Запускает `codex exec` в чистой временной папке, забирает PNG."""
    workdir = Path(tempfile.mkdtemp(prefix="cards-img-"))
    try:
        cmd = [cfg.codex_cmd, "exec", *shlex.split(cfg.codex_extra_args), "-C", str(workdir)]
        for p in photos[:4]:
            cmd += ["-i", str(p)]
        cmd.append(prompt)
        started = time.time()
        log.info("codex: генерация %s (%d фото-референсов)", out_path.name, min(len(photos), 4))
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=cfg.codex_timeout)
        except FileNotFoundError:
            raise ImageError(f"Команда {cfg.codex_cmd!r} не найдена. Установите Codex CLI и выполните `codex login`.")
        except subprocess.TimeoutExpired:
            raise ImageError(f"codex не завершился за {cfg.codex_timeout} с")
        produced = workdir / "out.png"
        if not produced.is_file():
            alt = _newest_png(workdir, started) or _newest_png(_codex_generated_dir(), started)
            if alt is None:
                tail = (proc.stdout + "\n" + proc.stderr).strip()[-800:]
                raise ImageError(f"codex не сохранил картинку (код {proc.returncode}). Хвост вывода:\n{tail}")
            produced = alt
        out_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(produced, out_path)
        return out_path
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _plan(slides: dict[str, Any], slides_per_card: int) -> list[dict[str, Any]]:
    main = slides.get("main") or {}
    items = [{"name": "main", "kind": "main", "scene": main.get("scene", ""), "headline": "",
              "lines": [], "badge": main.get("badge", "")}]
    for i, s in enumerate((slides.get("slides") or [])[:slides_per_card], start=1):
        items.append({"name": f"slide{i}", "kind": "slide", "scene": s.get("scene", ""),
                      "headline": s.get("headline", ""), "lines": list(s.get("lines") or []), "badge": ""})
    return items


def generate_card_images(
    card_dir: Path, slides: dict[str, Any], cfg: PipelineConfig, *,
    photos: list[Path], style_md: str, text_mode: str | None = None, reuse_raw: bool = False,
) -> dict[str, Any]:
    """
    Делает images/<name>.png (итог) и images/raw/<name>-<mode>.png (сырой вывод модели).
    В режиме both: итог в images/ — вариант overlay, вариант native лежит в images/native/.
    reuse_raw=True — сырые картинки не перегенерировать, только заново наложить надписи.
    Возвращает отчёт: сколько сделано, какие ошибки.
    """
    mode = text_mode or cfg.image_text_mode
    modes = ["overlay", "native"] if mode == "both" else [mode]
    concept = not photos
    style = style_yaml_block(style_md)
    images_dir = card_dir / IMAGES_DIR
    raw_dir = images_dir / "raw"
    native_dir = images_dir / "native"
    images_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {"generated": 0, "reused": 0, "errors": [], "files": []}
    for item in _plan(slides, cfg.slides_per_card):
        for m in modes:
            raw = raw_dir / f"{item['name']}-{m}.png"
            if reuse_raw and raw.is_file():
                report["reused"] += 1
            else:
                prompt = build_image_prompt(
                    kind=item["kind"], scene=item["scene"], headline=item["headline"], lines=item["lines"],
                    badge=item["badge"], style_md=style_md, text_mode=m, size=cfg.image_size,
                    photos=photos, concept=concept, out_name="out.png",
                )
                if cfg.dry_run:
                    log.info("dry-run: пропускаю генерацию %s", raw.name)
                    continue
                try:
                    codex_generate(prompt, raw, cfg, photos)
                    report["generated"] += 1
                except ImageError as e:
                    log.error("%s: %s", raw.name, e)
                    report["errors"].append(f"{item['name']} ({m}): {e}")
                    continue
            if not raw.is_file():
                continue
            final = images_dir / f"{item['name']}.png" if m == "overlay" or mode == "native" else native_dir / f"{item['name']}.png"
            normalize(raw, final)
            if m == "overlay":
                render_overlay(final, final, headline=item["headline"], lines=item["lines"],
                               badge=item["badge"], style=style, fonts_dir=cfg.fonts_dir)
            if concept:
                stamp_concept(final, cfg.fonts_dir)
            report["files"].append(str(final.relative_to(card_dir)))
    return report
