# Compatibility Engine

Код: `packages/domain/src/compatibility/`. Чистые функции без БД (`rules.ts`, `engine.ts`) + построители профилей из строк БД (`profiles.ts`) + сервис с кешем и персистентностью (`service.ts`). Юнит-тесты: `__tests__/engine.test.ts`.

## Входные данные

**Профиль устройства** (`DeviceSpecProfile`) собирается из `DeviceSpecification` (ключи с точкой раскрываются во вложенные объекты, характеристики варианта перекрывают модель):

```json
{
  "ecosystem": "apple",
  "region": "RU/EU",
  "ports": [{ "type": "USB_C", "usbVersion": "3.2 Gen 2", "dataGbps": 10, "dpAltMode": true, "thunderbolt": 4, "pdIn": true, "hdmiVersion": "2.1" }],
  "charging": { "protocols": ["USB_PD", "PPS"], "maxWatts": 45, "minWatts": 30, "pdVoltages": [20], "viaUsb": true },
  "wireless": { "qi": true, "qi2": true, "magsafe": true, "magsafeMaxWatts": 15, "qiMaxWatts": 7.5 },
  "consumables": { "inkBottles": ["GI-490BK"], "cartridges": [], "toners": [], "drums": [], "batteries": [] },
  "physical": { "caseFamily": "iphone-15-pro", "screenInches": 6.1, "bandGroup": "apple-large", "vesa": ["100x100"] },
  "storage": { "microSd": true, "maxMicroSdGb": 2048 },
  "audio": { "bluetooth": "5.3", "jack35": false },
  "display": { "maxExternalDisplays": 2 }
}
```

Типы разъёмов: `USB_C, USB_A, LIGHTNING, MICRO_USB, USB_B, HDMI, DISPLAYPORT, MINI_DISPLAYPORT, THUNDERBOLT, MAGSAFE_3, JACK_3_5, DC_BARREL, SD, MICRO_SD, ETHERNET, SOCKET_12V, PROPRIETARY`. Протоколы: `USB_PD, PPS, QC3, QC4, AFC, SUPERVOOC, PROPRIETARY, USB_BC`.

**Профиль товара** (`ProductSpecProfile`) собирается из `ProductAttribute` по кодам `AttributeDefinition`: `kind` (CHARGER, CAR_CHARGER, POWER_BANK, CABLE, ADAPTER, WIRELESS_CHARGER, HUB, DOCK, VIDEO_CABLE, CASE, SCREEN_PROTECTOR, WATCH_BAND, CONSUMABLE, BATTERY, STORAGE, MEMORY_CARD, CONTROLLER, GAMING_ACCESSORY, MOUNT, STAND, HEADPHONES, CAR_MOUNT, KEYBOARD_MOUSE, PERIPHERAL, OTHER), `connector_a/b`, `outputs` (порты с мощностью и протоколами), `power_watts`, `protocols`, `pd_voltages`, `cable_rated_watts`, `usb_version`, `data_gbps`, `charge_only`, `dp_alt_mode`, `thunderbolt`, `thunderbolt_required`, `hdmi_version`, `hdmi_out`, `wireless` (qi/qi2/magsafe/watts), `fits_models`, `fits_case_families`, `consumable_type`, `consumable_codes`, `region`, `band_groups`, `platforms`, `vesa`, `screen_min/max_inches`, `card_type`, `capacity_gb`, `requires_port`, `bluetooth`, `jack_35`, `wireless_charging`.

## Правила (`ALL_RULES`, по приоритету)

| Правило | Что проверяет |
|---|---|
| `CATEGORY_SCOPE` | заведомо неприменимые сочетания (чехол для принтера, картридж для телефона, ремешок для ноутбука) |
| `CONSUMABLE_MATCH` | код картриджа/чернил/тонера/аккумулятора входит в список устройства; регион → ограничение; другой тип расходника → отказ |
| `FIT_MODEL_LIST` | явный список моделей или семейств корпусов (чехлы, стёкла, клавиатуры, стилусы) |
| `BAND_SIZE` | группа размера ремешка (`apple-small`, `apple-large`, `lug-20mm`) |
| `CONNECTOR_MATCH` | разъём товара есть у устройства; USB-C ≡ Thunderbolt; USB-A-периферия на USB-C-устройстве → «нужен переходник»; автотовары проверяются по гнезду 12 В автомобиля |
| `PLATFORM_MATCH` | геймпады и игровые аксессуары по экосистеме; карты памяти по слоту и объёму; наушники по Bluetooth/3,5 мм |
| `POWER_DELIVERY` | USB PD / PPS / QC, мощность против `maxWatts`/`minWatts` (ноутбуки), профили напряжения (20 В для ноутбуков, 15 В для Switch), USB-A без быстрой зарядки, только-USB-BC устройства, номинал кабеля, сквозное питание хабов; добавляет `REQUIRES_PRODUCT` (нужный кабель) |
| `WIRELESS_CHARGING` | Qi / Qi2 / MagSafe и итоговая мощность; MagSafe на Qi-устройстве → без магнитов |
| `DISPLAY_OUTPUT` | DP Alt Mode, Thunderbolt-режим, версии HDMI/DP |
| `DATA_TRANSFER` | версия USB кабеля/накопителя против порта; кабели «только зарядка» |
| `PHYSICAL_FIT` | VESA, диагональ (подставки, кронштейны), автодержатели |

Каждое правило возвращает `PASS | LIMITED | FAIL | UNKNOWN | NOT_APPLICABLE` с уверенностью, причинами, ограничениями и структурными constraints (`REDUCED_POWER`, `REQUIRES_ADAPTER`, `NO_DATA_TRANSFER`, `NO_VIDEO_OUTPUT`, `REGION_SPECIFIC`, `REQUIRES_PRODUCT` …). Отказ правила с приоритетом ≤ 10 останавливает оценку.

## Объединение

`FAIL` → **INCOMPATIBLE** (показываются только причины отказа); иначе `LIMITED` → **COMPATIBLE_WITH_LIMITATIONS**; иначе `PASS` → **COMPATIBLE** (уверенность ≥ 0.95 при явном списке моделей или коде расходника); ни одного применимого правила → **UNKNOWN**.

Приоритет источников: **override администратора** > **явная связь** (`EXPLICIT`/`MANUFACTURER`/`IMPORT`) > **правила**. Явная `VERIFIED`-связь не скрывает ограничение, найденное правилами (например, подтверждённая зарядка 30 Вт для MacBook остаётся «с ограничениями»). Результат содержит статус, confidence, источник, причины, ограничения, constraints, применённые правила, объяснение на русском, дату проверки и evidence.

## Статусы для покупателя

`VERIFIED` «Проверено», `COMPATIBLE` «Полностью совместимо», `COMPATIBLE_WITH_LIMITATIONS` «Совместимо с ограничениями» (текст: «зарядка будет медленнее максимальной», «нужен переходник», «только для модификации …»), `UNKNOWN` «Совместимость не подтверждена» (скрыто по умолчанию), `INCOMPATIBLE` «Не совместимо».

## Сервис

- `checkCompatibility(db, {productId, deviceModelId, deviceVariantId?, variantId?, log?})` — вердикт для пары, пишет `CompatibilityCheckLog`.
- `evaluateDeviceCatalog(db, deviceModelId, {persist})` — все активные товары; кеш 60 с в памяти; `persist` пишет `CompatibilityRelation` source=RULE (воркер делает это раз в час и seed — сразу).
- `listCompatibleDevicesForProduct` — список устройств для страницы товара.
- `upsertExplicitRelation`, `setCompatibilityOverride`, `deactivateRelation`, `listAutoCandidates`, `listProductsWithoutVerifiedCompatibility` — административные операции (все с аудитом в actions).

## LLM

`LlmAssistant` (`packages/integrations/src/llm`) — только разбор свободного запроса, исправление опечаток, подсказка кандидатов и полировка объяснения. По умолчанию `DisabledLlmAssistant`. Вердикт совместимости языковая модель никогда не выносит.

## Добавление правила

1. Реализовать `CompatibilityRule` в `rules.ts` и добавить в `ALL_RULES` (приоритет определяет порядок и «жёсткие» отказы).
2. При необходимости расширить `ProductSpecProfile`/`DeviceSpecProfile` и `buildProductProfile`/`buildDeviceProfile`.
3. Добавить `AttributeDefinition` в seed (`ATTRIBUTES`) и тест в `engine.test.ts`.
4. Поднять `ENGINE_VERSION` (сбрасывает кеш).
