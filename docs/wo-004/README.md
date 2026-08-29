# WO-004 — structured handoff ingress: review, inventory, Owner Gate

Продолжение WO-004 из внешнего Claude Code-контура. Здесь два входа, которых не хватало предыдущему кругу: независимое code/security review и read-only доступ к production VPS.

**Статус: OWNER GATE, STOP. Production writes: 0.**

| Документ | Что внутри |
| --- | --- |
| [`OWNER_GATE.md`](OWNER_GATE.md) | **начинать отсюда** — решения, которые нужны от владельца |
| [`CODE_SECURITY_REVIEW.md`](CODE_SECURITY_REVIEW.md) | независимое ревью `PCC_WO004_shadow_package.zip`: 1 critical, 3 high, 2 блокера развёртывания, все с воспроизведёнными пробами |
| [`PRODUCTION_INVENTORY.md`](PRODUCTION_INVENTORY.md) | код, registry, storage, systemd, Caddy, канонические IDs |
| [`PRODUCTION_DIFF_BACKUP_ROLLBACK.md`](PRODUCTION_DIFF_BACKUP_ROLLBACK.md) | точный diff, backup, порядок применения, проверяемый rollback |
| `artifacts/pcc-wo-004-registration-v1.json` | governed import-пакет; валиден по production-схеме, **не исполнялся** |
| `artifacts/pcc-handoff.service` | предлагаемый systemd unit, **не установлен** |
| `artifacts/Caddyfile.wo004.block` | предлагаемый блок Caddy, **не применён** |

## Главное в двух строках

1. **WO-004 не существует в production-реестре**, а его единственный активный маршрут прямо запрещает начинать следующий Work Order, пока не закрыт отклонённый WO-001.
2. Shadow-пакет работает ровно так, как заявлено, но **отдаёт всё содержимое handoff без аутентификации** и в текущей конфигурации **не примет ни одного запроса из-за Caddy** (HTTP 421).

Сам shadow-пакет в этот репозиторий не копировался: он остаётся изолированным и не подключённым к production.
