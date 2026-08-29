# WO-004 — OWNER GATE

**STOP. Никаких изменений в production до явного решения владельца.**

Дата: 2026-08-29 UTC. Production writes: **0**.

Выполнено в этом Work: независимое code/security review shadow-пакета и read-only инвентаризация production PCC. Оба блокера, которыми закончился предыдущий круг WO-004, закрыты — и оба вскрыли новые.

---

## 1. Решение, которое требуется первым

### Вопрос A — имеет ли WO-004 право существовать прямо сейчас

Инвентаризация дала однозначный ответ на «какие канонические IDs у WO-004»: **их нет.**

- В production-реестре зарегистрирован **ровно один** Work Order: `work_order:pcc:WO-001`, статус **`rejected`**, version 3.
- Строка `WO-004` не встречается в полном экспорте реестра **ни разу**. `WO-003` — тоже. `WO-002` встречается только внутри текста запрета.
- Единственный активный маршрут проекта `route:pcc:project:execute` говорит дословно:

  > Review the formal rejection of WO-001 … and prepare one governed remediation handoff for the existing WO-001 only. **Do not start WO-002 or any other next Work Order.**

- `project:pcc.next_step`: «In HQ, prepare the governed remediation handoff for the existing WO-001; do not start a next Work Order.»
- `project:pcc.current_priority`: «WO-001 formal rejection — correction required before re-acceptance».
- `owner_gate_summary`: «Formal acceptance gate rejected: criterion 18 failed in owner browser QA».

То есть канонический реестр — источник истины проекта — сейчас утверждает, что WO-004 вестись не должен. Идентификаторы `shadow.project-control-center` / `shadow.wo-004-run-a` / `shadow.wo-004-run-b` синтетические; в production они не соответствуют ничему.

**Владельцу нужно выбрать один из трёх вариантов:**

| | Вариант | Что происходит |
| --- | --- | --- |
| **A1** | Сначала закрыть WO-001 | WO-004 не регистрируется и не ведётся. Работа этого круга остаётся артефактом. Реестр остаётся согласован сам с собой. |
| **A2** | Зарегистрировать WO-004 в статусе `owner_gate`, работу не вести | Применить `artifacts/pcc-wo-004-registration-v1.json`. WO-004 получает канонический `work_order:pcc:WO-004`, но остаётся на гейте. Запрет из маршрута проекта не нарушается: ничего не *стартует*. |
| **A3** | Разрешить WO-004 как активный | Требует отдельно переписать `next_step` и активный маршрут `project:pcc` — то есть явно отменить собственный запрет. Пакет регистрации это **намеренно не делает**. |

Рекомендация: **A2**. Она делает WO-004 видимым и прослеживаемым в реестре, не отменяя решения по WO-001 и не запуская никакой работы. A3 — только осознанно и отдельной формулировкой.

---

## 2. Что нашло независимое review

Полностью — в `CODE_SECURITY_REVIEW.md`. Заявленные автором пакета проверки воспроизведены и подтверждены: 16/16 тестов PASS, e2e PASS, неавторизованная запись в `/mcp` → 401. Ошибок в тестах нет. Но тесты не покрывают ни одну из находок ниже.

### Блокирующие — до любой публикации endpoint

| ID | Находка | Доказательство |
| --- | --- | --- |
| **S1 CRITICAL** | `/api/project-state/{project}` отдаёт **всё** содержимое handoff без аутентификации. Middleware защищает только пути с префиксом `/mcp`. | HTTP 200, четыре канарейки (`result`, `blocker`, `owner_gate`, `next_step`) в теле без единого заголовка авторизации |
| **S3 HIGH** | «Append-only» — соглашение в коде, а не свойство хранилища. Триггеров в БД: 0. | обычным `sqlite3`: `UPDATE handoff_events` → выполнен; `DELETE FROM delivery_attempts` → выполнен |
| **S4 HIGH** | Контракт запрещает лишние *поля*, но не секретные *значения*. | payload с `sk-proj-…`, `Bearer eyJ…` и `https://chatgpt.com/c/…` принят и сохранён дословно |
| **D1 BLOCKER** | За Caddy endpoint отклонит **все** запросы. `transport_security` не задан, `allowed_hosts` выводится из bind-адреса. | с валидным токеном: `Host: 127.0.0.1` → 200; `Host: waac-mcp.dedyn.io` → **421 Invalid Host header** |
| **D2 BLOCKER** | Пакет требует Python ≥3.12; на VPS только 3.10.12, 3.11/3.12 отсутствуют. | `/usr/bin/python3.10`, `python3 -V` → 3.10.12 |

### Остальные

**S2 HIGH** — один статический токен даёт чтение и запись всех проектов, без scope и без attribution: в `handoff_events` нет колонки actor. **S5** — receipt рапортует `durable=true, read_back_verified=true` при `projection_status=PENDING_RETRY`, и это ровно тот критерий подтверждения, который сервер диктует модели. **S6** — повторы бесконечны, без backoff и dead-letter; 12 отказов дали 12 строк `FAILED` и ноль сигналов наружу. **S7** — запись map-проекции сериализована только внутри процесса. **S8** — нет версионирования схемы: код v1 молча прочитает БД v2. **S9/S10** — fault-injection в production-модуле; сырой текст исключения в append-only таблице.

**Что держится и ломать не надо:** обхода auth на `/mcp` не найдено (`//mcp`, `/MCP`, `/mcp/../api/...` — 401/404); сравнение токена constant-time; `insert_event` корректно защищён `BEGIN IMMEDIATE`; stale-сравнение строк корректно из-за канонического формата времени; тело ограничено 4 MiB; `synchronous=FULL`; Origin-защита работает (403 на чужой Origin).

### Вопрос B — authentication boundary

Текущий bearer-middleware — shadow-защита. Для публично доступного remote MCP нужен утверждённый OAuth-контур либо подтверждённый Secure MCP Tunnel. Это отдельное решение владельца, и без него S1/S2 закрыть нечем.

### Вопрос C — Python runtime

Снизить `requires-python` до `>=3.10` и прогнать полный набор проверок на 3.10 (`mcp==2.1.1` это поддерживает), либо ставить на VPS отдельный интерпретатор 3.12. Второе добавляет новый источник пакетов и требует отдельного обоснования. Рекомендация — первое.

---

## 3. Что уже подготовлено и проверено

| Артефакт | Статус |
| --- | --- |
| `artifacts/pcc-wo-004-registration-v1.json` | **валиден** по production `import-v1.schema.json` (копия схемы байт-в-байт, SHA-256 `2226379d…a2f17`). Не исполнялся. |
| `artifacts/pcc-handoff.service` | подготовлен, зеркалит hardening существующего PCC-unit. Не установлен. |
| `artifacts/Caddyfile.wo004.block` | подготовлен по конвенции маркеров `# PCC_WO001_BEGIN/END`. Не применён. |
| `PRODUCTION_DIFF_BACKUP_ROLLBACK.md` | точный diff, backup, порядок применения и проверяемый rollback. Не выполнялся. |
| `PRODUCTION_INVENTORY.md` | закрывает все семь пунктов «не удалось подтвердить» из прежнего `docs/INVENTORY.md`. |

Baseline для проверки отката зафиксирован:

```
audit_tail_hash: e32c5021aba1c9725bc08fe93c116e8ee7227147ce057a1a0d016bc0f718c657
projects 8, conversations 3, work_orders 1, owner_gates 1,
dependencies 2, routes 9, audit_events 35, import_runs 3
```

Точка остановки в плане применения предусмотрена между регистрацией WO-004 и развёртыванием ingress — состояние там корректное и самодостаточное.

---

## 4. Что запрещено до одобрения

- разворачивать handoff ingress и публиковать MCP endpoint;
- править `/etc/caddy/Caddyfile`, systemd, реестр и карту;
- применять `pcc-wo-004-registration-v1.json` к канонической БД;
- копировать shadow-registry в production или подменять production IDs shadow-идентификаторами;
- создавать и подключать draft app в ChatGPT Developer mode;
- считать локальный MCP-тест реальным PASS маршрута Work → ChatGPT → PCC.

---

## 5. Решения, которые нужны от владельца

1. **A** — A1, A2 или A3 (см. §1). Без этого остальное не имеет смысла.
2. **B** — authentication boundary для публичного endpoint.
3. **C** — Python runtime: снизить требование до 3.10 или ставить 3.12.
4. Подтвердить, что **S1, S3, S4** должны быть исправлены в коде до развёртывания, а не приняты как риск.

## 6. Один следующий шаг

Ответить на вопрос A в «00 — Штаб Project Control Center». До этого ответа новый функциональный Work Order не начинать и production не трогать.
