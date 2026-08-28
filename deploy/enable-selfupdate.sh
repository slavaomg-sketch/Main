#!/usr/bin/env bash
#
# Разрешить обновлять панель без ввода команд в терминале.
#
#   sudo bash ~/dashboard-src/deploy/enable-selfupdate.sh
#
# Что настраивается:
#   * /usr/local/sbin/marketplace-dashboard-update — привилегированный скрипт
#     обновления. Лежит отдельно от кода панели и обновлением НЕ перезаписывается;
#   * systemd-служба, которая его запускает;
#   * systemd-наблюдатель за файлом-сигналом в каталоге очереди.
#
# После этого обновление запускается созданием файла:
#   touch ~/dashboard-deploy/request
# Результат пишется в ~/dashboard-deploy/last-update.log

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/marketplace-dashboard}"
APP_USER="${APP_USER:-mpdashboard}"
SRC_USER="${SRC_USER:-slava}"
SRC_DIR="${SRC_DIR:-/home/$SRC_USER/dashboard-src}"
QUEUE_DIR="${QUEUE_DIR:-/home/$SRC_USER/dashboard-deploy}"
BRANCH="${BRANCH:-claude/marketplace-unified-dashboard-anbqou}"

GREEN=$'\033[32m'; RED=$'\033[31m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
die()  { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash ~/dashboard-src/deploy/enable-selfupdate.sh"
[[ -d "$APP_DIR" ]] || die "Не нашёл $APP_DIR — панель не установлена?"
[[ -d "$SRC_DIR" ]] || die "Не нашёл $SRC_DIR — репозиторий не склонирован?"
id -u "$SRC_USER" >/dev/null 2>&1 || die "Нет пользователя $SRC_USER"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step "Скрипт обновления"
install -m 755 -o root -g root \
    "$SOURCE_DIR/dashboard-selfupdate.sh" /usr/local/sbin/marketplace-dashboard-update
ok "/usr/local/sbin/marketplace-dashboard-update"

step "Каталог очереди"
mkdir -p "$QUEUE_DIR"
chown "$SRC_USER":"$SRC_USER" "$QUEUE_DIR"
chmod 755 "$QUEUE_DIR"
ok "$QUEUE_DIR"

step "Службы systemd"
for unit in marketplace-dashboard-update.service marketplace-dashboard-update.path; do
    sed -e "s|__SRC__|$SRC_DIR|g" -e "s|__APP__|$APP_DIR|g" \
        -e "s|__APP_USER__|$APP_USER|g" -e "s|__SRC_USER__|$SRC_USER|g" \
        -e "s|__BRANCH__|$BRANCH|g" -e "s|__QUEUE__|$QUEUE_DIR|g" \
        "$SOURCE_DIR/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --quiet --now marketplace-dashboard-update.path
ok "наблюдатель запущен"

printf '\n%s────────────────────────────────────────────%s\n' "$BOLD" "$OFF"
printf '%s Готово. Обновления больше не требуют вашего участия.%s\n\n' "$GREEN" "$OFF"
printf ' Обновление запускается созданием файла:\n'
printf '   touch %s/request\n\n' "$QUEUE_DIR"
printf ' Что произошло, видно здесь:\n'
printf '   cat %s/last-update.log\n\n' "$QUEUE_DIR"
printf ' Выключить в любой момент:\n'
printf '   sudo systemctl disable --now marketplace-dashboard-update.path\n\n'
