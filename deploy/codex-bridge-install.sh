#!/usr/bin/env bash
#
# Мост между панелью и Codex CLI: установка и запуск.
#
# Запускать от обычного пользователя, под которым авторизован Codex
# (обычно `slava`). Права root НЕ нужны: доступ панели к каталогам
# выдаётся через ACL, а сам мост держится в живых заданием cron.
#
#   bash deploy/codex-bridge-install.sh
#
# Что делает:
#   1) создаёт почтовый ящик ~/wb-agent (очередь, ответы, рабочий каталог);
#   2) открывает доступ к нему пользователю панели;
#   3) кладёт сам мост в ~/wb-agent/codex-worker.py;
#   4) заводит службу пользователя, чтобы мост поднимался сам;
#   5) запускает мост прямо сейчас.

set -euo pipefail

AGENT_DIR="${WB_AGENT_DIR:-$HOME/wb-agent}"
APP_USER="${APP_USER:-mpdashboard}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/codex-worker.py"
WORKER="$AGENT_DIR/codex-worker.py"
UNIT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/codex-bridge.service"
UNIT_DIR="$HOME/.config/systemd/user"
SERVICE="codex-bridge"

say() { printf '  %s\n' "$1"; }

echo "Мост панель ↔ Codex CLI"

if ! command -v codex >/dev/null 2>&1; then
    echo "Codex CLI не найден. Установите его и повторите." >&2
    exit 1
fi
say "Codex найден: $(command -v codex), $(codex --version 2>/dev/null | head -1)"

mkdir -p "$AGENT_DIR/queue" "$AGENT_DIR/answers" "$AGENT_DIR/work"
say "почтовый ящик: $AGENT_DIR"

# Панель работает от другого пользователя — пускаем его в ящик точечно.
if id "$APP_USER" >/dev/null 2>&1; then
    setfacl -R -m "u:$APP_USER:rwx" "$AGENT_DIR"
    setfacl -d -m "u:$APP_USER:rwx" "$AGENT_DIR/queue" "$AGENT_DIR/answers"
    say "доступ выдан пользователю $APP_USER"
else
    say "пользователь $APP_USER не найден — доступ не выдан"
fi

install -m 0755 "$SOURCE" "$WORKER"
say "мост установлен: $WORKER"

# Служба пользователя: сама поднимется после перезагрузки и после сбоя.
# Работает от того же пользователя, что и Codex, — иначе он не найдёт свою
# авторизацию. Системная служба тут не подошла бы: она требует root.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SOURCE" "$UNIT_DIR/$SERVICE.service"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE" >/dev/null 2>&1 || true
systemctl --user restart "$SERVICE"
say "служба $SERVICE запущена"

# Без «задержки» служб пользователя мост умрёт при выходе из сервера.
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
    echo
    echo "ВНИМАНИЕ: мост остановится, когда вы выйдете из сервера."
    echo "Выполните один раз:  sudo loginctl enable-linger $USER"
fi

sleep 2
if systemctl --user is-active --quiet "$SERVICE"; then
    say "мост работает"
else
    echo "Мост не поднялся. Журнал:  journalctl --user -u $SERVICE -n 30" >&2
    exit 1
fi

echo
echo "Готово. Панель кладёт задания в $AGENT_DIR/queue,"
echo "мост отвечает в $AGENT_DIR/answers, журнал — $AGENT_DIR/worker.log"
echo "Состояние службы:  systemctl --user status $SERVICE"
