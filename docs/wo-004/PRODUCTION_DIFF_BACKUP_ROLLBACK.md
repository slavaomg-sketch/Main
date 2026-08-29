# WO-004 — точный production diff, backup и rollback

**Ничего из перечисленного здесь не выполнено.** Это подготовленный план для Owner Gate. Production writes на момент составления: 0.

Все команды предполагают root на `89.185.84.116`. Учётка `slava`, из которой велась инвентаризация, не имеет доступа ни к `/var/lib/project-control-center`, ни к `/etc/caddy` на запись — это правильно и менять не нужно.

## Этап 0 — предусловие

Разворачивать нечего, пока не закрыты находки **S1, S3, S4, D1, D2** из `CODE_SECURITY_REVIEW.md`. Diff ниже описывает *куда* ляжет исправленный код, а не разрешение развернуть текущий.

---

## 1. Backup — выполнить до любого изменения

### 1.1 Реестр PCC

```bash
sudo -u pcc env \
  PCC_DB=/var/lib/project-control-center/registry.sqlite3 \
  PCC_BACKUP_DIR=/var/backups/project-control-center \
  PYTHONPATH=/opt/project-control-center/current \
  /opt/project-control-center/current/.venv/bin/python -m pcc.cli backup
```

Штатный путь: `registry-<UTC>.sqlite3` + сайдкар `.sha256`, оба `0600`. `backup()` сам делает `verify()` копии и падает, если она не проходит. Отказывается писать поверх существующего файла — это by design, не подавлять.

Зафиксировать baseline и сверить с инвентаризацией:

```bash
curl -s http://127.0.0.1:8921/healthz | python3 -m json.tool | tee /root/wo004-baseline-healthz.json
```

Ожидаемый baseline на 2026-08-29:

```
audit_tail_hash: e32c5021aba1c9725bc08fe93c116e8ee7227147ce057a1a0d016bc0f718c657
projects 8, conversations 3, work_orders 1, owner_gates 1,
dependencies 2, routes 9, audit_events 35, import_runs 3
```

### 1.2 Caddy и systemd

```bash
cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-pcc-WO004-$(date -u +%Y%m%dT%H%M%SZ)
systemctl cat project-control-center.service > /root/wo004-baseline-pcc-unit.txt
sha256sum /etc/caddy/Caddyfile /root/wo004-baseline-pcc-unit.txt > /root/wo004-baseline.sha256
```

Конвенция имени бэкапа повторяет существующий `Caddyfile.pre-pcc-WO001-20260826T184546Z`.

---

## 2. Diff — что именно меняется

### 2.1 Ничего не меняется в существующем PCC

| Объект | Изменение |
| --- | --- |
| `/opt/project-control-center/**` | **нет** |
| `/var/lib/project-control-center/registry.sqlite3` (схема) | **нет** |
| `project-control-center.service` | **нет** |
| `project-control-center-backup.{service,timer}` | **нет** |
| порт 8921, basic_auth, owner-path | **нет** |
| существующий блок `# PCC_WO001_BEGIN/END` | **нет** |

Handoff-ingress получает **отдельный unit, отдельного пользователя, отдельный storage и отдельный порт**. В реестр PCC он не пишет напрямую — только через governed import, как любой другой источник.

### 2.2 Новые файлы

| Путь | Содержимое |
| --- | --- |
| `/opt/pcc-handoff/releases/0.1.0/` | исправленный пакет (после закрытия S1/S3/S4/D1/D2) |
| `/opt/pcc-handoff/current` | симлинк → `releases/0.1.0` |
| `/opt/pcc-handoff/current/.venv/` | отдельный venv, зависимости из `requirements.lock` |
| `/var/lib/pcc-handoff/` | `0700`, владелец `pcc-handoff` — БД и map projection |
| `/etc/pcc-handoff/token.env` | `0400 root:root`, только `PCC_SHADOW_TOKEN=` |
| `/etc/systemd/system/pcc-handoff.service` | `artifacts/pcc-handoff.service` |

Новая системная учётка:

```bash
useradd --system --no-create-home --home-dir /nonexistent \
        --shell /usr/sbin/nologin pcc-handoff
```

Зеркалит существующую `pcc` (uid 998, `/nonexistent`, `nologin`). Отдельная — чтобы ingress не мог читать реестр PCC; unit дополнительно закрывает его через `InaccessiblePaths=/var/lib/project-control-center /var/backups/project-control-center`.

### 2.3 Изменение `/etc/caddy/Caddyfile`

Единственная правка production-конфига. Вставка в site-блок `waac-mcp.dedyn.io`, после `# PCC_WO001_END` (сейчас строка 311) и перед финальным `handle { respond 404 }` (сейчас строка 313). Существующие строки не трогаются.

Точный блок — `artifacts/Caddyfile.wo004.block`. Перед reload обязательно:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

`caddy validate` есть в системе (v2.11.3), и это единственный шаг с риском для *других* сервисов в том же блоке — при синтаксической ошибке reload не применится, но проверять надо до, а не после.

### 2.4 Регистрация WO-004 в реестре

`artifacts/pcc-wo-004-registration-v1.json` — governed idempotent import.

Проверено: **валиден по `schemas/import-v1.schema.json`** (локальная копия схемы байт-в-байт совпадает с production, SHA-256 `2226379d…a2f17`). Пакет **не исполнялся** — ни против production, ни против копии.

Содержимое: новый `work_order:pcc:WO-004` (статус `owner_gate`), Work-беседа `conversation:pcc:work:wo-004`, Owner Gate `owner_gate:pcc:WO-004:production-activation`, и обязательный маршрут `route:pcc:WO-004:execute`.

Два ограничения реестра, из-за которых пакет выглядит именно так:

- `_routing_gaps` требует **ровно один активный route на каждый work_order**. Без него импорт откатится целиком с `ValidationError`. Поэтому route включён.
- `expected_version: 0` на каждой новой записи — оптимистичная блокировка: импорт упадёт с `ConflictError`, если запись уже существует. Это защита от повторного применения поверх изменившегося состояния.

Пакет **намеренно не трогает** `project:pcc`. Его текущие `next_step`, `current_priority` и активный маршрут прямо запрещают начинать следующий Work Order — переписывать это может только владелец, и это отдельный вход Owner Gate (см. `OWNER_GATE.md`).

**Dry-run перед применением** — обязателен, и делать его надо на восстановленной копии, а не на канонической БД:

```bash
# 1. восстановить свежий бэкап в изолированный путь
sudo -u pcc /opt/project-control-center/current/.venv/bin/python -m pcc.cli \
     restore /var/backups/project-control-center/registry-<UTC>.sqlite3 /tmp/wo004-dryrun.sqlite3
# 2. применить пакет к копии
sudo -u pcc /opt/project-control-center/current/.venv/bin/python -m pcc.cli \
     --db /tmp/wo004-dryrun.sqlite3 import /path/to/pcc-wo-004-registration-v1.json
# 3. проверить копию
sudo -u pcc /opt/project-control-center/current/.venv/bin/python -m pcc.cli \
     --db /tmp/wo004-dryrun.sqlite3 verify
# 4. только при ok=true — применить к канонической БД
```

`pcc.cli restore` по построению отказывается писать в каноническую БД, так что шаг 1 безопасен.

---

## 3. Порядок применения

1. Backup (§1), сверить `audit_tail_hash` с baseline.
2. Dry-run импорта на восстановленной копии, `verify` → `ok: true`.
3. `pcc.cli import` на каноническую БД, затем `verify` и `/healthz`.
4. Создать пользователя, каталоги, venv, разложить релиз.
5. Установить unit, `systemctl daemon-reload`, `start`, проверить `curl -s http://127.0.0.1:8765/health`.
6. Локальный smoke: MCP `initialize` + `submit_handoff` + read-back **с loopback Host**.
7. Правка Caddyfile → `caddy validate` → `systemctl reload caddy`.
8. Smoke через публичный путь: без токена → 401; с токеном → 200; проверить, что HTTP 421 **не** возникает (иначе D1 не закрыт).
9. Проверить, что PCC UI по-прежнему отвечает и `/healthz` = `ok`, `audit_tail_hash` изменился ровно на записи из импорта.

Между шагами 3 и 4 система находится в корректном состоянии: WO-004 зарегистрирован, ingress не развёрнут. Это допустимая точка остановки.

---

## 4. Rollback

Откат по шагам, в обратном порядке. Каждый шаг независим.

### 4.1 Откат Caddy

```bash
cp -a /etc/caddy/Caddyfile.pre-pcc-WO004-<STAMP> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Проверка: PCC UI по owner-path снова отвечает 401 без auth и 200 с auth; путь WO-004 отдаёт 404.

### 4.2 Откат сервиса

```bash
systemctl disable --now pcc-handoff.service
rm -f /etc/systemd/system/pcc-handoff.service
systemctl daemon-reload
```

Данные в `/var/lib/pcc-handoff/` **не удалять** до подтверждения отката — это append-only журнал и единственное свидетельство того, что произошло. Удалять отдельным решением.

### 4.3 Откат реестра

Здесь важно: `pcc.cli restore` **по построению не может** перезаписать каноническую БД. Восстановление канонического файла — офлайн-процедура:

```bash
systemctl stop project-control-center.service
# восстановить бэкап в изолированный путь и проверить его
sudo -u pcc /opt/project-control-center/current/.venv/bin/python -m pcc.cli \
     restore /var/backups/project-control-center/registry-<UTC>.sqlite3 /tmp/wo004-rollback.sqlite3
sudo -u pcc /opt/project-control-center/current/.venv/bin/python -m pcc.cli \
     --db /tmp/wo004-rollback.sqlite3 verify        # обязан вернуть ok: true
# отвести текущую БД в сторону, НЕ удалять
mv /var/lib/project-control-center/registry.sqlite3 \
   /var/lib/project-control-center/registry.sqlite3.pre-rollback-$(date -u +%Y%m%dT%H%M%SZ)
mv /var/lib/project-control-center/registry.sqlite3-wal \
   /var/lib/project-control-center/registry.sqlite3-wal.pre-rollback 2>/dev/null || true
mv /var/lib/project-control-center/registry.sqlite3-shm \
   /var/lib/project-control-center/registry.sqlite3-shm.pre-rollback 2>/dev/null || true
install -o pcc -g pcc -m 0600 /tmp/wo004-rollback.sqlite3 \
   /var/lib/project-control-center/registry.sqlite3
systemctl start project-control-center.service
```

**Критерий успешного отката:**

```bash
curl -s http://127.0.0.1:8921/healthz | python3 -m json.tool
```

должен вернуть `status: ok` и

```
audit_tail_hash: e32c5021aba1c9725bc08fe93c116e8ee7227147ce057a1a0d016bc0f718c657
projects 8, conversations 3, work_orders 1, owner_gates 1,
dependencies 2, routes 9, audit_events 35, import_runs 3
```

Хеш обязан совпасть **точно**. Несовпадение означает, что откатились не туда, — тогда останавливаться и разбираться, а не пробовать ещё раз.

Отдельно: WAL-файлы переносятся вместе с БД, иначе SQLite подмешает незакоммиченные страницы от новой базы к старой.

### 4.4 Откат без остановки сервиса — невозможен

`project-control-center.service` держит открытое соединение с БД. Подмена файла на живом сервисе даст расхождение WAL. Остановка на время отката обязательна; окно — секунды.

### 4.5 Что откатывать не нужно

Регистрация WO-004 в реестре сама по себе безвредна: это запись со статусом `owner_gate`, она ничего не запускает и не меняет поведение UI. Если ingress не взлетел, достаточно откатить §4.1 и §4.2 и оставить WO-004 зарегистрированным — реестр останется консистентным (`verify` → ok). Полный откат реестра (§4.3) нужен только если импорт сам оставил БД в нежелательном состоянии, чего `import_payload` не допускает: он атомарен и откатывает транзакцию целиком при любой ошибке.
