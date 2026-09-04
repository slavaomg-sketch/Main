#!/usr/bin/env bash
# Восстановление из резервной копии: bash deploy/restore.sh db-XXXX.dump [storage-XXXX.tgz]
set -euo pipefail
DB_DUMP="${1:?Укажите файл дампа БД}"
STORAGE_TGZ="${2:-}"
cd "$(dirname "$0")/.."
echo "→ Восстановление БД из $DB_DUMP"
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-techmatch}" -d "${POSTGRES_DB:-techmatch}" --clean --if-exists < "$DB_DUMP"
if [[ -n "$STORAGE_TGZ" ]]; then
  echo "→ Восстановление медиа из $STORAGE_TGZ"
  docker run --rm -v "$(basename "$PWD")_storage:/storage" -v "$(dirname "$(realpath "$STORAGE_TGZ")"):/backup:ro" alpine sh -c "cd /storage && tar xzf /backup/$(basename "$STORAGE_TGZ")"
fi
echo "✓ Готово"
