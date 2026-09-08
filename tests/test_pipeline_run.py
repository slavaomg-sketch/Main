"""Сквозная проверка цикла на подставных claude/codex/telegram и локальном git без push."""

import subprocess
from pathlib import Path

import pytest
from PIL import Image

from pipeline import images, learn, run
from pipeline.cards import read_card
from pipeline.config import PipelineConfig

ROOT = Path(__file__).resolve().parents[1]

CLAUDE_CARD = """## Заголовок
Шапка бини женская зимняя с помпоном

## Ключевые характеристики
- Материал: акрил 100%
- Размер: 54–58 см

## Описание
Тёплая шапка, которая не колется.

## Ключевые слова
шапка бини женская, шапка с помпоном

## Уточнить
- состав подкладки

```json
{"main": {"scene": "beige knit beanie, white background", "badge": "Хит"},
 "slides": [
  {"scene": "beanie close-up on wool texture", "headline": "Не колется", "lines": ["акрил 100%", "мягкая изнутри"]},
  {"scene": "beanie flat lay with ruler", "headline": "Один размер", "lines": ["54–58 см"]},
  {"scene": "woman in city wearing beanie", "headline": "На каждый день", "lines": ["стирка 30 °C"]}
 ]}
```
"""

INBOX = """# Идеи

## Шапка-бини с помпоном
площадка: wb
факты:
- материал: акрил 100%
запросы: шапка бини женская
"""


@pytest.fixture
def repo(tmp_path, monkeypatch):
    (tmp_path / "ideas" / "photos").mkdir(parents=True)
    (tmp_path / "ideas" / "inbox.md").write_text(INBOX, encoding="utf-8")
    (tmp_path / "cards").mkdir()
    (tmp_path / "STYLE.md").write_text("# Стиль\n\n```yaml\naccent: \"#FF6B35\"\n```\n\n## Выученные правила\n", encoding="utf-8")
    skill = tmp_path / ".claude" / "skills" / "product-cards"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: x\n---\nПравила.", encoding="utf-8")
    (skill / "references" / "wildberries.md").write_text("WB: заголовок до 60.", encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "t"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-q", "-m", "init"], check=True)

    calls = {"claude": [], "codex": [], "notify": []}

    def fake_claude(prompt, cfg):
        calls["claude"].append(prompt)
        if "список правил стиля" in prompt:
            return "- не писать слово «тёплая» без цифр\n- заголовок начинать с «шапка бини»"
        return CLAUDE_CARD

    def fake_codex(prompt, out_path, cfg, photos):
        calls["codex"].append((prompt, [p.name for p in photos]))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (1080, 1440), (230, 210, 190)).save(out_path)
        return out_path

    monkeypatch.setattr("pipeline.claude_text.run_claude", fake_claude)
    monkeypatch.setattr(learn, "run_claude", fake_claude)
    monkeypatch.setattr(images, "codex_generate", fake_codex)
    monkeypatch.setattr(run.notify, "send", lambda cfg, text: calls["notify"].append(text) or True)
    calls["photos"] = []
    monkeypatch.setattr(run.notify, "send_photos", lambda cfg, paths, caption="": calls["photos"].append(([p.name for p in paths], caption)) or True)

    cfg = PipelineConfig(repo_dir=tmp_path, push=False, notify=True, image_text_mode="both")
    return tmp_path, cfg, calls


def _git_log(path: Path) -> str:
    return subprocess.run(["git", "-C", str(path), "log", "--oneline"], capture_output=True, text=True).stdout


def test_full_cycle_new_idea(repo):
    root, cfg, calls = repo
    stats = run.run_once(cfg)
    assert stats["new"] == 1
    card_dir = root / "cards" / "shapka-bini-s-pomponom"
    card = read_card(card_dir)
    assert card is not None
    assert card.status == "draft"
    assert card.meta["concept"] is True and card.meta["photos"] == 0
    assert card.section("Заголовок") == "Шапка бини женская зимняя с помпоном"
    assert "площадка: wb" in card.section("Вводные")
    assert "### Слайд 3" in card.section("Инфографика")
    assert (card_dir / "slides.json").is_file()
    assert (card_dir / "idea.md").is_file()
    assert (card_dir / ".generated.md").is_file()
    # 4 картинки × 2 режима
    assert len(calls["codex"]) == 8
    for name in ("main", "slide1", "slide2", "slide3"):
        assert (card_dir / "images" / f"{name}.png").is_file()
        assert (card_dir / "images" / "native" / f"{name}.png").is_file()
        assert (card_dir / "images" / "raw" / f"{name}-overlay.png").is_file()
    with Image.open(card_dir / "images" / "slide1.png") as im:
        assert im.size == (900, 1200)
    # промпт без фото говорит, что текста быть не должно (overlay) и что это концепт
    overlay_prompts = [p for p, _ in calls["codex"] if "no text" in p.lower()]
    assert overlay_prompts
    assert any("No reference photos" in p for p, _ in calls["codex"])
    # уведомление с вопросами и ссылкой
    assert calls["notify"] and "Готово" in calls["notify"][0]
    assert "Уточнить: состав подкладки" in calls["notify"][0]
    assert "КОНЦЕПТ" in calls["notify"][0]
    assert "Заголовок: Шапка бини женская зимняя с помпоном" in calls["notify"][0]
    assert "Тёплая шапка" in calls["notify"][0]
    # альбомы: итоговые картинки и вариант native
    assert calls["photos"][0] == (["main.png", "slide1.png", "slide2.png", "slide3.png"], "Шапка-бини с помпоном")
    assert "надписями от модели" in calls["photos"][1][1]
    log = _git_log(root)
    assert "текст" in log and "картинки" in log
    # повторный проход ничего нового не делает
    assert run.run_once(cfg)["new"] == 0
    assert len(calls["codex"]) == 8


def test_photos_are_passed_as_reference(repo):
    root, cfg, calls = repo
    photo_dir = root / "ideas" / "photos" / "Шапка-бини с помпоном"
    photo_dir.mkdir()
    Image.new("RGB", (400, 400), (10, 10, 10)).save(photo_dir / "1.jpg")
    run.run_once(cfg)
    card = read_card(root / "cards" / "shapka-bini-s-pomponom")
    assert card.meta["photos"] == 1 and card.meta["concept"] is False
    assert all(names == ["1.jpg"] for _, names in calls["codex"])
    assert all("REAL product" in p for p, _ in calls["codex"])


def test_learning_from_edits(repo):
    root, cfg, calls = repo
    run.run_once(cfg)
    card = read_card(root / "cards" / "shapka-bini-s-pomponom")
    card.body = card.body.replace("Тёплая шапка, которая не колется.", "Шапка держит тепло до −15 °C и не колется.")
    card.meta["status"] = "ready"
    card.meta["notes"] = "меньше эпитетов"
    card.save()
    stats = run.run_once(cfg)
    assert stats["learned"] == 1
    style = (root / "STYLE.md").read_text(encoding="utf-8")
    assert "не писать слово «тёплая» без цифр" in style
    assert read_card(root / "cards" / "shapka-bini-s-pomponom").meta["learned"] is True
    assert any("Выучил" in t for t in calls["notify"])
    learn_prompt = [p for p in calls["claude"] if "список правил стиля" in p][0]
    assert "-15 °C" in learn_prompt or "−15 °C" in learn_prompt
    assert "меньше эпитетов" in learn_prompt
    # второй раз не учится
    assert run.run_once(cfg)["learned"] == 0


def test_redo_keeps_raw_images_when_scenes_unchanged(repo):
    root, cfg, calls = repo
    run.run_once(cfg)
    n_before = len(calls["codex"])
    card = read_card(root / "cards" / "shapka-bini-s-pomponom")
    card.body = card.body.replace("- материал: акрил 100%", "- материал: акрил 100%\n- подкладка: флис")
    card.meta["status"] = "redo"
    card.save()
    stats = run.run_once(cfg)
    assert stats["redo"] == 1
    assert len(calls["codex"]) == n_before  # сцены те же — сырые картинки переиспользованы
    card = read_card(root / "cards" / "shapka-bini-s-pomponom")
    assert card.status == "draft"
    assert "подкладка: флис" in card.section("Вводные")
    assert "надписи" in card.meta["images"]
    # промпт пересборки содержит новые вводные
    assert any("подкладка: флис" in p for p in calls["claude"])


def test_redo_images_only(repo):
    root, cfg, calls = repo
    run.run_once(cfg)
    n_before = len(calls["codex"])
    card = read_card(root / "cards" / "shapka-bini-s-pomponom")
    card.meta["status"] = "redo-images"
    card.save()
    assert run.run_once(cfg)["redo_images"] == 1
    assert len(calls["codex"]) == n_before + 8
    assert read_card(root / "cards" / "shapka-bini-s-pomponom").status == "draft"


def test_claude_failure_marks_error(repo, monkeypatch):
    root, cfg, calls = repo
    from pipeline.claude_text import ClaudeError

    def boom(prompt, cfg):
        raise ClaudeError("лимит исчерпан")

    monkeypatch.setattr("pipeline.claude_text.run_claude", boom)
    run.run_once(cfg)
    card = read_card(root / "cards" / "shapka-bini-s-pomponom")
    assert card.status == "error" and "лимит" in card.meta["error"]
    assert not (root / "cards" / "shapka-bini-s-pomponom" / "images").exists()
    assert any("Ошибка" in t for t in calls["notify"])


def test_max_ideas_per_run(repo):
    root, cfg, calls = repo
    (root / "ideas" / "inbox.md").write_text(INBOX + "\n## Вторая идея\nфакты:\n- x\n", encoding="utf-8")
    cfg2 = PipelineConfig(repo_dir=root, push=False, notify=False, max_ideas_per_run=1, image_text_mode="overlay")
    assert run.run_once(cfg2)["new"] == 1
    assert run.run_once(cfg2)["new"] == 1
    assert run.run_once(cfg2)["new"] == 0
