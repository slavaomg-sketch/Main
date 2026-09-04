#!/usr/bin/env bash
#
# Удаление бота с сервера. База и бэкапы по умолчанию остаются.
#
#   sudo bash deploy/uninstall.sh              оставить данные
#   sudo bash deploy/uninstall.sh --purge      удалить всё, включая базу

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/reminder-bot}"
APP_USER="${APP_USER:-reminderbot}"
APP_NAME="reminder-bot"
PURGE=0
[[ "${1:-}" == "--purge" ]] && PURGE=1

[[ $EUID -eq 0 ]] || { echo "Запустите через sudo." >&2; exit 1; }

systemctl disable --now "$APP_NAME.service" 2>/dev/null || true
systemctl disable --now "$APP_NAME-backup.timer" 2>/dev/null || true
rm -f "/etc/systemd/system/$APP_NAME.service" \
      "/etc/systemd/system/$APP_NAME-backup.service" \
      "/etc/systemd/system/$APP_NAME-backup.timer"
systemctl daemon-reload
echo "Сервисы удалены."

if [[ "$PURGE" == "1" ]]; then
    rm -rf "$APP_DIR"
    userdel -r "$APP_USER" 2>/dev/null || true
    echo "Удалено всё, включая базу данных."
else
    rm -rf "${APP_DIR:?}/bot" "${APP_DIR:?}/.venv"
    echo "Код удалён. База и бэкапы остались в $APP_DIR/data и $APP_DIR/backups."
fi
