#!/usr/bin/env bash
#
# Установка конвейера без sudo: от текущего пользователя, через user-systemd.
# Подходит, когда claude и codex уже установлены и вход в них выполнен под этим пользователем.
#
#   bash deploy/install-pipeline-user.sh
#
# Переменные:
#   APP_DIR=$HOME/cards-pipeline   куда ставить (.env, .venv, repo/)
#   REPO_URL=https://github.com/slavaomg-sketch/Main.git
#   BRANCH=main
#
# Повторный запуск обновляет код и зависимости, .env не трогает.

set -euo pipefail

APP_NAME="cards-pipeline"
APP_DIR="${APP_DIR:-$HOME/cards-pipeline}"
REPO_URL="${REPO_URL:-https://github.com/slavaomg-sketch/Main.git}"
BRANCH="${BRANCH:-main}"

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sОшибка:%s %s\n\n' "$RED" "$OFF" "$1" >&2; exit 1; }

for c in git python3 claude codex; do command -v "$c" >/dev/null || die "не найден $c"; done

step "Код в $APP_DIR/repo ($BRANCH)"
mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/repo/.git" ]]; then
    git -C "$APP_DIR/repo" fetch --quiet origin "$BRANCH"
    git -C "$APP_DIR/repo" checkout --quiet "$BRANCH"
    git -C "$APP_DIR/repo" pull --quiet --rebase origin "$BRANCH" || warn "pull не удался, продолжаю со старым кодом"
    ok "обновлён: $(git -C "$APP_DIR/repo" log --oneline -1)"
else
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR/repo"
    ok "склонирован"
fi
git -C "$APP_DIR/repo" config user.name "$APP_NAME"
git -C "$APP_DIR/repo" config user.email "$APP_NAME@$(hostname -s)"

step "Виртуальное окружение"
[[ -x "$APP_DIR/.venv/bin/python" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/repo/requirements-pipeline.txt"
ok "зависимости установлены"

step "Настройки $APP_DIR/.env"
if [[ ! -f "$APP_DIR/.env" ]]; then
    cat > "$APP_DIR/.env" <<ENV
# Конвейер карточек. Полный список настроек — в .env.example репозитория.
PIPELINE_BRANCH=$BRANCH
PIPELINE_POLL_SECONDS=300
IMAGE_TEXT_MODE=both
SLIDES_PER_CARD=3
MAX_IDEAS_PER_RUN=0
MAX_IMAGES_PER_DAY=0
CLAUDE_MODEL=
CODEX_EXTRA_ARGS="--full-auto --skip-git-repo-check"
# Telegram для уведомлений (пусто — без уведомлений)
BOT_TOKEN=
ADMIN_IDS=
PIPELINE_NOTIFY=1
PIPELINE_PUSH=1
ENV
    chmod 600 "$APP_DIR/.env"
    ok "создан — впишите BOT_TOKEN и ADMIN_IDS для уведомлений"
else
    ok "уже есть — не трогаю"
fi

step "Доступ к GitHub для push"
if git -C "$APP_DIR/repo" remote get-url --push origin | grep -q '^git@'; then
    ok "push через SSH уже настроен"
elif [[ -f "$HOME/.git-credentials" ]] && grep -q github.com "$HOME/.git-credentials"; then
    ok "есть сохранённые учётные данные GitHub"
else
    KEY="$HOME/.ssh/$APP_NAME"
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    [[ -f "$KEY" ]] || ssh-keygen -q -t ed25519 -f "$KEY" -N "" -C "$APP_NAME@$(hostname -s)"
    if ! grep -q "Host github-$APP_NAME" "$HOME/.ssh/config" 2>/dev/null; then
        printf '\nHost github-%s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$APP_NAME" "$KEY" >> "$HOME/.ssh/config"
        chmod 600 "$HOME/.ssh/config"
    fi
    REPO_PATH="$(printf '%s' "$REPO_URL" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"
    git -C "$APP_DIR/repo" remote set-url --push origin "git@github-$APP_NAME:$REPO_PATH.git"
    warn "добавьте deploy key с правом записи: https://github.com/$REPO_PATH/settings/keys/new"
    printf '\n%s\n\n' "$(cat "$KEY.pub")"
fi

step "Сервис user-systemd"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
mkdir -p "$HOME/.config/systemd/user"
sed -e "s|__APP_DIR__|$APP_DIR|g" "$APP_DIR/repo/deploy/$APP_NAME.user.service" > "$HOME/.config/systemd/user/$APP_NAME.service"
systemctl --user daemon-reload
systemctl --user enable --quiet "$APP_NAME.service"
systemctl --user restart "$APP_NAME.service"
sleep 3
if systemctl --user is-active --quiet "$APP_NAME.service"; then
    ok "конвейер запущен"
else
    warn "не поднялся: journalctl --user -u $APP_NAME -n 50"
fi
if [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]]; then
    warn "linger выключен: сервис остановится при выходе из системы. Включить: sudo loginctl enable-linger $(id -un)"
fi

printf '\n%s────────────────────────────────────────────%s\n' "$BOLD" "$OFF"
printf ' Команды:\n'
printf '   systemctl --user status %s\n' "$APP_NAME"
printf '   journalctl --user -u %s -f\n' "$APP_NAME"
printf '   systemctl --user restart %s\n' "$APP_NAME"
printf '   bash %s/repo/deploy/install-pipeline-user.sh   обновить зависимости\n\n' "$APP_DIR"
