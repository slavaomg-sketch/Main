# RIFT RACERS

Оригинальная сетевая аркадная гоночная игра для Roblox: 8 героев, 8 машин, 6 трасс, 2 арены, 12 гаджетов,
режимы Quick Race / Grand Tour / Time Trial / Private Race / Knockout / Team Race / Core Clash / Shard Rush,
серверная авторитетность, боты, профили с session lock, локализация EN/RU.

Название проекта хранится в одном месте: `src/ReplicatedStorage/Shared/Config/GameConfig.luau` (`ProjectName`).

## Структура

```
rift-racers/
  default.project.json      Rojo-проект (production place)
  test.project.json         Rojo-проект с папкой tests (для запуска в Studio)
  src/
    ReplicatedStorage/Shared     конфиги, типы, сеть, утилиты, локализация, физическая модель
    ServerScriptService/Server   сервисы, системы, режимы, процедурные билдеры, Bootstrap.server
    StarterPlayer/.../Client     контроллеры клиента, UI, Bootstrap.client
    ServerStorage/Content        место для импортируемого контента (сейчас всё процедурное)
  tests/                     Lune-тесты (unit, security, content, integration, multiplayer load)
  tools/                     analyze.py (luau-analyze со строгой типизацией), globalTypes.d.luau
  docs/                      архитектура, дизайн, сеть, безопасность, отчёты
```

## Требования

- Rojo 7.7 (`cargo install rojo --version 7.7.0` или aftman)
- Lune 0.10.5 для headless-тестов (`cargo install lune --version 0.10.5`)
- StyLua 2.x (форматирование), luau-analyze (типизация, см. tools/analyze.py)
- Roblox Studio с включённым Rojo-плагином (для синхронизации) либо сборка `.rbxlx`

`aftman.toml` фиксирует версии инструментов; `aftman install` ставит их при наличии доступа к GitHub.

## Команды

```bash
# Сборка place-файла и открытие в Studio
rojo build default.project.json -o build/RiftRacers.rbxlx

# Живая синхронизация в открытую Studio (плагин Rojo -> Connect)
rojo serve default.project.json

# Headless-тесты (все / по фильтру)
lune run tests/run.luau
lune run tests/run.luau Security

# Строгая типизация всех модулей (нужен luau-analyze в PATH)
python3 tools/analyze.py

# Форматирование
stylua src tests
```

## Запуск в Studio

1. `rojo build default.project.json -o build/RiftRacers.rbxlx`, открыть файл в Studio.
2. Test → Clients and Servers → 2 клиента (или больше) → Start. Каждый клиент попадает в лобби.
3. Quick Play на двух клиентах: через 25 секунд ожидания места добьются ботами до 8, пройдёт голосование,
   загрузка трассы, отсчёт, гонка на 3 круга, результаты и награды.
4. Time Trial / Practice / Private Race доступны сразу одному клиенту (Modes, Private Race, Practice Loop).
5. F3 включает диагностику сети/памяти в HUD.

В Studio без «Enable Studio Access to API Services» профили работают в памяти (в Output будет предупреждение),
прогресс между запусками не сохраняется. `Matchmaking.LocalMode = true` держит гонку в том же place;
для universe с отдельным Race Place переключите флаг и заполните `TeleportAdapter` (см. docs/NETWORK_PROTOCOL.md).

## Управление

Клавиатура: W газ, S тормоз/назад, A/D руль, Space/Shift дрифт-трюк, E предмет, F резервный предмет,
Q вид назад, R возврат, H сигнал, Esc/Tab меню. Геймпад: RT газ, LT тормоз, левый стик руль, RB дрифт,
X предмет, Y резерв, LB вид назад, Select возврат. Мобильные: экранные кнопки с настройкой стороны,
размера и прозрачности, автогаз, опциональный наклон.

## Документация

- docs/ARCHITECTURE.md — слои, сервисы, lifecycle, поток данных
- docs/GAME_DESIGN.md — герои, машины, трассы, предметы, режимы, экономика
- docs/NETWORK_PROTOCOL.md — все RemoteEvents со схемами и лимитами
- docs/SECURITY_MODEL.md — античит и модель доверия
- docs/TRACK_AUTHORING.md — формат TrackDefinition и валидатор
- docs/ASSET_MANIFEST.md — все ассеты и их происхождение
- docs/TEST_REPORT.md, docs/PERFORMANCE_REPORT.md — фактические результаты
- docs/IMPLEMENTATION_STATUS.md — что готово, что нет, следующий шаг владельца
- docs/DECISIONS.md, docs/CHANGELOG.md
