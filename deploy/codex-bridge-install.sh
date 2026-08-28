#!/usr/bin/env bash
#
# Мост между панелью и Codex CLI: установка и запуск.
#
# Запускать от обычного пользователя, под которым авторизован Codex
# (обычно `slava`). Права root НЕ нужны: доступ панели к каталогам
# выдаётся через ACL, а сам мост держится в живых заданием cron.
#
#   bash deploy/codex-bridge-install.sh
#
# Что делает:
#   1) создаёт почтовый ящик ~/wb-agent (очередь, ответы, рабочий каталог);
#   2) открывает доступ к нему пользователю панели;
#   3) кладёт сам мост в ~/wb-agent/codex-worker.py;
#   4) прописывает автозапуск после перезагрузки и проверку раз в минуту;
#   5) запускает мост прямо сейчас.

set -euo pipefail

AGENT_DIR="${WB_AGENT_DIR:-$HOME/wb-agent}"
APP_USER="${APP_USER:-mpdashboard}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/codex-worker.py"
WORKER="$AGENT_DIR/codex-worker.py"
KEEPER="$AGENT_DIR/keep-alive.sh"

say() { printf '  %s\n' "$1"; }

echo "Мост панель ↔ Codex CLI"

if ! command -v codex >/dev/null 2>&1; then
    echo "Codex CLI не найден. Установите его и повторите." >&2
    exit 1
fi
say "Codex найден: $(command -v codex), $(codex --version 2>/dev/null | head -1)"

mkdir -p "$AGENT_DIR/queue" "$AGENT_DIR/answers" "$AGENT_DIR/work"
say "почтовый ящик: $AGENT_DIR"

# Панель работает от другого пользователя — пускаем его в ящик точечно.
if id "$APP_USER" >/dev/null 2>&1; then
    setfacl -R -m "u:$APP_USER:rwx" "$AGENT_DIR"
    setfacl -d -m "u:$APP_USER:rwx" "$AGENT_DIR/queue" "$AGENT_DIR/answers"
    say "доступ выдан пользователю $APP_USER"
else
    say "пользователь $APP_USER не найден — доступ не выдан"
fi

install -m 0755 "$SOURCE" "$WORKER"
say "мост установлен: $WORKER"

# Сторож: если моста нет в списке процессов — поднять. Дёшево и надёжнее,
# чем systemd-служба, для которой понадобился бы root.
cat > "$KEEPER" <<KEEPEOF
#!/usr/bin/env bash
# Поднимает мост к Codex, если тот не работает. Вызывается из cron.
pgrep -f "codex-worker.py" >/dev/null 2>&1 && exit 0
cd "$AGENT_DIR"
nohup python3 "$WORKER" >>"$AGENT_DIR/worker.out" 2>&1 &
KEEPEOF
chmod 0755 "$KEEPER"

# Задания cron ставим без дублей: старые строки про мост убираем.
current="$(crontab -l 2>/dev/null | grep -v 'wb-agent/keep-alive.sh' || true)"
{
    [ -n "$current" ] && printf '%s\n' "$current"
    printf '@reboot %s\n' "$KEEPER"
    printf '* * * * * %s\n' "$KEEPER"
} | crontab -
say "автозапуск прописан (после перезагрузки и проверка раз в минуту)"

"$KEEPER"
sleep 2
if pgrep -f "codex-worker.py" >/dev/null 2>&1; then
    say "мост запущен"
else
    echo "Мост не поднялся. Смотрите $AGENT_DIR/worker.out" >&2
    exit 1
fi

echo
echo "Готово. Панель кладёт задания в $AGENT_DIR/queue,"
echo "мост отвечает в $AGENT_DIR/answers, журнал — $AGENT_DIR/worker.log"
