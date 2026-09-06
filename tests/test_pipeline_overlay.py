from pathlib import Path

from PIL import Image

from pipeline.overlay import FINAL_H, FINAL_W, normalize, render_overlay, stamp_concept

FONTS = Path(__file__).resolve().parents[1] / "pipeline" / "fonts"


def _square(path: Path, size=(1024, 1024), color=(200, 220, 240)) -> Path:
    Image.new("RGB", size, color).save(path)
    return path


def test_normalize_to_3_4(tmp_path):
    src = _square(tmp_path / "src.png")
    out = normalize(src, tmp_path / "out.png")
    with Image.open(out) as im:
        assert im.size == (FINAL_W, FINAL_H)
    wide = _square(tmp_path / "wide.png", size=(1792, 1024))
    with Image.open(normalize(wide, tmp_path / "wide-out.png")) as im:
        assert im.size == (FINAL_W, FINAL_H)


def test_overlay_draws_band(tmp_path):
    src = normalize(_square(tmp_path / "src.png"), tmp_path / "base.png")
    out = render_overlay(
        src, tmp_path / "final.png", headline="Не колется и не растягивается",
        lines=["акрил 100%", "размер 54–58 см"], badge="", style={"band": "top"}, fonts_dir=FONTS,
    )
    with Image.open(out) as im:
        assert im.size == (FINAL_W, FINAL_H)
        top = im.getpixel((FINAL_W // 2, 10))
        bottom = im.getpixel((FINAL_W // 2, FINAL_H - 10))
        assert top != bottom  # сверху полоса под текст, снизу исходный фон


def test_badge_and_concept_stamp(tmp_path):
    src = normalize(_square(tmp_path / "src.png"), tmp_path / "base.png")
    before = Image.open(src).tobytes()
    out = render_overlay(src, tmp_path / "main.png", headline="", lines=[], badge="Хит", style={}, fonts_dir=FONTS)
    stamp_concept(out, FONTS)
    after = Image.open(out).tobytes()
    assert before != after
