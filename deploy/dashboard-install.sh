#!/usr/bin/env bash
#
# Установка веб-панели маркетплейсов на VPS (Ubuntu / Debian).
#
#   sudo bash deploy/dashboard-install.sh
#
# Скрипт идемпотентный: повторный запуск обновляет код и зависимости,
# не трогая .env и базу раскладок.
#
# Переменные окружения для нестандартных случаев:
#   APP_DIR=/opt/marketplace-dashboard   куда установить
#   APP_USER=mpdashboard                 от кого запускать
#   PORT=8080                            на каком порту слушать
#   SKIP_APT=1                           не ставить системные пакеты
#   SKIP_SYSTEMD=1                       не трогать systemd

set -euo pipefail

APP_NAME="marketplace-dashboard"
APP_DIR="${APP_DIR:-/opt/marketplace-dashboard}"
APP_USER="${APP_USER:-mpdashboard}"
PORT="${PORT:-8080}"
SKIP_APT="${SKIP_APT:-0}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

step()  { printf '\n%s==>%s %s%s\n' "$BOLD" "$OFF" "$1" "$OFF"; }
ok()    { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()   { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash deploy/dashboard-install.sh"
[[ -f "$SOURCE_DIR/requirements.txt" ]] || die "Не нашёл requirements.txt рядом со скриптом."
[[ -d "$SOURCE_DIR/web" ]] || die "Не нашёл папку web/ — репозиторий скопирован не полностью."
[[ "$SOURCE_DIR" != "$APP_DIR" ]] || die "APP_DIR совпадает с папкой исходников. Клонируйте репозиторий отдельно."

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
    cp -r "$SOURCE_DIR"/dashboard "$SOURCE_DIR"/web "$SOURCE_DIR"/deploy \
          "$SOURCE_DIR"/requirements.txt "$APP_DIR"/
fi
mkdir -p "$APP_DIR/data"
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

set_env() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$APP_DIR/.env"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$APP_DIR/.env"
    else
        printf '%s=%s\n' "$key" "$value" >> "$APP_DIR/.env"
    fi
}

# База раскладок должна лежать в data/, иначе systemd не даст в неё писать.
set_env DASHBOARD_DB_PATH "$APP_DIR/data/dashboard.db"
set_env DASHBOARD_PORT "$PORT"

# Секрет для подписи cookie — генерируем один раз.
if grep -q '^DASHBOARD_SECRET=change-me-in-production' "$APP_DIR/.env" || ! grep -q '^DASHBOARD_SECRET=' "$APP_DIR/.env"; then
    set_env DASHBOARD_SECRET "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    ok "сгенерирован секрет сессий"
fi

# Панель смотрит наружу, поэтому пароль спрашиваем сразу.
if [[ -t 0 ]] && ! grep -qE '^DASHBOARD_PASSWORD=.+' "$APP_DIR/.env"; then
    printf '\n    Пароль для входа в панель (Enter — оставить открытой): '
    read -r dashboard_password
    if [[ -n "$dashboard_password" ]]; then
        set_env DASHBOARD_PASSWORD "$dashboard_password"
        ok "пароль записан"
    else
        warn "панель будет доступна без пароля — закройте порт firewall'ом"
    fi
fi

chmod 600 "$APP_DIR/.env"
chmod +x "$APP_DIR/deploy/"*.sh 2>/dev/null || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "права выданы пользователю $APP_USER"

# ----------------------------------------------------------------------- systemd

if [[ "$SKIP_SYSTEMD" == "1" ]]; then
    step "systemd пропущен (SKIP_SYSTEMD=1)"
else
    step "Автозапуск"
    sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" \
        "$SOURCE_DIR/deploy/$APP_NAME.service" > "/etc/systemd/system/$APP_NAME.service"
    systemctl daemon-reload
    systemctl enable --quiet "$APP_NAME.service"
    systemctl restart "$APP_NAME.service"
    sleep 3
    if systemctl is-active --quiet "$APP_NAME.service"; then
        ok "панель запущена"
    else
        warn "панель не поднялась — смотрите: journalctl -u $APP_NAME -n 50"
    fi
fi

# ------------------------------------------------------------------------ итоги

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

printf '\n%s────────────────────────────────────────────%s\n' "$BOLD" "$OFF"
printf '%s Готово. Панель установлена в %s%s\n\n' "$GREEN" "$APP_DIR" "$OFF"
printf ' Откройте в браузере:  http://%s:%s\n\n' "${IP:-АДРЕС_СЕРВЕРА}" "$PORT"
printf ' Пока ключи маркетплейсов не заданы, показываются демо-данные.\n'
printf ' Впишите ключи и перезапустите:\n\n'
printf '   sudo nano %s/.env\n' "$APP_DIR"
printf '   sudo systemctl restart %s\n\n' "$APP_NAME"
printf ' Команды:\n'
printf '   sudo systemctl status %s      состояние\n' "$APP_NAME"
printf '   sudo journalctl -u %s -f      логи в реальном времени\n' "$APP_NAME"
printf '   sudo systemctl restart %s     перезапуск\n\n' "$APP_NAME"
