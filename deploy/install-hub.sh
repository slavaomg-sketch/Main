#!/usr/bin/env bash
#
# Установка бота-хаба (ветка «Доставка» и всё, что добавите дальше)
# рядом с уже работающим ботом напоминаний.
#
#   sudo bash deploy/install-hub.sh
#
# Скрипт сам: скопирует код, спросит токен и ваш Telegram ID, проверит токен
# у Telegram, поставит автозапуск и покажет результат. Бот напоминаний,
# его базу и .env не трогает. Повторный запуск безопасен.
#
# Переменные (обычно не нужны):
#   APP_DIR=/opt/reminder-bot   куда установлен проект
#   APP_USER=reminderbot        от кого запускать
#   SKIP_SYSTEMD=1              не трогать systemd (для проверки скрипта)

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/reminder-bot}"
APP_USER="${APP_USER:-reminderbot}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"
SERVICE="hub-bot"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash deploy/install-hub.sh"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -d "$SOURCE_DIR/hub" ]] || die "В $SOURCE_DIR нет папки hub/. Возьмите свежий код: git pull"
[[ -d "$APP_DIR" ]] || die "Не нашёл $APP_DIR. Сначала поставьте бот напоминаний: sudo bash deploy/install.sh"

ENV_FILE="$APP_DIR/.env"
[[ -f "$ENV_FILE" ]] || die "Не нашёл $ENV_FILE. Сначала поставьте бот напоминаний: sudo bash deploy/install.sh"

# ------------------------------------------------------------------------- код

step "Код в $APP_DIR"
if command -v rsync >/dev/null; then
    rsync -a --delete "$SOURCE_DIR/hub/" "$APP_DIR/hub/"
    rsync -a --delete "$SOURCE_DIR/tracker/" "$APP_DIR/tracker/"
    rsync -a "$SOURCE_DIR/deploy/" "$APP_DIR/deploy/"
else
    rm -rf "$APP_DIR/hub" "$APP_DIR/tracker"
    cp -r "$SOURCE_DIR/hub" "$SOURCE_DIR/tracker" "$APP_DIR/"
    cp -r "$SOURCE_DIR/deploy/." "$APP_DIR/deploy/"
fi
cp "$SOURCE_DIR/requirements.txt" "$APP_DIR/requirements.txt"
find "$APP_DIR/hub" "$APP_DIR/tracker" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
ok "$(git -C "$SOURCE_DIR" log --oneline -1 2>/dev/null || echo 'файлы скопированы')"

step "Зависимости"
PY="$APP_DIR/.venv/bin/python"
[[ -x "$PY" ]] || die "Не нашёл окружение $PY. Запустите сначала: sudo bash deploy/install.sh"
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"
ok "новых зависимостей у хаба нет — окружение готово"

# ------------------------------------------------------------------- настройки

# Значение переменной из .env. Отсутствие строки — не ошибка, а пустое значение.
read_env() {
    local line
    line="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
    line="${line#*=}"
    line="${line%$'\r'}"
    line="${line%\"}"; line="${line#\"}"
    line="${line%\'}"; line="${line#\'}"
    printf '%s' "$line"
}

set_env() {
    local key="$1" value="$2"
    if grep -qE "^$key=" "$ENV_FILE"; then
        local tmp; tmp="$(mktemp)"
        grep -vE "^$key=" "$ENV_FILE" > "$tmp"
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
        cat "$tmp" > "$ENV_FILE"
        rm -f "$tmp"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

step "Токен бота"
HUB_TOKEN="$(read_env HUB_BOT_TOKEN)"
[[ -n "$HUB_TOKEN" ]] || HUB_TOKEN="$(read_env TRACKER_BOT_TOKEN)"
REMINDER_TOKEN="$(read_env BOT_TOKEN)"

if [[ -n "$HUB_TOKEN" ]]; then
    ok "уже прописан в .env"
elif [[ -t 0 ]]; then
    printf '\n    Токен нового бота от @BotFather (вида 8123456789:AAG...):\n'
    printf '    > '
    read -r HUB_TOKEN
    HUB_TOKEN="${HUB_TOKEN//[[:space:]]/}"
else
    die "Токен не задан, а спросить не могу (нет терминала). Впишите HUB_BOT_TOKEN в $ENV_FILE и запустите снова."
fi

[[ "$HUB_TOKEN" =~ ^[0-9]{6,}:[A-Za-z0-9_-]{30,}$ ]] || die "Это не похоже на токен бота. Он выглядит так: 8123456789:AAGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
[[ "$HUB_TOKEN" != "$REMINDER_TOKEN" ]] || die "Это токен бота напоминаний. Нужен ОТДЕЛЬНЫЙ бот: @BotFather -> /newbot"

step "Проверка токена у Telegram"
BOT_NAME="$("$PY" - "$HUB_TOKEN" <<'PYEOF' || true
import json, sys, urllib.error, urllib.request

token = sys.argv[1]
try:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=15) as response:
        answer = json.load(response)
    print(answer.get("result", {}).get("username", ""))
except urllib.error.HTTPError as error:
    print("BAD_TOKEN" if error.code in (401, 404) else "", file=sys.stdout)
except Exception:
    print("", file=sys.stdout)
PYEOF
)"
BOT_NAME="${BOT_NAME//[[:space:]]/}"

if [[ "$BOT_NAME" == "BAD_TOKEN" ]]; then
    die "Telegram отклонил токен. Проверьте, что скопировали его целиком, или перевыпустите у @BotFather."
elif [[ -n "$BOT_NAME" ]]; then
    ok "бот @$BOT_NAME"
else
    warn "не смог связаться с Telegram — проверю уже при запуске"
fi

step "Кому можно пользоваться ботом"
ALLOWED="$(read_env HUB_ALLOWED_IDS)"
[[ -n "$ALLOWED" ]] || ALLOWED="$(read_env TRACKER_ALLOWED_IDS)"

if [[ -n "$ALLOWED" ]]; then
    ok "уже прописано: $ALLOWED"
elif [[ -t 0 ]]; then
    DEFAULT_IDS="$(read_env ADMIN_IDS)"
    printf '\n    Ваш Telegram ID (узнать: @userinfobot).\n'
    printf '    Enter — взять из ADMIN_IDS (%s); слово "все" — открыть бота всем.\n' "${DEFAULT_IDS:-не задан}"
    printf '    > '
    read -r ALLOWED
    ALLOWED="${ALLOWED//[[:space:]]/}"
    case "$ALLOWED" in
        "")    ALLOWED="$DEFAULT_IDS" ;;
        все|всем|all) ALLOWED="" ;;
    esac
    [[ -z "$ALLOWED" || "$ALLOWED" =~ ^[0-9,]+$ ]] || die "ID — это число, например 123456789."
fi

set_env HUB_BOT_TOKEN "$HUB_TOKEN"
set_env HUB_ALLOWED_IDS "$ALLOWED"
[[ -n "$(read_env HUB_TZ)" ]] || set_env HUB_TZ "$(read_env DEFAULT_TZ || true)"
[[ -n "$(read_env HUB_TZ)" ]] || set_env HUB_TZ "Europe/Moscow"

chmod 600 "$ENV_FILE"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "настройки записаны в $ENV_FILE"
[[ -n "$ALLOWED" ]] && ok "доступ: $ALLOWED" || warn "доступ открыт всем, кто найдёт бота"

# --------------------------------------------------------------------- systemd

if [[ "$SKIP_SYSTEMD" == "1" ]] || ! command -v systemctl >/dev/null; then
    step "systemd пропущен"
    warn "запустить вручную: sudo -u $APP_USER $PY -m hub"
    exit 0
fi

step "Автозапуск"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" \
    "$SOURCE_DIR/deploy/hub-bot.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable --quiet "$SERVICE.service"
systemctl restart "$SERVICE.service"
sleep 4

if systemctl is-active --quiet "$SERVICE.service"; then
    ok "бот запущен и будет подниматься сам после перезагрузки"
else
    printf '\n%sБот не поднялся. Последние строки лога:%s\n\n' "$RED" "$OFF"
    journalctl -u "$SERVICE" -n 20 --no-pager || true
    die "Разберитесь по логу выше и запустите скрипт снова."
fi

# ------------------------------------------------------------------------ итог

printf '\n%s────────────────────────────────────────────%s\n' "$BOLD" "$OFF"
printf '%s Готово.%s ' "$GREEN" "$OFF"
if [[ -n "$BOT_NAME" && "$BOT_NAME" != "BAD_TOKEN" ]]; then
    printf 'Откройте в Telegram @%s и отправьте /start\n' "$BOT_NAME"
else
    printf 'Откройте своего бота в Telegram и отправьте /start\n'
fi
printf '\n Дальше просто пришлите ему ссылку вида\n'
printf '   https://dostavka.yandex.ru/route/...\n\n'
printf ' Команды:\n'
printf '   sudo systemctl status %s      состояние\n' "$SERVICE"
printf '   sudo journalctl -u %s -f      логи в реальном времени\n' "$SERVICE"
printf '   sudo systemctl restart %s     перезапуск\n' "$SERVICE"
printf '   sudo bash %s/deploy/install-hub.sh  обновление\n\n' "$APP_DIR"
