#!/usr/bin/env bash
#
# Восстановление базы из резервной копии.
#
#   sudo bash deploy/restore.sh                      последняя копия
#   sudo bash deploy/restore.sh backups/bot-....gz   конкретная копия
#
# Текущая база не удаляется, а откладывается рядом с пометкой .before-restore.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/reminder-bot}"
APP_USER="${APP_USER:-reminderbot}"
APP_NAME="reminder-bot"
DB_FILE="$APP_DIR/data/bot.db"

[[ $EUID -eq 0 ]] || { echo "Запустите через sudo." >&2; exit 1; }

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
    ARCHIVE="$(find "$APP_DIR/backups" -name 'bot-*.db.gz' -type f | sort | tail -1)"
fi
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "Копия не найдена. Что есть:" >&2; ls -1 "$APP_DIR/backups" 2>/dev/null >&2; exit 1; }

echo "Восстанавливаю из: $ARCHIVE"
read -r -p "Текущая база будет заменена. Продолжить? [y/N] " answer
[[ "$answer" =~ ^[YyДд]$ ]] || { echo "Отменено."; exit 0; }

systemctl stop "$APP_NAME" 2>/dev/null || true

if [[ -f "$DB_FILE" ]]; then
    mv "$DB_FILE" "$DB_FILE.before-restore-$(date +%Y-%m-%d_%H%M)"
    # Журналы WAL относятся к прежней базе — иначе SQLite смешает их с новой.
    rm -f "$DB_FILE-wal" "$DB_FILE-shm"
fi

gunzip -c "$ARCHIVE" > "$DB_FILE"
chown "$APP_USER:$APP_USER" "$DB_FILE"

systemctl start "$APP_NAME" 2>/dev/null || true
echo "Готово. Прежняя база сохранена рядом с пометкой .before-restore."
