"""Настройки конвейера. Читаются из .env (тот же файл, что и у бота) и переменных окружения."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

VALID_TEXT_MODES = ("overlay", "native", "both")


def _int_list(raw: str) -> list[int]:
    out: list[int] = []
    for chunk in raw.replace(";", ",").split(","):
        chunk = chunk.strip()
        if chunk:
            try:
                out.append(int(chunk))
            except ValueError:
                pass
    return out


def _bool(raw: str | None, default: bool) -> bool:
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "да", "on")


def github_web_url(repo_dir: Path) -> str:
    """https://github.com/owner/repo по адресу origin. Пустая строка, если origin не GitHub."""
    try:
        url = subprocess.run(
            ["git", "-C", str(repo_dir), "remote", "get-url", "origin"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""
    if url.startswith("git@github.com:"):
        path = url[len("git@github.com:"):]
    elif "github.com/" in url:
        path = url.split("github.com/", 1)[1]
    else:
        return ""
    path = path.removesuffix(".git").strip("/")
    return f"https://github.com/{path}" if path else ""


@dataclass(frozen=True)
class PipelineConfig:
    repo_dir: Path
    branch: str = "main"
    poll_seconds: int = 300
    max_ideas_per_run: int = 0          # 0 — без ограничения
    max_images_per_day: int = 0         # 0 — без ограничения
    image_text_mode: str = "both"       # overlay | native | both
    slides_per_card: int = 3            # слайдов помимо главного фото
    default_marketplace: str = "wb"

    claude_cmd: str = "claude"
    claude_model: str = ""              # пусто — модель по умолчанию из настроек claude
    claude_timeout: int = 600

    codex_cmd: str = "codex"
    codex_extra_args: str = "--full-auto --skip-git-repo-check"
    codex_timeout: int = 900
    image_size: str = "1080x1440"       # что просим у gpt-image-2; итог всегда 900x1200

    bot_token: str = ""
    admin_ids: list[int] = field(default_factory=list)
    notify: bool = True

    github_token: str = ""
    github_url: str = ""
    push: bool = True

    dry_run: bool = False

    @classmethod
    def from_env(cls, repo_dir: Path | None = None) -> "PipelineConfig":
        repo = Path(os.getenv("PIPELINE_REPO_DIR", str(repo_dir or Path.cwd()))).resolve()
        mode = os.getenv("IMAGE_TEXT_MODE", "both").strip().lower() or "both"
        if mode not in VALID_TEXT_MODES:
            raise RuntimeError(f"IMAGE_TEXT_MODE={mode!r}: допустимо overlay, native или both")
        return cls(
            repo_dir=repo,
            branch=os.getenv("PIPELINE_BRANCH", "main").strip() or "main",
            poll_seconds=int(os.getenv("PIPELINE_POLL_SECONDS", "300")),
            max_ideas_per_run=int(os.getenv("MAX_IDEAS_PER_RUN", "0")),
            max_images_per_day=int(os.getenv("MAX_IMAGES_PER_DAY", "0")),
            image_text_mode=mode,
            slides_per_card=int(os.getenv("SLIDES_PER_CARD", "3")),
            default_marketplace=os.getenv("DEFAULT_MARKETPLACE", "wb").strip().lower() or "wb",
            claude_cmd=os.getenv("CLAUDE_CMD", "claude").strip() or "claude",
            claude_model=os.getenv("CLAUDE_MODEL", "").strip(),
            claude_timeout=int(os.getenv("CLAUDE_TIMEOUT", "600")),
            codex_cmd=os.getenv("CODEX_CMD", "codex").strip() or "codex",
            codex_extra_args=os.getenv("CODEX_EXTRA_ARGS", "--full-auto --skip-git-repo-check").strip(),
            codex_timeout=int(os.getenv("CODEX_TIMEOUT", "900")),
            image_size=os.getenv("IMAGE_SIZE", "1080x1440").strip() or "1080x1440",
            bot_token=os.getenv("BOT_TOKEN", "").strip(),
            admin_ids=_int_list(os.getenv("ADMIN_IDS", "")),
            notify=_bool(os.getenv("PIPELINE_NOTIFY"), True),
            github_token=os.getenv("GITHUB_TOKEN", "").strip(),
            github_url=os.getenv("GITHUB_URL", "").strip() or github_web_url(repo),
            push=_bool(os.getenv("PIPELINE_PUSH"), True),
            dry_run=_bool(os.getenv("PIPELINE_DRY_RUN"), False),
        )

    # Пути внутри репозитория
    @property
    def inbox_path(self) -> Path:
        return self.repo_dir / "ideas" / "inbox.md"

    @property
    def photos_dir(self) -> Path:
        return self.repo_dir / "ideas" / "photos"

    @property
    def cards_dir(self) -> Path:
        return self.repo_dir / "cards"

    @property
    def style_path(self) -> Path:
        return self.repo_dir / "STYLE.md"

    @property
    def skill_dir(self) -> Path:
        return self.repo_dir / ".claude" / "skills" / "product-cards"

    @property
    def fonts_dir(self) -> Path:
        return Path(__file__).resolve().parent / "fonts"

    @property
    def state_dir(self) -> Path:
        return self.repo_dir / ".pipeline"
