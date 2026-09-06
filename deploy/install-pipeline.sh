#!/usr/bin/env bash
#
# Установка конвейера карточек на VPS (Ubuntu / Debian).
#
#   sudo bash deploy/install-pipeline.sh
#
# Ставит Node.js, Claude Code, Codex CLI, клонирует репозиторий под отдельного
# пользователя, создаёт venv и systemd-сервис. Повторный запуск безопасен.
#
# Переменные для нестандартных случаев:
#   APP_DIR=/opt/cards-pipeline   куда установить
#   APP_USER=cards                от кого запускать
#   REPO_URL=https://github.com/slavaomg-sketch/Main.git
#   BRANCH=main
#   BOT_ENV=/opt/reminder-bot/.env   откуда взять BOT_TOKEN и ADMIN_IDS для уведомлений
#   SKIP_APT=1 / SKIP_SYSTEMD=1

set -euo pipefail

APP_NAME="cards-pipeline"
APP_DIR="${APP_DIR:-/opt/cards-pipeline}"
APP_USER="${APP_USER:-cards}"
APP_HOME="/home/$APP_USER"
REPO_URL="${REPO_URL:-https://github.com/slavaomg-sketch/Main.git}"
BRANCH="${BRANCH:-main}"
BOT_ENV="${BOT_ENV:-/opt/reminder-bot/.env}"
SKIP_APT="${SKIP_APT:-0}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
step()  { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()    { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn()  { printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()   { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash deploy/install-pipeline.sh"

# ------------------------------------------------------------- системные пакеты

if [[ "$SKIP_APT" != "1" ]]; then
    step "Системные пакеты"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq python3 python3-venv python3-pip git curl ca-certificates tzdata fonts-dejavu-core
    if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
        apt-get install -y -qq nodejs
    fi
    ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2), node $(node -v)"
    step "Claude Code и Codex CLI"
    npm install -g --silent @anthropic-ai/claude-code @openai/codex
    ok "claude $(claude --version 2>/dev/null | head -1), codex $(codex --version 2>/dev/null | head -1)"
else
    step "Системные пакеты пропущены (SKIP_APT=1)"
fi
command -v git >/dev/null || die "git не найден."
command -v python3 >/dev/null || die "python3 не найден."

# ------------------------------------------------------------ пользователь

step "Пользователь $APP_USER"
if id -u "$APP_USER" >/dev/null 2>&1; then
    ok "уже существует"
else
    useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
    ok "создан"
fi
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

# ------------------------------------------------------------ токен GitHub и клон

step "Доступ к GitHub"
GITHUB_TOKEN=""
if [[ -f "$APP_DIR/.env" ]]; then
    GITHUB_TOKEN="$(grep -E '^GITHUB_TOKEN=' "$APP_DIR/.env" | cut -d= -f2- || true)"
fi
if [[ -z "$GITHUB_TOKEN" && -t 0 ]]; then
    printf '    Токен GitHub с правом записи в репозиторий (fine-grained, Contents: Read and write): '
    read -r GITHUB_TOKEN
fi
[[ -n "$GITHUB_TOKEN" ]] || die "Без GITHUB_TOKEN конвейер не сможет забирать идеи и пушить карточки."

sudo -u "$APP_USER" -H git config --global credential.helper store
printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > "$APP_HOME/.git-credentials"
chown "$APP_USER:$APP_USER" "$APP_HOME/.git-credentials"
chmod 600 "$APP_HOME/.git-credentials"
sudo -u "$APP_USER" -H git config --global user.name "cards-pipeline"
sudo -u "$APP_USER" -H git config --global user.email "cards-pipeline@$(hostname -s)"
ok "учётные данные сохранены"

step "Репозиторий $REPO_URL ($BRANCH)"
if [[ -d "$APP_DIR/repo/.git" ]]; then
    sudo -u "$APP_USER" -H git -C "$APP_DIR/repo" fetch --quiet origin "$BRANCH"
    sudo -u "$APP_USER" -H git -C "$APP_DIR/repo" checkout --quiet "$BRANCH"
    sudo -u "$APP_USER" -H git -C "$APP_DIR/repo" pull --quiet --rebase origin "$BRANCH" || warn "pull не удался, продолжаю со старым кодом"
    ok "обновлён"
else
    sudo -u "$APP_USER" -H git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR/repo" \
        || die "Не удалось клонировать. Проверьте токен и что ветка $BRANCH существует (переименуйте ветку по умолчанию в main в настройках GitHub)."
    ok "склонирован"
fi

# ------------------------------------------------------------ окружение python

step "Виртуальное окружение"
if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
    sudo -u "$APP_USER" -H python3 -m venv "$APP_DIR/.venv"
fi
sudo -u "$APP_USER" -H "$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
sudo -u "$APP_USER" -H "$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/repo/requirements-pipeline.txt"
ok "зависимости установлены"

# ------------------------------------------------------------ .env

step "Настройки $APP_DIR/.env"
if [[ ! -f "$APP_DIR/.env" ]]; then
    BOT_TOKEN=""; ADMIN_IDS=""
    if [[ -f "$BOT_ENV" ]]; then
        BOT_TOKEN="$(grep -E '^BOT_TOKEN=' "$BOT_ENV" | cut -d= -f2- || true)"
        ADMIN_IDS="$(grep -E '^ADMIN_IDS=' "$BOT_ENV" | cut -d= -f2- || true)"
        [[ -n "$BOT_TOKEN" ]] && ok "BOT_TOKEN и ADMIN_IDS взяты из $BOT_ENV для уведомлений"
    fi
    if [[ -z "$BOT_TOKEN" && -t 0 ]]; then
        printf '    Токен Telegram-бота для уведомлений (Enter — без уведомлений): '
        read -r BOT_TOKEN
        if [[ -n "$BOT_TOKEN" ]]; then
            printf '    Ваш Telegram ID: '
            read -r ADMIN_IDS
        fi
    fi
    cat > "$APP_DIR/.env" <<ENV
# Конвейер карточек. Полный список настроек — в .env.example репозитория.
GITHUB_TOKEN=$GITHUB_TOKEN
PIPELINE_BRANCH=$BRANCH
PIPELINE_POLL_SECONDS=300
IMAGE_TEXT_MODE=both
SLIDES_PER_CARD=3
MAX_IDEAS_PER_RUN=0
MAX_IMAGES_PER_DAY=0
CLAUDE_MODEL=
CODEX_EXTRA_ARGS="--full-auto --skip-git-repo-check"
BOT_TOKEN=$BOT_TOKEN
ADMIN_IDS=$ADMIN_IDS
PIPELINE_NOTIFY=1
ENV
    ok "создан"
else
    ok "уже есть — не трогаю"
fi
chmod 600 "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ------------------------------------------------------------ вход в claude и codex

step "Вход в Claude Code и Codex"
CLAUDE_OK=0; CODEX_OK=0
[[ -f "$APP_HOME/.claude/.credentials.json" || -f "$APP_HOME/.claude.json" ]] && CLAUDE_OK=1
[[ -f "$APP_HOME/.codex/auth.json" ]] && CODEX_OK=1
[[ "$CLAUDE_OK" == "1" ]] && ok "Claude Code: вход уже выполнен" || warn "Claude Code: нужен вход (см. ниже)"
[[ "$CODEX_OK" == "1" ]] && ok "Codex: вход уже выполнен" || warn "Codex: нужен вход (см. ниже)"

# ------------------------------------------------------------ systemd

if [[ "$SKIP_SYSTEMD" == "1" ]]; then
    step "systemd пропущен (SKIP_SYSTEMD=1)"
else
    step "Сервис $APP_NAME"
    sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" -e "s|__APP_HOME__|$APP_HOME|g" \
        "$APP_DIR/repo/deploy/$APP_NAME.service" > "/etc/systemd/system/$APP_NAME.service"
    systemctl daemon-reload
    systemctl enable --quiet "$APP_NAME.service"
    if [[ "$CLAUDE_OK" == "1" && "$CODEX_OK" == "1" ]]; then
        systemctl restart "$APP_NAME.service"
        sleep 3
        systemctl is-active --quiet "$APP_NAME.service" && ok "конвейер запущен" || warn "не поднялся: journalctl -u $APP_NAME -n 50"
    else
        warn "сервис включён, но не запущен — сначала войдите в claude и codex"
    fi
fi

# ------------------------------------------------------------ итоги

printf '\n%s────────────────────────────────────────────%s\n' "$BOLD" "$OFF"
if [[ "$CLAUDE_OK" != "1" || "$CODEX_OK" != "1" ]]; then
    printf '%s Осталось войти в аккаунты (один раз):%s\n\n' "$YELLOW" "$OFF"
    [[ "$CLAUDE_OK" != "1" ]] && printf '   sudo -u %s -H claude            # выбрать вход по подписке, открыть ссылку на телефоне, вставить код, затем /exit\n' "$APP_USER"
    [[ "$CODEX_OK" != "1" ]]  && printf '   sudo -u %s -H codex login --device-auth   # открыть ссылку, ввести код\n' "$APP_USER"
    printf '\n   Потом: sudo systemctl start %s\n\n' "$APP_NAME"
else
    printf '%s Готово. Конвейер работает.%s\n\n' "$GREEN" "$OFF"
fi
printf ' Проверка без сервиса:\n'
printf '   sudo -u %s -H bash -c "cd %s/repo && set -a && . %s/.env && set +a && %s/.venv/bin/python -m pipeline.run --once"\n\n' "$APP_USER" "$APP_DIR" "$APP_DIR" "$APP_DIR"
printf ' Команды:\n'
printf '   sudo systemctl status %s      состояние\n' "$APP_NAME"
printf '   sudo journalctl -u %s -f      логи\n' "$APP_NAME"
printf '   sudo systemctl restart %s     перезапуск\n' "$APP_NAME"
printf '   sudo bash %s/repo/deploy/install-pipeline.sh   обновить зависимости (код обновляется сам при каждом pull)\n\n' "$APP_DIR"
