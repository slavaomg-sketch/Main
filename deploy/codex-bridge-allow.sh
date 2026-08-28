#!/usr/bin/env bash
#
# Открыть панели доступ к мосту Codex. Запускается ОДИН РАЗ и через sudo:
#
#   sudo bash deploy/codex-bridge-allow.sh
#
# Зачем нужен root. Служба панели намеренно ужата: домашние каталоги ей
# не видны (ProtectHome), а вся файловая система открыта только на чтение
# (ProtectSystem=strict). Это правильно и менять это целиком не нужно —
# достаточно проделать одну дверцу в общий каталог.
#
# Скрипт лежит отдельно от кода панели и обновлением кода не запускается:
# привилегированную часть нельзя изменить, просто отправив коммит.
#
# Что делает:
#   1) создаёт общий каталог /var/lib/wb-agent;
#   2) отдаёт его владельцу Codex, а панели выдаёт доступ через ACL;
#   3) добавляет службе панели разрешение писать именно в этот каталог;
#   4) перезапускает панель.

set -euo pipefail

AGENT_DIR="${WB_AGENT_DIR:-/var/lib/wb-agent}"
BRIDGE_USER="${BRIDGE_USER:-${SUDO_USER:-slava}}"
APP_USER="${APP_USER:-mpdashboard}"
SERVICE="marketplace-dashboard"
DROPIN="/etc/systemd/system/$SERVICE.service.d"

say() { printf '  %s\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
    echo "Нужны права root. Запустите: sudo bash $0" >&2
    exit 1
fi

echo "Доступ панели к мосту Codex"

id "$BRIDGE_USER" >/dev/null 2>&1 || { echo "Нет пользователя $BRIDGE_USER" >&2; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "Нет пользователя $APP_USER" >&2; exit 1; }

install -d -o "$BRIDGE_USER" -g "$BRIDGE_USER" -m 0755 \
    "$AGENT_DIR" "$AGENT_DIR/queue" "$AGENT_DIR/answers" "$AGENT_DIR/work"
say "общий каталог: $AGENT_DIR (владелец $BRIDGE_USER)"

setfacl -R -m "u:$APP_USER:rwx" "$AGENT_DIR"
setfacl -d -m "u:$APP_USER:rwx" "$AGENT_DIR/queue" "$AGENT_DIR/answers"
say "панели ($APP_USER) выдан доступ"

# Дописываем разрешение отдельным файлом, а не правкой самой службы:
# так обновление панели его не затрёт и откатить проще.
mkdir -p "$DROPIN"
cat > "$DROPIN/codex-bridge.conf" <<EOF
# Разрешение панели писать в общий каталог моста к Codex.
# Всё остальное ужатие службы остаётся как было.
[Service]
ReadWritePaths=$AGENT_DIR
EOF
say "службе панели разрешена запись в $AGENT_DIR"

systemctl daemon-reload
systemctl restart "$SERVICE"
sleep 3

if systemctl is-active --quiet "$SERVICE"; then
    say "панель перезапущена"
else
    echo "Панель не поднялась. Журнал:  journalctl -u $SERVICE -n 40" >&2
    exit 1
fi

echo
echo "Готово. Теперь выполните от своего имени (без sudo):"
echo "  bash $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/codex-bridge-install.sh"
