# Импорт и синхронизация

## Принципы

- Только официальные API маркетплейсов, выгрузки продавца или файлы. Парсинг публичных страниц не используется.
- Один конвейер для всех источников: **загрузка → анализ → сопоставление полей → валидация → dry-run → отчёт → подтверждение → идемпотентное применение → журнал**.
- Ключ идемпотентности — `ExternalListing(sourceId, externalId)`. Дополнительно строка сопоставляется по SKU и GTIN; внешний ID, совпадающий с нашим SKU, тоже считается совпадением.
- Ownership полей: `ExternalFieldOwnership` хранит, кем управляется поле (`MANUAL`/`SOURCE`). Ручная правка названия, описания, цены, остатка или изображений в админке закрепляет поле как `MANUAL`, и импорт его больше не перезаписывает (в dry-run это видно как INFO «поле отредактировано вручную»). Совместимость и SEO источники не трогают.

## Файлы (работает сейчас)

Адаптеры: `CsvImportAdapter` (автоопределение разделителя `; , \t |`, BOM), `XlsxImportAdapter` (первый лист или указанный), `YmlImportAdapter` (`<offer>` → таблица, `<param>` → `param:*`).

Канонические поля (`CANONICAL_FIELDS`): `externalId*`, `sku`, `gtin`, `name`, `brand`, `category` (slug или название, иначе «Другие аксессуары»), `description`, `priceMinor` (рубли → копейки), `compareAtMinor`, `stock`, `imageUrls` (через `;` или `|`), `externalUrl`, `compatibleDevices` (slug устройств через `|`). Столбцы сопоставляются автоматически по заголовкам (русские и английские) и правятся в интерфейсе; несопоставленные столбцы сохраняются в `rawPayload`.

Отчёт dry-run по строкам: **создастся / обновится / пропустится (нет изменений) / конфликт (дубликат ID в файле, SKU привязан к другому листингу) / ошибка (нет ID, нет названия у нового товара, нечисловая цена)**. Применяются только CREATE/UPDATE; каждая строка — отдельная транзакция, ошибки строки не останавливают остальные. Изображения по ссылкам скачиваются в управляемое хранилище (опционально) с дедупликацией по sha256 и генерацией размеров; оригинальный URL сохраняется в `MediaAsset.originalUrl`.

Пример файла: `apps/web/public/import-sample.csv` (доступен по `/import-sample.csv`).

## Маркетплейсы (адаптеры готовы, включаются ключами)

| Источник | Адаптер | Ключи | API |
|---|---|---|---|
| Wildberries | `WildberriesAdapter` | `WILDBERRIES_API_TOKEN` | Content API `content/v2/get/cards/list`, Prices API |
| Ozon | `OzonAdapter` | `OZON_CLIENT_ID`, `OZON_API_KEY` | Seller API `v3/product/list`, `v3/product/info/list`, `v4/product/info/stocks` |
| Яндекс Маркет | `YandexMarketAdapter` | `YANDEX_MARKET_OAUTH_TOKEN`, `YANDEX_MARKET_CAMPAIGN_ID` | Partner API `offer-mapping-entries` |

Воркер (`apps/worker`) раз в 6 часов забирает карточки настроенных адаптеров в `ExternalListing` (статус NEW/UPDATED, `SyncRun` с итогами и ошибками). Дальше данные проходят тот же конвейер подтверждения в админке. Обратная синхронизация цен и остатков (`pushPricesAndStocks`) объявлена в интерфейсе и реализуется по мере подключения.

## Экспорт

`/api/admin/export/catalog.csv|catalog.xlsx|prices-stocks.csv|compatibility.csv|feed.yml` (право `imports.read`). YML-фид строится из активных товаров с ценами и категориями.

## Права на контент

Изображения из внешних источников сохраняются с `originalUrl`, `license`, `attribution`. Перед публикацией чужих фото проверяйте права; демо-изображения seed — см. `docs/IMAGE_CREDITS.md`.
