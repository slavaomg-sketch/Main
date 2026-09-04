# TechMatch

Интернет-магазин аксессуаров с подбором по устройству: покупатель вводит модель («iPhone 15 Pro», «MacBook Air M2», «Canon G3410»), а TechMatch показывает только совместимые аксессуары и объясняет, почему они подходят. Совместимость — часть доменной модели (характеристики устройств и товаров + правила + подтверждения), а не текст в карточке.

Монорепозиторий: Next.js 16 (витрина + админка), BullMQ-воркер, PostgreSQL 16, Redis, Prisma 6, Tailwind v4, Vitest, Playwright. Подробности — в `docs/`.

> Прежнее содержимое репозитория (Telegram-бот напоминаний) перенесено в `legacy/reminder-bot/` без изменений.

## Быстрый старт (разработка)

Требования: Node 22, pnpm 10, PostgreSQL 16, Redis 7 (Redis нужен только для `QUEUE_DRIVER=bullmq`).

```bash
pnpm install
cp .env.example .env                 # укажите DATABASE_URL и TEST_DATABASE_URL
createdb techmatch && createdb techmatch_test   # или через psql
pnpm db:generate                     # Prisma Client
pnpm db:migrate                      # миграции (prisma migrate deploy)
pnpm db:seed                         # демо-данные: 46 устройств, 71 товар, связи, комплекты, заказ
pnpm dev                             # http://localhost:3000
pnpm dev:worker                      # воркер (опционально; при QUEUE_DRIVER=inline задачи выполняются лениво в web)
```

Docker Compose (postgres + redis + миграции + web + worker): `cp .env.example .env && SEED_ON_START=1 docker compose up -d --build` — см. `docs/DEPLOYMENT.md`.

## Адреса и учётные данные (seed)

| Что | Где |
|---|---|
| Витрина | http://localhost:3000 |
| Админка | http://localhost:3000/admin |
| Healthcheck | http://localhost:3000/api/health |
| Тестовая оплата | страница `/mock-payment/[id]`, на которую ведёт checkout |

| Роль | Email | Пароль |
|---|---|---|
| Владелец (все права) | `admin@techmatch.local` | `Admin12345!` |
| Менеджер каталога | `catalog@techmatch.local` | `Catalog12345!` |
| Менеджер заказов | `orders@techmatch.local` | `Orders12345!` |
| Покупатель | `customer@techmatch.local` | `Customer12345!` |

Промокоды из seed: `WELCOME10` (10 %, от 2 000 ₽), `CHARGE20`, `TECH500`.

## Команды

| Команда | Действие |
|---|---|
| `pnpm typecheck` | tsc во всех пакетах |
| `pnpm lint` | ESLint (flat config в корне) |
| `pnpm test` | unit + интеграционные тесты (`packages/domain`, `packages/integrations`); интеграционные требуют `TEST_DATABASE_URL` |
| `pnpm test:e2e` | Playwright (`apps/web/e2e`), поднимает `pnpm start` или использует уже запущенный сервер |
| `pnpm build` | production-сборка web (standalone) |
| `pnpm start` | запуск собранного web |
| `pnpm db:migrate:dev` | новая миграция при изменении `schema.prisma` |
| `pnpm db:reset` | пересоздать БД и применить миграции (потом `pnpm db:seed`) |
| `pnpm db:studio` | Prisma Studio |

## Структура

```
apps/web         витрина, /admin, API (route handlers), server actions, e2e-тесты
apps/worker      BullMQ: истечение резервов, пересчёт совместимости, синхронизация маркетплейсов
packages/config  переменные окружения (zod), статус интеграций
packages/database Prisma-схема, миграции, клиент, seed, демо-изображения (seed-assets)
packages/domain  доменные модули: compatibility, devices, search, catalog, pricing, inventory, cart,
                 checkout, orders, payments, customers, promotions, content, imports, media,
                 notifications, admin (RBAC), audit, maintenance
packages/integrations  PaymentProvider/DeliveryProvider/NotificationProvider/FiscalReceiptProvider,
                 mock-реализации, ЮKassa, СДЭК, АТОЛ, CSV/XLSX/YML, Wildberries/Ozon/Яндекс Маркет, LLM
packages/validation  общие zod-схемы
packages/testing тестовая БД и фикстуры
packages/ui      design tokens
docs/            ARCHITECTURE, DATA_MODEL, COMPATIBILITY_ENGINE, MARKETPLACE_IMPORTS, DEPLOYMENT,
                 KNOWN_LIMITATIONS, IMAGE_CREDITS
```

## Маршруты витрины

`/`, `/catalog`, `/search`, `/devices`, `/devices/[category]`, `/device/[slug]`, `/category/[slug]`, `/brand/[slug]`, `/brands`, `/product/[slug]`, `/bundles`, `/bundles/[slug]`, `/favorites`, `/cart`, `/checkout`, `/order/[publicId]`, `/account`, `/account/devices`, `/account/orders`, `/account/login`, `/account/register`, `/help`, `/info/[slug]` (доставка, оплата, возврат, гарантия, конфиденциальность, соглашение, о нас, контакты, партнёрам, блог), `/sitemap.xml`, `/robots.txt`.

Админка: `/admin`, `/admin/products`, `/admin/products/[id]`, `/admin/devices`, `/admin/devices/[id]`, `/admin/compatibility`, `/admin/imports`, `/admin/imports/[id]`, `/admin/orders`, `/admin/orders/[id]`, `/admin/customers`, `/admin/content`, `/admin/promotions`, `/admin/users`, `/admin/audit`.

## Режимы интеграций

Все внешние системы работают через интерфейсы. Без ключей в `.env` используется явный mock (виден в `/api/health` и на дашборде админки): оплата — локальная страница с подписанным webhook, доставка — фиксированные тарифы, письма — в лог, чеки — заглушка, маркетплейсы — «не настроен». Реальные адаптеры (ЮKassa, СДЭК, АТОЛ, SMTP, WB/Ozon/Я.Маркет, S3) включаются переменными окружения; статус их готовности — в `docs/KNOWN_LIMITATIONS.md`.

## Лицензии демо-изображений

Изображения seed — с Wikimedia Commons (CC0/CC BY/CC BY-SA/PD), список с авторами в `docs/IMAGE_CREDITS.md`. Перед публичным запуском заменить реальными фото товаров.
