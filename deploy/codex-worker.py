#!/usr/bin/env python3
"""Мост между панелью и Codex CLI.

Зачем он нужен. Панель работает от урезанного в правах пользователя
`mpdashboard` — так задумано, чтобы выложенный код не мог хозяйничать на
сервере. Codex CLI авторизован под обычным пользователем (`slava`), и
перейти из одного в другого панель не может: мешает защита ядра.

Поэтому между ними — почтовый ящик. Панель кладёт задание в `queue/`,
этот сценарий (он работает от того же пользователя, что и Codex) забирает
задание, зовёт `codex exec` и кладёт ответ в `answers/`. Права на каталоги
выданы через ACL, root для этого не нужен.

Что важно про безопасность. В задании лежит текст покупателя — то есть
текст, который написал посторонний человек. Поэтому Codex запускается
в самом узком режиме: песочница только на чтение, без подтверждений,
без пользовательских настроек и правил, в отдельном пустом каталоге.
А результат никуда не уходит сам — это черновик, который владелец панели
читает и отправляет вручную.

Запуск:  python3 codex-worker.py
Каталоги задаются переменными окружения WB_AGENT_DIR и CODEX_BIN.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

AGENT_DIR = Path(os.getenv("WB_AGENT_DIR") or (Path.home() / "wb-agent"))
QUEUE = AGENT_DIR / "queue"
ANSWERS = AGENT_DIR / "answers"
WORK = AGENT_DIR / "work"
LOG = AGENT_DIR / "worker.log"

CODEX = os.getenv("CODEX_BIN") or shutil.which("codex") or "/usr/bin/codex"

# Сколько ждём один ответ. Обычный отзыв Codex пишет за 8–12 секунд,
# запас взят на случай, когда площадка модели отвечает медленно.
TIMEOUT = int(os.getenv("WB_AGENT_TIMEOUT") or 180)

# Как часто заглядываем в ящик. Секунда — чтобы кнопка «Черновик» в панели
# не казалась залипшей, и при этом сервер не грелся впустую.
POLL = 1.0

# Ответы живут час: панель забирает их за секунды, остальное — мусор.
KEEP = timedelta(hours=1)

# Форма ответа. Codex обязан вернуть ровно это, разбирать текст глазами
# не приходится.
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "needs_human", "why"],
    "properties": {
        "answer": {"type": "string"},
        "needs_human": {"type": "boolean"},
        "why": {"type": "string"},
    },
}

MAX_PROMPT = 20_000


def say(message: str) -> None:
    line = f"{datetime.now():%d.%m %H:%M:%S} {message}"
    print(line, flush=True)
    try:
        with LOG.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def prepare() -> Path:
    for folder in (QUEUE, ANSWERS, WORK):
        folder.mkdir(parents=True, exist_ok=True)
    schema = WORK / "schema.json"
    schema.write_text(json.dumps(SCHEMA), encoding="utf-8")
    # Codex читает инструкции из рабочего каталога. Каталог пустой —
    # значит, на черновик влияет только то, что прислала панель.
    (WORK / "AGENTS.md").unlink(missing_ok=True)
    return schema


def run_codex(prompt: str, schema: Path) -> dict:
    """Один вызов Codex. Возвращает разобранный ответ или причину отказа."""
    out = WORK / "last.json"
    out.unlink(missing_ok=True)

    command = [
        CODEX, "exec",
        "--ephemeral",            # не копить историю сессий на диске
        "--ignore-user-config",   # личные настройки владельца тут ни при чём
        "--ignore-rules",
        "--skip-git-repo-check",
        "-s", "read-only",        # песочница: команды модели ничего не изменят
        "-c", 'approval_policy="never"',
        "-C", str(WORK),
        "--output-schema", str(schema),
        "-o", str(out),
        "-",                      # сам запрос приходит через стандартный ввод
    ]

    started = time.monotonic()
    try:
        done = subprocess.run(
            command,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Codex не ответил за отведённое время"}
    except OSError as error:
        return {"ok": False, "error": f"не удалось запустить Codex: {error}"}

    seconds = round(time.monotonic() - started, 1)
    if done.returncode != 0:
        tail = (done.stderr or "").strip().splitlines()[-1:] or ["без объяснения"]
        return {"ok": False, "error": f"Codex завершился с ошибкой: {tail[0]}"}

    if not out.exists():
        return {"ok": False, "error": "Codex не вернул ответ"}

    try:
        payload = json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"ok": False, "error": "ответ Codex не разобрался"}

    if not isinstance(payload, dict) or not payload.get("answer"):
        return {"ok": False, "error": "Codex вернул пустой черновик"}

    return {
        "ok": True,
        "answer": str(payload.get("answer") or "").strip(),
        "needsHuman": bool(payload.get("needs_human")),
        "why": str(payload.get("why") or "").strip(),
        "seconds": seconds,
    }


def reply(task_id: str, payload: dict) -> None:
    """Кладём ответ так, чтобы панель не поймала недописанный файл."""
    payload["id"] = task_id
    temporary = ANSWERS / f".{task_id}.part"
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(ANSWERS / f"{task_id}.json")


def handle(request: Path, schema: Path) -> None:
    task_id = request.stem
    try:
        task = json.loads(request.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        say(f"{task_id}: задание не читается, выбрасываю")
        request.unlink(missing_ok=True)
        return

    request.unlink(missing_ok=True)
    prompt = str(task.get("prompt") or "")[:MAX_PROMPT]
    if not prompt.strip():
        reply(task_id, {"ok": False, "error": "пустой запрос"})
        return

    say(f"{task_id}: пишу черновик ({len(prompt)} знаков)")
    answer = run_codex(prompt, schema)
    reply(task_id, answer)
    say(f"{task_id}: {'готово за ' + str(answer.get('seconds')) + ' с' if answer['ok'] else answer['error']}")


def sweep() -> None:
    """Убираем ответы, за которыми никто не пришёл."""
    edge = datetime.now() - KEEP
    for leftover in ANSWERS.glob("*.json"):
        try:
            if datetime.fromtimestamp(leftover.stat().st_mtime) < edge:
                leftover.unlink(missing_ok=True)
        except OSError:
            pass


def main() -> int:
    schema = prepare()
    say(f"мост запущен, Codex: {CODEX}, ящик: {AGENT_DIR}")

    last_sweep = time.monotonic()
    while True:
        try:
            tasks = sorted(QUEUE.glob("*.json"), key=lambda path: path.stat().st_mtime)
        except OSError:
            tasks = []

        for request in tasks:
            handle(request, schema)

        if time.monotonic() - last_sweep > 600:
            sweep()
            last_sweep = time.monotonic()

        time.sleep(POLL)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
