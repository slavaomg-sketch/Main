# Архитектура

## Слои

| Слой | Путь | Содержимое |
|---|---|---|
| Shared | `src/ReplicatedStorage/Shared` | конфиги (GameConfig, Hero/Vehicle/Track/Item/Mode/Reward/Audio/Surface Definitions), типы, сеть (Network, NetworkSchemas, Validator, RateLimiter), утилиты (Signal, Maid, MathUtil, TableUtil, TimeUtil, Spline), локализация, `Systems/VehicleStats`, `Systems/KartPhysicsModel` |
| Server | `src/ServerScriptService/Server` | `Bootstrap.server`, `ServiceRegistry`, `Env` (адаптер платформы), `RobloxEnvFactory`, `RobloxWorld`, `Services/*`, `Systems/*`, `Modes/*`, `Builders/*` |
| Client | `src/StarterPlayer/StarterPlayerScripts/Client` | `Bootstrap.client`, `ClientRegistry`, `ClientState`, `Controllers/*`, `UI/*`, `TrackAssist`, `GhostPlayback` |

Все модули `--!strict`. Глобальных переменных нет; зависимости получаются из реестра по имени в `Init`.
Циклических require нет (проверяется Lune-загрузчиком, который падает на цикле).

## Lifecycle

`ServiceRegistry`/`ClientRegistry`: `Add` → `InitAll` (получение зависимостей, регистрация remote-хендлеров) →
`StartAll` (подписки на события, циклы) → `DestroyAll` (обратный порядок, отключение соединений, отмена потоков).
Порядок сервисов задан в `Bootstrap.server`: Telemetry → Security → Mode → Profile → Reward → Party →
RaceProgress → KartValidation → Item → BotRacer → Race → Matchmaking → Lobby.

## Env и World (тестируемость)

Сервисы не трогают Roblox API напрямую. `Env` даёт: часы (`Now` = `workspace:GetServerTimeNow()`), игроков,
диспетчер сети, DataStore backend, MemoryStore-очередь, TeleportAdapter, Heartbeat, BindToClose, RNG, лог, `World`.
`World` (см. `Systems/World.luau`) — единственный интерфейс к геометрии: постройка/снос трасс, спавн картов,
чтение поз, установка поз, пикапы, визуал снарядов. `RobloxWorld` реализует его на реальных Instance,
`tests/Lune/FakeEnv.luau` — headless-версия с KartSim, на которой гоняются интеграционные и нагрузочные тесты.

## Поток гонки

`RaceService:StartSession` создаёт `RaceSession` (состояние, ростер, правила, `RaceStateMachine`).
Тик 20 Гц (`RaceService:Step` на Heartbeat) ведёт машину состояний:
`WaitingForPlayers → LoadingProfiles → TrackVote → LoadingTrack → LoadoutLock → GridSetup → Countdown → Racing → FinishWindow → Results → Rewards → (TrackVote|Returning)`.
Переходы только из таблицы `RaceStateMachine.Transitions`; нелегальные логируются и отклоняются.

За тик для каждого гонщика: боты — `BotRacerService:TickBot` (BotBrain → KartSim → World.SetPose);
все — `RaceProgressService:TickRacer` (World.GetPose → `TrackRuntime:Locate` → `CheckpointSystem.Update` →
респавн/slipstream/ghost); люди — `KartValidationService:Validate` (5 Гц). Затем `Mode:OnTick`, пикапы,
`ItemService:TickEffects` (снаряды, ловушки, хазарды, Storm Crown, Overcharge), ранжирование
(`PlacementSystem`), снапшот клиентам 10 Гц.

Несколько сессий могут жить в одном place: `RobloxWorld` даёт каждой свой origin (шаг 12000 studs по X);
сессионная логика работает в локальных координатах трассы.

## Трассы

`TrackDefinition` (данные) → `TrackRuntime` (сплайн Catmull-Rom с arc-length, чекпоинты, шорткаты, поверхности,
grid, safe respawn) → `TrackBuilder` (Parts: дорога, стены, трамплины, маркеры, хазарды, движущиеся элементы, декор).
`TrackValidator` проверяет данные до старта сервера; Bootstrap падает при ошибке контента.

## Клиент

`ClientState` принимает все ServerToClient-события и раздаёт сигналы. `KartController` — единственный, кто
двигает физику локального карта (network ownership у водителя): raycast-подвеска на 4 точки (VectorForce),
сила тяги/сцепления, угловая скорость для руления, `AlignOrientation` по нормали земли, дрифт с зарядом
(намерения на сервер, буст подтверждает сервер, локальное предсказание сглаживает задержку), трюки, стан, респавн.
`CameraController` — chase/spectate/results/garage/lobby. `HUDController` — HUD + миникарта + тач-контролы.
`MenuController` + `GarageController` + `TutorialController` — все экраны.
