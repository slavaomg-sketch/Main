# WO-004 — read-only инвентаризация production PCC

Дата: 2026-08-29 UTC. Доступ: WAAC control-plane connector, учётка `slava`.
**Production writes: 0.** Выполнялись только чтение файлов, `systemctl cat`/`show`, `sha256sum -c` и GET на loopback-порт.

## 1. Хост

| | |
| --- | --- |
| Хост | `193384.ip-ptr.tech`, Ubuntu 22.04.5 LTS, kernel 5.15.0-190, KVM |
| Публичный IP | `89.185.84.116` |
| Системный Python | **3.10.12** (`/usr/bin/python3.10`); 3.11/3.12 отсутствуют |
| Диск `/` | 138G, занято 112G, свободно 20G (86%) |

Расхождение с `docs/INVENTORY.md` пакета: там зафиксирована неудачная попытка соединения с `46.17.108.201:2222`. Production PCC работает **не там** — он на этом хосте. Прежняя запись «Network is unreachable» описывала другой адрес.

## 2. Код

```
/opt/project-control-center/current -> releases/1.0.0     (владелец root:root)
├── pcc/{__init__,web,store,cli}.py, pcc/schema.sql, pcc/static/{index.html,app.js,styles.css}
├── deploy/{project-control-center.service,-backup.service,-backup.timer,Caddyfile.route.template}
├── schemas/import-v1.schema.json      seed/bootstrap-v1.json
├── updates/wo-001-closeout-v1.json    release/SHA256SUMS
├── scripts/{build_manifest,manage_caddy_route,run_acceptance}.py
├── tests/{test_registry,test_web,test_caddy_route}.py
└── .venv/  (Python 3.10.12)
```

`store.py` — 1345 строк, `web.py` — 141, `cli.py` — 131. Git-репозитория на VPS нет (`fatal: not a git repository`); версионирование — через каталог `releases/` и симлинк `current`.

**Целостность релиза проверена:** `sha256sum -c release/SHA256SUMS` — 28 файлов, все OK, расхождений с манифестом нет.

Runtime-зависимости production (`requirements.lock`): `click==8.4.2`, `h11==0.16.0`, `typing-extensions==4.16.0`, `uvicorn==0.49.0`. **Ни pydantic, ни mcp, ни starlette, ни anyio.** `web.py` — чистое ASGI-приложение без фреймворка.

## 3. Registry / storage

Канонический путь: `/var/lib/project-control-center/registry.sqlite3`.

Каталог **недоступен на чтение** учётке `slava` (`Permission denied`) — как и `/var/backups/project-control-center/`. Это корректно: сервис изолирован под системной учёткой `pcc` (uid 998, `/nonexistent`, `/usr/sbin/nologin`), а unit ставит `UMask=0077`. Состояние читалось только через loopback-API самого сервиса.

Схема v1 (`pcc/schema.sql`), таблицы: `schema_meta`, `entities`, `projects`, `conversations`, `work_orders`, `owner_gates`, `dependencies`, `routes`, `audit_events`, `import_runs`.

Механизмы, которые надо считать эталоном для WO-004:

- `pcc_write_authorized()` — SQLite-функция, регистрируемая только на `GuardedConnection`; каждая доменная таблица имеет `BEFORE INSERT/UPDATE` триггер `WHEN pcc_write_authorized() <> 1 ... RAISE(ABORT)`. Сырое соединение писать не может.
- `audit_events` — append-only через `RAISE(ABORT)`-триггеры, с SHA-256 цепочкой `prev_hash` → `event_hash`.
- `import_runs` — `idempotency_key` PK + `payload_sha256`; тот же ключ с другим содержимым → `ConflictError`.
- Оптимистичная блокировка через `expected_version` (`expected_version: 0` = «записи ещё нет»).
- Инвариант маршрутизации: `_routing_gaps` требует **ровно один активный route на каждый project и на каждый work_order**; импорт без него откатывается целиком.
- `uq_work_orders_active_project` — не более одного WO в статусе `active` на проект.

## 4. Состояние реестра (baseline для отката)

`GET http://127.0.0.1:8921/healthz`:

```
status: ok        schema_version: 1     integrity_check: ok
audit_chain_ok: true      state_audit_consistent: true
routing_complete: true    routing_consistent: true
audit_tail_hash: e32c5021aba1c9725bc08fe93c116e8ee7227147ce057a1a0d016bc0f718c657
counts: projects 8, conversations 3, work_orders 1, owner_gates 1,
        dependencies 2, routes 9, audit_events 35, import_runs 3
```

`audit_tail_hash` выше — точный baseline: после отката он обязан совпасть.

Выполненные импорты: `pcc-bootstrap-v1-20260826`, `pcc-wo-001-closeout-v1-20260826`, `pcc-wo-001-formal-rejection-v1-20260826`.

## 5. Канонические ID

### Проект

| | |
| --- | --- |
| `project_id` | **`PCC`** |
| `stable_key` | **`project:pcc`** |
| `name` | `PROJECT CONTROL CENTER` |
| `status` | `active`, `version` **3** |

Остальные 7 проектов реестра: `CF-CARD-CONTROL-AGENT`, `LIFEOS`, `SELLER-DISPLAY`, `WAAC-INTERNATIONAL`, `WB-OZON-DOCS`, `ZAKAZATOR`, `WAREHOUSE` — все в статусе `unknown`, Work Orders у них нет.

### Work Orders проекта PCC

**В реестре зарегистрирован ровно один Work Order.**

| stable_key | number | status | version |
| --- | --- | --- | --- |
| `work_order:pcc:WO-001` | `WO-001` | **`rejected`** | 3 |

### Conversations проекта PCC

| stable_key | тип | статус |
| --- | --- | --- |
| `conversation:pcc:hq` | HQ | active — «00 — Штаб Project Control Center» |
| `conversation:pcc:work:wo-001` | Work | blocked |
| `conversation:pcc:registry-planning` | Chat | completed |

### Активные маршруты PCC

`route:pcc:project:execute` (target `project:pcc`, v3) и `route:pcc:WO-001:execute` (target `work_order:pcc:WO-001`, v3).

## 6. Канонический ID WO-004 — его не существует

Поиск по полному детерминированному экспорту реестра:

```
WO-001: 227 вхождений
WO-002:   6 вхождений (только внутри текста prompt)
WO-003:   0
WO-004:   0
MCP:      0
```

**WO-004 отсутствует в production-реестре полностью.** У него нет канонического `stable_key`, `number`, статуса, маршрута и Work-беседы. Идентификаторы `shadow.project-control-center` / `shadow.wo-004-run-a` / `shadow.wo-004-run-b` из `config/shadow_registry.json` — целиком синтетические и в production не существуют.

Более того, единственный активный маршрут проекта прямо запрещает создание следующего Work Order. Дословно из `route:pcc:project:execute`:

> Review the formal rejection of WO-001 … and prepare one governed remediation handoff for the existing WO-001 only. **Do not start WO-002 or any other next Work Order.**

Текущее состояние проекта:

- `current_priority`: «WO-001 formal rejection — correction required before re-acceptance»
- `owner_gate_summary`: «Formal acceptance gate rejected: criterion 18 failed in owner browser QA»
- `next_step`: «In HQ, prepare the governed remediation handoff for the existing WO-001; do not start a next Work Order»
- `next_step_place`: `HQ`

Это ключевой вход Owner Gate и разобрано в `OWNER_GATE.md`.

## 7. systemd

`project-control-center.service` — active running, `NRestarts=0`, запущен 2026-08-26 22:42 MSK.

```
User/Group        pcc/pcc
WorkingDirectory  /opt/project-control-center/current
ExecStart         .venv/bin/python -m uvicorn pcc.web:app --host 127.0.0.1 --port 8921
                  --workers 1 --no-access-log --proxy-headers --forwarded-allow-ips=127.0.0.1
Hardening         UMask=0077  NoNewPrivileges  PrivateTmp  PrivateDevices
                  ProtectSystem=strict  ProtectHome  InaccessiblePaths=/home /root
                  ReadOnlyPaths=/var/lib/project-control-center
                  ProtectKernelTunables/Modules/ControlGroups  LockPersonality
                  MemoryDenyWriteExecute  RestrictSUIDSGID
                  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
                  CapabilityBoundingSet=  AmbientCapabilities=
```

Обратить внимание: **`ReadOnlyPaths` на каталог БД** — сам UI физически не может писать в реестр; `--workers 1`; `--no-access-log`. Всё три — образец для unit-файла WO-004.

`project-control-center-backup.service` (oneshot) + `.timer`: `OnCalendar=*-*-* 03:35:00 Europe/Moscow`, `Persistent=true`, последний запуск успешен (`Result=success`), следующий — 2026-08-30 03:38 MSK. Отличие от основного unit: `ReadWritePaths=/var/lib/project-control-center /var/backups/project-control-center`.

## 8. Caddy

Caddy v2.11.3, `User=caddy`, конфиг `/etc/caddy/Caddyfile` (415 строк, `root:root 0644`).

Маршрут PCC — строки **304–311**, внутри site-блока `waac-mcp.dedyn.io {` (строка 1), непосредственно перед финальным `handle { respond 404 }` на строке 313:

```
	# PCC_WO001_BEGIN
	handle_path /<OWNER_PATH>/* {
		basic_auth {
			pcc-owner $2a$<BCRYPT>
		}
		reverse_proxy 127.0.0.1:8921
	}
	# PCC_WO001_END
```

Секретный owner-path и bcrypt-хеш прочитаны, но намеренно не выписаны сюда. Пользователь basic_auth — `pcc-owner`. Порт 8921 наружу не открыт (`ss` показывает `LISTEN 127.0.0.1:8921`).

Конвенция маркеров `# PCC_WO001_BEGIN/END` — готовый шаблон для блока WO-004.

Резервных копий Caddyfile в `/etc/caddy/` — 84 файла, включая `Caddyfile.pre-pcc-WO001-20260826T184546Z`. Конвенция бэкапа перед правкой соблюдается.

## 9. Порты и свободные ресурсы

`8765` и `8766` **свободны** — конфликта с shadow-портом по умолчанию нет.

## 10. Что подтвердилось и что опровергнуто из `docs/INVENTORY.md` пакета

| Утверждение пакета | Результат |
| --- | --- |
| PCC 1.0.0, read-only UI | подтверждено |
| отдельный сервис `project-control-center` | подтверждено, unit-файл и live status получены |
| production за Caddy с входной защитой | подтверждено; basic_auth, не 401-Bearer |
| каталог кода на VPS не подтверждён | закрыто: `/opt/project-control-center/current` |
| путь registry не подтверждён | закрыто: `/var/lib/project-control-center/registry.sqlite3` |
| схема storage и append-only не подтверждены | закрыто: `pcc/schema.sql`, триггеры + хеш-цепочка |
| systemd unit, Caddy config, runtime user | закрыто: см. §7, §8; runtime user `pcc` |
| канонические `source_project`/`source_work` | частично: проект `PCC`/`project:pcc` есть; **WO-004 не существует** |
| backup/restore не подтверждены | закрыто: `pccctl backup`/`restore`, таймер, verify |
| SSH к `46.17.108.201:2222` недоступен | не относится к делу — PCC на `89.185.84.116` |
