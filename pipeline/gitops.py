"""Синхронизация с GitHub: pull перед циклом, commit+push после каждой карточки."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from .config import PipelineConfig

log = logging.getLogger("pipeline.git")


class GitError(RuntimeError):
    pass


def _git(cfg: PipelineConfig, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(["git", "-C", str(cfg.repo_dir), *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise GitError(f"git {' '.join(args)}: {proc.stderr.strip()[:400]}")
    return proc


def ensure_identity(cfg: PipelineConfig) -> None:
    if not _git(cfg, "config", "user.email", check=False).stdout.strip():
        _git(cfg, "config", "user.email", "cards-pipeline@localhost")
        _git(cfg, "config", "user.name", "cards-pipeline")


def pull(cfg: PipelineConfig) -> bool:
    """Забирает изменения с GitHub. При конфликте побеждает то, что на GitHub (правки продавца)."""
    if not cfg.push:
        return True
    ensure_identity(cfg)
    fetch = _git(cfg, "fetch", "--quiet", "origin", cfg.branch, check=False)
    if fetch.returncode != 0:
        log.warning("fetch не удался: %s", fetch.stderr.strip()[:200])
        return False
    res = _git(cfg, "pull", "--rebase", "-X", "ours", "--quiet", "origin", cfg.branch, check=False)
    if res.returncode == 0:
        return True
    log.warning("pull --rebase не удался, откатываю: %s", (res.stderr or res.stdout).strip()[:300])
    _git(cfg, "rebase", "--abort", check=False)
    return False


def commit(cfg: PipelineConfig, message: str, paths: list[Path] | None = None) -> bool:
    ensure_identity(cfg)
    if paths:
        _git(cfg, "add", "-A", "--", *[str(p) for p in paths])
    else:
        _git(cfg, "add", "-A", "--", "cards", "STYLE.md", "ideas")
    if not _git(cfg, "diff", "--cached", "--quiet", check=False).returncode:
        return False
    _git(cfg, "commit", "--quiet", "-m", message)
    return True


def push(cfg: PipelineConfig) -> bool:
    if not cfg.push:
        return True
    for attempt in range(3):
        res = _git(cfg, "push", "--quiet", "origin", f"HEAD:{cfg.branch}", check=False)
        if res.returncode == 0:
            return True
        log.warning("push не удался (попытка %d): %s", attempt + 1, res.stderr.strip()[:200])
        if not pull(cfg):
            break
    return False


def current_branch(cfg: PipelineConfig) -> str:
    return _git(cfg, "rev-parse", "--abbrev-ref", "HEAD", check=False).stdout.strip()
