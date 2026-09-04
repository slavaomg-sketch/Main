#!/usr/bin/env bash
#
# Установка бота напоминаний на VPS (Ubuntu / Debian).
#
#   sudo bash deploy/install.sh
#
# Скрипт идемпотентный: повторный запуск обновляет код и зависимости,
# не трогая .env и базу данных.
#
# Переменные окружения для нестандартных случаев:
#   APP_DIR=/opt/reminder-bot   куда установить
#   APP_USER=reminderbot        от кого запускать
#   SKIP_APT=1                  не ставить системные пакеты
#   SKIP_SYSTEMD=1              не трогать systemd (для проверки в контейнере)

set -euo pipefail

APP_NAME="reminder-bot"
APP_DIR="${APP_DIR:-/opt/reminder-bot}"
APP_USER="${APP_USER:-reminderbot}"
SKIP_APT="${SKIP_APT:-0}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

step()  { printf '\n%s==>%s %s%s\n' "$BOLD" "$OFF" "$1" "$OFF"; }
ok()    { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()   { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash deploy/install.sh"
[[ -f "$SOURCE_DIR/requirements.txt" ]] || die "Не нашёл requirements.txt рядом со скриптом."
[[ "$SOURCE_DIR" != "$APP_DIR" ]] || die "APP_DIR совпадает с папкой исходников. Клонируйте репозиторий отдельно, например в ~/reminder-bot-src."

# ------------------------------------------------------------- системные пакеты

if [[ "$SKIP_APT" != "1" ]]; then
    step "Системные пакеты"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq python3 python3-venv python3-pip rsync ca-certificates tzdata
    ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2), venv, rsync"
else
    step "Системные пакеты пропущены (SKIP_APT=1)"
fi

command -v python3 >/dev/null || die "python3 не найден."

# ------------------------------------------------------------ пользователь и код

step "Пользователь $APP_USER"
if id -u "$APP_USER" >/dev/null 2>&1; then
    ok "уже существует"
else
    useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
    ok "создан"
fi

step "Код в $APP_DIR"
mkdir -p "$APP_DIR"
if command -v rsync >/dev/null; then
    rsync -a --delete \
        --exclude '.git/' --exclude '.venv/' --exclude 'data/' --exclude 'backups/' \
        --exclude '.env' --exclude '__pycache__/' --exclude '.pytest_cache/' \
        "$SOURCE_DIR"/ "$APP_DIR"/
else
    cp -r "$SOURCE_DIR"/bot "$SOURCE_DIR"/deploy "$SOURCE_DIR"/requirements.txt "$APP_DIR"/
fi
mkdir -p "$APP_DIR/data" "$APP_DIR/backups"
# Запоминаем, где лежит git-клон, — отсюда update.sh возьмёт свежий код.
printf '%s\n' "$SOURCE_DIR" > "$APP_DIR/.install-source"
ok "скопирован"

# --------------------------------------------------------------------- окружение

step "Виртуальное окружение"
if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
    python3 -m venv "$APP_DIR/.venv"
    ok "создано"
fi
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"
ok "зависимости установлены"

# ---------------------------------------------------------------- файл настроек

step "Настройки (.env)"
if [[ ! -f "$APP_DIR/.env" ]]; then
    cp "$SOURCE_DIR/.env.example" "$APP_DIR/.env"
    ok "создан из шаблона"
else
    ok "уже есть — не трогаю"
fi

# Токен спрашиваем, только если запустили руками и он ещё не заполнен.
if grep -q 'BOT_TOKEN=123456789:AAExampleTokenReplaceMe' "$APP_DIR/.env" && [[ -t 0 ]]; then
    printf '\n    Токен бота от @BotFather: '
    read -r bot_token
    printf '    Ваш Telegram ID (узнать: @userinfobot): '
    read -r admin_ids
    if [[ -n "$bot_token" && -n "$admin_ids" ]]; then
        sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=${bot_token}|" "$APP_DIR/.env"
        sed -i "s|^ADMIN_IDS=.*|ADMIN_IDS=${admin_ids}|" "$APP_DIR/.env"
        ok "токен и администратор записаны"
    fi
fi

# База должна лежать в data/, иначе systemd не даст в неё писать.
if ! grep -q "^DB_PATH=$APP_DIR/data/bot.db" "$APP_DIR/.env"; then
    if grep -q '^DB_PATH=' "$APP_DIR/.env"; then
        sed -i "s|^DB_PATH=.*|DB_PATH=$APP_DIR/data/bot.db|" "$APP_DIR/.env"
    else
        printf '\nDB_PATH=%s/data/bot.db\n' "$APP_DIR" >> "$APP_DIR/.env"
    fi
    ok "путь к базе: $APP_DIR/data/bot.db"
fi

CONFIGURED=1
grep -q 'BOT_TOKEN=123456789:AAExampleTokenReplaceMe' "$APP_DIR/.env" && CONFIGURED=0
grep -qE '^ADMIN_IDS=\s*$' "$APP_DIR/.env" && CONFIGURED=0

chmod 600 "$APP_DIR/.env"
chmod +x "$APP_DIR/deploy/"*.sh 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "права выданы пользователю $APP_USER"

# ----------------------------------------------------------------------- systemd

if [[ "$SKIP_SYSTEMD" == "1" ]]; then
    step "systemd пропущен (SKIP_SYSTEMD=1)"
else
    step "Автозапуск"
    for unit in "$APP_NAME.service" "$APP_NAME-backup.service" "$APP_NAME-backup.timer"; do
        if [[ -f "$SOURCE_DIR/deploy/$unit" ]]; then
            sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" \
                "$SOURCE_DIR/deploy/$unit" > "/etc/systemd/system/$unit"
        fi
    done
    systemctl daemon-reload
    systemctl enable --quiet "$APP_NAME.service"
    systemctl enable --quiet --now "$APP_NAME-backup.timer"
    ok "юниты установлены, ежедневный бэкап включён"

    if [[ "$CONFIGURED" == "1" ]]; then
        systemctl restart "$APP_NAME.service"
        sleep 3
        if systemctl is-active --quiet "$APP_NAME.service"; then
            ok "бот запущен"
        else
            warn "бот не поднялся — смотрите: journalctl -u $APP_NAME -n 50"
        fi
    else
        warn "токен не заполнен — бот пока не запускаю"
    fi
fi

# ------------------------------------------------------------------------ итоги

printf '\n%s────────────────────────────────────────────%s\n' "$BOLD" "$OFF"
if [[ "$CONFIGURED" == "1" ]]; then
    printf '%s Готово. Бот установлен в %s%s\n\n' "$GREEN" "$APP_DIR" "$OFF"
    printf ' Откройте своего бота в Telegram и отправьте /start\n\n'
else
    printf '%s Осталось вписать токен:%s\n\n' "$YELLOW" "$OFF"
    printf '   sudo nano %s/.env\n' "$APP_DIR"
    printf '   sudo systemctl start %s\n\n' "$APP_NAME"
fi
printf ' Команды:\n'
printf '   sudo systemctl status %s      состояние\n' "$APP_NAME"
printf '   sudo journalctl -u %s -f      логи в реальном времени\n' "$APP_NAME"
printf '   sudo systemctl restart %s     перезапуск\n' "$APP_NAME"
printf '   sudo bash %s/deploy/update.sh  обновление\n\n' "$APP_DIR"
