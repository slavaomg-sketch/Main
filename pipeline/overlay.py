"""Приведение картинок к 900×1200 и наложение надписей (Pillow + Montserrat)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

log = logging.getLogger("pipeline.overlay")

FINAL_W, FINAL_H = 900, 1200

DEFAULT_STYLE: dict[str, Any] = {
    "accent": "#FF6B35",
    "text_color": "#1A1A1A",
    "band": "top",             # top | bottom
    "band_color": "#FFFFFF",
    "band_opacity": 0.82,
    "headline_size": 64,
    "line_size": 38,
    "badge_size": 34,
    "font": "",                # путь к ttf; пусто — Montserrat из pipeline/fonts
    "padding": 56,
}


def _hex(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    try:
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    except ValueError:
        r, g, b = 26, 26, 26
    return r, g, b, alpha


def load_font(fonts_dir: Path, size: int, weight: str = "Bold", custom: str = "") -> ImageFont.FreeTypeFont:
    candidates = [Path(custom)] if custom else []
    candidates += [fonts_dir / "Montserrat-VF.ttf"]
    for p in candidates:
        if p.is_file():
            font = ImageFont.truetype(str(p), size)
            try:
                font.set_variation_by_name(weight)
            except (OSError, AttributeError, ValueError):
                pass
            return font
    log.warning("шрифт не найден, используется стандартный")
    return ImageFont.load_default(size)


def normalize(src: Path, dst: Path) -> Path:
    """Обрезает по центру до 3:4 и масштабирует в 900×1200."""
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        target = FINAL_W / FINAL_H
        if w / h > target:
            new_w = int(h * target)
            left = (w - new_w) // 2
            im = im.crop((left, 0, left + new_w, h))
        else:
            new_h = int(w / target)
            top = (h - new_h) // 2
            im = im.crop((0, top, w, top + new_h))
        im = im.resize((FINAL_W, FINAL_H), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, "PNG", optimize=True)
    return dst


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_overlay(
    src: Path, dst: Path, *, headline: str, lines: list[str], badge: str,
    style: dict[str, Any], fonts_dir: Path,
) -> Path:
    st = {**DEFAULT_STYLE, **{k: v for k, v in style.items() if v is not None}}
    with Image.open(src) as base:
        im = base.convert("RGBA")
        if im.size != (FINAL_W, FINAL_H):
            im = im.resize((FINAL_W, FINAL_H), Image.LANCZOS)
        overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        pad = int(st["padding"])
        max_w = FINAL_W - 2 * pad

        if headline or lines:
            h_font = load_font(fonts_dir, int(st["headline_size"]), "ExtraBold", st["font"])
            l_font = load_font(fonts_dir, int(st["line_size"]), "SemiBold", st["font"])
            h_lines = _wrap(draw, headline, h_font, max_w) if headline else []
            body_lines: list[str] = []
            for ln in lines:
                body_lines += _wrap(draw, ln, l_font, max_w - 40)
            h_lh = int(st["headline_size"] * 1.15)
            l_lh = int(st["line_size"] * 1.4)
            block_h = len(h_lines) * h_lh + (18 if h_lines and body_lines else 0) + len(body_lines) * l_lh
            band_h = block_h + 2 * pad
            band_top = 0 if st["band"] == "top" else FINAL_H - band_h
            draw.rectangle(
                (0, band_top, FINAL_W, band_top + band_h),
                fill=_hex(st["band_color"], int(255 * float(st["band_opacity"]))),
            )
            y = band_top + pad
            accent = _hex(st["accent"])
            text_color = _hex(st["text_color"])
            for hl in h_lines:
                draw.text((pad, y), hl, font=h_font, fill=text_color)
                y += h_lh
            if h_lines and body_lines:
                draw.rectangle((pad, y + 2, pad + 96, y + 8), fill=accent)
                y += 18
            for bl in body_lines:
                draw.ellipse((pad, y + l_lh // 2 - 8, pad + 16, y + l_lh // 2 + 8), fill=accent)
                draw.text((pad + 40, y + (l_lh - int(st["line_size"] * 1.2)) // 2), bl, font=l_font, fill=text_color)
                y += l_lh

        if badge:
            b_font = load_font(fonts_dir, int(st["badge_size"]), "Bold", st["font"])
            tw = draw.textlength(badge, font=b_font)
            bx, by = pad, pad
            bh = int(st["badge_size"] * 1.6)
            draw.rounded_rectangle((bx, by, bx + tw + 48, by + bh), radius=bh // 2, fill=_hex(st["accent"]))
            draw.text((bx + 24, by + (bh - int(st["badge_size"] * 1.2)) // 2), badge, font=b_font, fill=(255, 255, 255, 255))

        out = Image.alpha_composite(im, overlay).convert("RGB")
        dst.parent.mkdir(parents=True, exist_ok=True)
        out.save(dst, "PNG", optimize=True)
    return dst


def stamp_concept(path: Path, fonts_dir: Path, text: str = "КОНЦЕПТ", subtext: str = "фото заменить") -> Path:
    """Диагональная пометка на картинках без реальных фото, чтобы их нельзя было выложить по ошибке."""
    with Image.open(path) as base:
        im = base.convert("RGBA")
        # Рисуем на большом квадрате, крутим, потом вырезаем центр — так текст не режется краями.
        big = int((FINAL_W ** 2 + FINAL_H ** 2) ** 0.5) + 200
        layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        font = load_font(fonts_dir, 150, "ExtraBold")
        sub_font = load_font(fonts_dir, 56, "Bold")
        tw = draw.textlength(text, font=font)
        sw = draw.textlength(subtext, font=sub_font)
        cx, cy = big / 2, big / 2
        draw.text((cx - tw / 2, cy - 130), text, font=font, fill=(220, 30, 30, 150))
        draw.text((cx - sw / 2, cy + 50), subtext, font=sub_font, fill=(220, 30, 30, 150))
        layer = layer.rotate(30, resample=Image.BICUBIC)
        left, top = (big - FINAL_W) // 2, (big - FINAL_H) // 2
        layer = layer.crop((left, top, left + FINAL_W, top + FINAL_H))
        Image.alpha_composite(im, layer).convert("RGB").save(path, "PNG", optimize=True)
    return path
