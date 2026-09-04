#!/usr/bin/env bash
#
# Резервная копия базы. Запускается таймером systemd раз в сутки,
# можно и вручную: bash deploy/backup.sh
#
#   KEEP_DAYS=30   сколько копий хранить

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DB_FILE="${DB_FILE:-$APP_DIR/data/bot.db}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

PYTHON="$APP_DIR/.venv/bin/python"
[[ -x "$PYTHON" ]] || PYTHON="$(command -v python3)"

if [[ ! -f "$DB_FILE" ]]; then
    echo "База ещё не создана: $DB_FILE — копировать нечего."
    exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
TARGET="$BACKUP_DIR/bot-$STAMP.db"

# Штатный механизм SQLite: снимок консистентен даже под нагрузкой,
# в отличие от простого cp работающей базы.
DB_FILE="$DB_FILE" TARGET="$TARGET" "$PYTHON" - <<'PY'
import os
import sqlite3

source = sqlite3.connect(f"file:{os.environ['DB_FILE']}?mode=ro", uri=True)
target = sqlite3.connect(os.environ["TARGET"])
with target:
    source.backup(target)
target.close()
source.close()
PY

gzip -f "$TARGET"
echo "Копия: $TARGET.gz ($(du -h "$TARGET.gz" | cut -f1))"

DELETED=$(find "$BACKUP_DIR" -name 'bot-*.db.gz' -type f -mtime "+$KEEP_DAYS" -print -delete | wc -l)
[[ "$DELETED" -gt 0 ]] && echo "Удалено старых копий: $DELETED"
exit 0
