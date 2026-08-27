#!/usr/bin/env bash
#
# Обновление бота до свежей версии из git.
#
#   sudo bash deploy/update.sh
#
# База данных и .env не затрагиваются. Перед обновлением делается бэкап.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/reminder-bot}"
APP_NAME="reminder-bot"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; OFF=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
die()  { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo."

# Установщик запоминает, из какой папки его вызывали, — там лежит git-клон.
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -d "$SOURCE_DIR/.git" && -f "$APP_DIR/.install-source" ]]; then
    SOURCE_DIR="$(cat "$APP_DIR/.install-source")"
fi
[[ -d "$SOURCE_DIR/.git" ]] || die "Не нашёл git-клон проекта. Запустите скрипт из папки, куда клонировали репозиторий."

step "Резервная копия базы"
bash "$APP_DIR/deploy/backup.sh" || true

step "Свежий код из git ($SOURCE_DIR)"
git -C "$SOURCE_DIR" fetch --quiet origin
BRANCH="$(git -C "$SOURCE_DIR" rev-parse --abbrev-ref HEAD)"
git -C "$SOURCE_DIR" pull --quiet --ff-only origin "$BRANCH"
printf '    %s\n' "$(git -C "$SOURCE_DIR" log --oneline -1)"

step "Переустановка"
APP_DIR="$APP_DIR" SKIP_APT=1 bash "$SOURCE_DIR/deploy/install.sh"

printf '\n%sОбновление завершено.%s\n\n' "$GREEN" "$OFF"
systemctl status "$APP_NAME" --no-pager --lines 5 || true
