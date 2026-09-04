#!/usr/bin/env bash
# Резервное копирование базы и медиа TechMatch (запускать на сервере: cron/systemd timer).
#   BACKUP_DIR=/var/backups/techmatch KEEP_DAYS=14 bash deploy/backup.sh
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/var/backups/techmatch}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cd "$(dirname "$0")/.."
echo "→ Дамп PostgreSQL"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-techmatch}" -Fc "${POSTGRES_DB:-techmatch}" > "$BACKUP_DIR/db-$STAMP.dump"
echo "→ Архив медиа и импортов"
docker run --rm -v "$(basename "$PWD")_storage:/storage:ro" -v "$BACKUP_DIR:/backup" alpine tar czf "/backup/storage-$STAMP.tgz" -C /storage .
echo "→ Ротация старше $KEEP_DAYS дней"
find "$BACKUP_DIR" -type f -mtime "+$KEEP_DAYS" -delete
echo "✓ Готово: $BACKUP_DIR/db-$STAMP.dump, storage-$STAMP.tgz"
