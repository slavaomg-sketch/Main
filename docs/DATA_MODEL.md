# Модель данных

Схема: `packages/database/prisma/schema.prisma`. Все `DateTime` — UTC, деньги — `Int` в копейках, идентификаторы — cuid. Удаления: каскад для «дочерних» записей (варианты, атрибуты, позиции), `Restrict` для справочников (категория, бренд, склад), `SetNull` для ссылок из истории (заказ → клиент).

## Устройства

| Сущность | Назначение |
|---|---|
| `DeviceCategory` | телефоны, ноутбуки … (иконка из единого набора) |
| `DeviceBrand`, `DeviceFamily` | бренд и линейка (iPhone, MacBook Air) |
| `DeviceModel` | конкретная модель: slug, полное имя, год, поколение, популярность, `specsAreDemo` |
| `DeviceVariant` | модификация (13″/15″, 42/46 мм) с собственными характеристиками |
| `DeviceAlias` | синонимы, опечатки, транслит; `normalized` индексирован pg_trgm |
| `DeviceIdentifier` | номера моделей (A2681, SM-S931B), артикулы, регион |
| `DeviceSpecification` | характеристики ключ → JSON (`ports`, `charging`, `wireless`, `consumables`, `physical`, `storage`, `audio`, `display`, `region`, `ecosystem`), источник и флаг demo |

## Каталог

`AccessoryCategory` (дерево), `ProductBrand`, `AttributeDefinition` (код, тип, единица, `isCompatibilityRelevant`), `Product` (статус DRAFT/ACTIVE/ARCHIVED, бейджи, SEO, `searchText`), `ProductVariant` (SKU уникален, опции JSON, GTIN), `Price` (история цен с `validFrom/validTo`, прайс-лист), `Warehouse`, `Inventory` (`quantity`, `reservedQuantity`), `StockReservation` (резерв под заказ с `expiresAt`), `ProductImage` → `MediaAsset` (sha256 дедупликация, варианты размеров), `ProductAttribute` (значение JSON на товар или вариант), `Review`.

## Совместимость

`CompatibilityRule` (настройки правил), `CompatibilityRelation` (уникально по товар × устройство × scopeKey; `source` RULE/EXPLICIT/MANUFACTURER/IMPORT/ADMIN_OVERRIDE; статус, confidence, причины, ограничения, применённые правила, объяснение, `verifiedAt/By`), `CompatibilityEvidence` (документ производителя, проверка админом, лаб-тест, отзыв), `CompatibilityConstraint` (REQUIRES_ADAPTER, REDUCED_POWER, ONLY_VARIANT, REGION_SPECIFIC, REQUIRES_PRODUCT …), `CompatibilityOverride` (ручной вердикт с причиной), `CompatibilityCheckLog`, `SearchQueryLog` (в т.ч. запросы без результата).

## Маркетплейсы и импорт

`ExternalSource` (тип CSV/XLSX/YML/WILDBERRIES/OZON/YANDEX_MARKET/API, конфиг без секретов), `ExternalListing` (уникально `sourceId + externalId`; offerId, sku, gtin, url, сырой payload, привязка к товару/варианту, ошибки), `ExternalFieldOwnership` (поле управляется MANUAL или SOURCE), `ImportJob` (статусы UPLOADED → ANALYZED → MAPPED → DRY_RUN_COMPLETE → APPLYING → COMPLETED/FAILED; mapping, options, analysis, summary, hash файла), `ImportRow` (действие CREATE/UPDATE/SKIP/CONFLICT/ERROR, diff, `appliedAt`), `ImportIssue`, `SyncRun`.

## Продажи

`Customer`, `CustomerSession`, `CustomerDevice` (primary-устройство), `Favorite`, `Address`, `Cart` (гость по `sessionToken`, статус ACTIVE/CONVERTED/ABANDONED, активное устройство, промокод), `CartItem`, `Order` (публичный номер `TM-YYMMDD-XXXXX`, статус-автомат, снимок адреса и сумм, `idempotencyKey`, `reservationExpiresAt`), `OrderItem` (снимок названия/цены/устройства/статуса совместимости), `Payment` (`idempotencyKey`, provider + providerPaymentId), `PaymentEvent` (уникально provider + providerEventId), `Shipment`, `OrderStatusHistory`, `Refund`, `Coupon`, `CouponUsage`.

## Контент и маркетинг

`Banner` (размещение, тема, изображение, рукописная заметка), `Collection`/`CollectionItem` (подборки, в т.ч. «Популярные товары»), `Bundle`/`BundleItem`/`BundleDevice`, `Promotion`, `ContentPage` (markdown), `FaqItem`, `SiteSetting` (настройки главной, hero-изображения), `NewsletterSubscriber`.

## Администрирование

`Role` ↔ `Permission` (через `RolePermission`), `AdminUser` (scrypt-хеш, `mfaEnabled`/`mfaSecretEncrypted` — резерв под MFA), `AdminSession`, `AuditLog` (кто, что, когда, было/стало, IP), `RateLimitBucket`.

## Индексы

Уникальные: slug'и, SKU, `Order.publicId/idempotencyKey`, `Payment.idempotencyKey`, `PaymentEvent(provider, providerEventId)`, `ExternalListing(sourceId, externalId)`, `CompatibilityRelation(productId, deviceModelId, scopeKey)`. Поисковые: GIN pg_trgm на `DeviceAlias.normalized`, `DeviceModel.fullName`, `DeviceIdentifier.normalized`, `Product.searchText`, `ProductVariant.sku`; GIN full-text на `Product.searchText` (миграция `20260904150000_search_indexes`).
