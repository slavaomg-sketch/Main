# Развёртывание

## Требования

Ubuntu 22.04/24.04 VPS (2 vCPU, 4 ГБ RAM, 20 ГБ диска), Docker 24+ с Compose v2, домен с DNS-записью, доступ по SSH.

## Быстрый старт на VPS (Docker Compose)

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER" && newgrp docker
git clone <репозиторий> techmatch && cd techmatch
cp .env.example .env
# Обязательно смените: SESSION_SECRET, CART_COOKIE_SECRET, PAYMENT_WEBHOOK_SECRET, POSTGRES_PASSWORD,
# APP_URL=https://ваш-домен, NODE_ENV=production. Ключи провайдеров — при подключении.
openssl rand -hex 32   # для каждого секрета
SEED_ON_START=1 docker compose up -d --build   # первый запуск с демо-данными; дальше без SEED_ON_START
docker compose logs -f web
```

Сервисы: `postgres`, `redis`, `migrate` (применяет миграции и, при `SEED_ON_START=1`, seed), `web` (порт 3000), `worker`. Медиа и файлы импорта — в volume `storage`.

Healthcheck: `GET /api/health` → `{"status":"ok","db":"ok","providers":{...}}`. Docker перезапускает `web` при неуспехе.

## Обратный прокси и TLS

Перед `web` поставьте nginx или Caddy. Caddy (авто-TLS):

```
shop.example.com {
  reverse_proxy 127.0.0.1:3000
  encode zstd gzip
}
```

Nginx: `proxy_pass http://127.0.0.1:3000;` + `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (нужен для rate limiting и проверки IP webhook), `client_max_body_size 25m` (импорт файлов). Раздачу `/media/` можно отдать nginx напрямую из volume `storage/media` (`alias`), чтобы разгрузить Node.

## Обновление

```bash
git pull && docker compose build && docker compose up -d   # migrate выполнится автоматически
```

Миграции применяются `prisma migrate deploy` до старта web (сервис `migrate`). Откат — восстановление из бэкапа.

## Резервное копирование

`deploy/backup.sh` — дамп PostgreSQL (`pg_dump -Fc`) и архив volume `storage`, ротация по `KEEP_DAYS`. Cron: `0 3 * * * cd /opt/techmatch && BACKUP_DIR=/var/backups/techmatch bash deploy/backup.sh >> /var/log/techmatch-backup.log 2>&1`. Восстановление — `deploy/restore.sh db-XXXX.dump storage-XXXX.tgz`.

## Переменные окружения

См. `.env.example` (комментарии к каждой). Ключевые:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | подключения (в compose подставляются автоматически) |
| `QUEUE_DRIVER` | `bullmq` (воркер + Redis) или `inline` (ленивые задачи в web, dev без Redis) |
| `SESSION_SECRET`, `CART_COOKIE_SECRET`, `PAYMENT_WEBHOOK_SECRET` | секреты, минимум 32 символа |
| `PAYMENT_PROVIDER=yookassa` + `YOOKASSA_SHOP_ID/SECRET_KEY` | реальная оплата; без ключей остаётся mock |
| `DELIVERY_PROVIDER=cdek` + `CDEK_ACCOUNT/SECURE_PASSWORD` | реальная доставка |
| `NOTIFICATION_PROVIDER=smtp` + `SMTP_*` | письма (см. ограничения) |
| `FISCAL_PROVIDER=atol` + `ATOL_*` | чеки 54-ФЗ |
| `MEDIA_DRIVER=s3` + `S3_*` | S3-хранилище изображений |
| `WILDBERRIES_API_TOKEN`, `OZON_*`, `YANDEX_MARKET_*` | синхронизация маркетплейсов |
| `SEO_INDEXING_ENABLED=true` | разрешить индексацию (robots.txt) после запуска |

Webhook ЮKassa: `https://домен/api/webhooks/payments/yookassa` (события `payment.succeeded`, `payment.canceled`, `refund.succeeded`).

## Без Docker (pnpm)

```bash
pnpm install && cp .env.example .env
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm build && pnpm start          # web на :3000
pnpm dev:worker                   # воркер (нужен Redis, QUEUE_DRIVER=bullmq)
```

Для systemd: `ExecStart=/usr/bin/node apps/web/.next/standalone/apps/web/server.js` с `WorkingDirectory` в корне и `EnvironmentFile=.env`; воркер — `pnpm --filter @techmatch/worker start`.

## CI

`.github/workflows/ci.yml`: install → generate → migrate → typecheck → lint → unit/integration → seed → build → e2e (Playwright).
