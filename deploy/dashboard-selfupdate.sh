#!/usr/bin/env bash
#
# Обновление панели из репозитория. Запускается systemd от root по сигналу:
# как только в каталоге очереди появляется файл `request`, служба
# marketplace-dashboard-update.path запускает этот скрипт.
#
# Смысл разделения: файл-сигнал может создать обычный пользователь, а сам
# скрипт лежит в /usr/local/sbin и обновлением кода НЕ перезаписывается.
# Поэтому изменить привилегированную часть, отправив коммит, невозможно —
# выкладываемый код работает от непривилегированного mpdashboard.
#
# Перед выкладкой прогоняются тесты, старая версия сохраняется, а если
# после перезапуска панель не отвечает — откат к предыдущей версии.

set -euo pipefail

SRC="${SRC:-/home/slava/dashboard-src}"
APP="${APP:-/opt/marketplace-dashboard}"
APP_USER="${APP_USER:-mpdashboard}"
SRC_USER="${SRC_USER:-slava}"
BRANCH="${BRANCH:-claude/marketplace-unified-dashboard-anbqou}"
QUEUE="${QUEUE:-/home/slava/dashboard-deploy}"
BACKUP="${BACKUP:-/var/backups/marketplace-dashboard}"
SERVICE="marketplace-dashboard"
PORT="$(grep -E '^DASHBOARD_PORT=' "$APP/.env" 2>/dev/null | cut -d= -f2 || echo 8080)"

LOG="$QUEUE/last-update.log"

mkdir -p "$QUEUE" "$BACKUP"
: > "$LOG"

# systemd запускает службы с рабочим каталогом «/». Без перехода в каталог
# исходников pytest начал бы собирать тесты по всей файловой системе.
cd "$SRC"

say() {
    printf '%s %s\n' "$(date '+%H:%M:%S')" "$1" | tee -a "$LOG"
}

finish() {
    chown "$SRC_USER":"$SRC_USER" "$LOG" 2>/dev/null || true
    chmod 644 "$LOG" 2>/dev/null || true
}
trap finish EXIT

# Сигнал убираем сразу: иначе systemd не сможет поймать следующий.
rm -f "$QUEUE/request"

say "=== обновление начато ==="

# ------------------------------------------------------------------ свежий код

say "забираю код ветки $BRANCH"
sudo -u "$SRC_USER" git -C "$SRC" fetch --quiet origin "$BRANCH"
sudo -u "$SRC_USER" git -C "$SRC" reset --hard --quiet "origin/$BRANCH"
COMMIT="$(sudo -u "$SRC_USER" git -C "$SRC" log --oneline -1)"
say "коммит: $COMMIT"

# --------------------------------------------------------------------- проверка

say "ставлю зависимости в окружении исходников"
sudo -u "$SRC_USER" "$SRC/.venv/bin/pip" install -q -r "$SRC/requirements.txt"

say "прогоняю тесты"
# Каталог тестов и корень проекта задаём явно — на случай, если скрипт
# когда-нибудь запустят из другого места.
if ! sudo -u "$SRC_USER" env DASHBOARD_DB_PATH=/tmp/dashboard-selfupdate.db \
        "$SRC/.venv/bin/python" -m pytest -q \
        --rootdir "$SRC" -c "$SRC/pytest.ini" "$SRC/tests" >>"$LOG" 2>&1; then
    say "ТЕСТЫ НЕ ПРОШЛИ — выкладка отменена, панель работает на прежней версии"
    rm -f /tmp/dashboard-selfupdate.db
    exit 1
fi
rm -f /tmp/dashboard-selfupdate.db
say "тесты прошли"

# ------------------------------------------------------------ копия предыдущей

say "сохраняю предыдущую версию"
rsync -a --delete "$APP/dashboard/" "$BACKUP/dashboard/"
rsync -a --delete "$APP/web/" "$BACKUP/web/"

# ----------------------------------------------------------------- сама выкладка

say "копирую код в $APP"
rsync -a --delete \
    --exclude '.git/' --exclude '.venv/' --exclude 'data/' --exclude 'backups/' \
    --exclude '.env' --exclude '__pycache__/' --exclude '.pytest_cache/' \
    "$SRC"/ "$APP"/

"$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
chown -R "$APP_USER":"$APP_USER" "$APP"
chmod 600 "$APP/.env" 2>/dev/null || true

say "перезапускаю службу"
systemctl restart "$SERVICE"

# -------------------------------------------------------------------- проверка

sleep 4
for attempt in 1 2 3 4 5; do
    if curl -sf --max-time 5 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
        say "панель отвечает — обновление завершено"
        say "=== готово ==="
        exit 0
    fi
    sleep 3
done

# ----------------------------------------------------------------------- откат

say "ПАНЕЛЬ НЕ ПОДНЯЛАСЬ — откатываю на предыдущую версию"
rsync -a --delete "$BACKUP/dashboard/" "$APP/dashboard/"
rsync -a --delete "$BACKUP/web/" "$APP/web/"
chown -R "$APP_USER":"$APP_USER" "$APP"
systemctl restart "$SERVICE"
sleep 4

if curl -sf --max-time 5 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    say "откат удался, работает прежняя версия"
else
    say "откат не помог — смотрите journalctl -u $SERVICE -n 50"
fi
say "=== обновление не удалось ==="
exit 1
