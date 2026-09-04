# Сетевой протокол

Источник истины — `src/ReplicatedStorage/Shared/Net/NetworkSchemas.luau`. Каждое событие имеет направление,
схему аргументов (тип, диапазон, длина строки, enum, размер таблицы), token-bucket лимит и допустимые состояния гонки.
`Network.CreateDispatcher` (сервер) прогоняет каждый вызов: rate limit → запрет Instance в аргументах →
схема → состояние → permission → handler в pcall. Любой отказ → `Rejected` → `SecurityService:Flag`.

Клиент отправляет только намерения. Физика реплицируется штатно (владелец — водитель), RemoteEvent
в RenderStepped не используется. Снапшоты гонки идут сервер→клиент 10 Гц, HUD обновляется 15 Гц.

## Client → Server

| Remote | Аргументы | Лимит (cap/refill) | Состояния |
|---|---|---|---|
| ClientReady | — | 3 / 0.2 | любое |
| SelectLoadout | heroId enum, vehicleId enum | 10 / 2 | любое |
| SelectCosmetic | category enum, id ≤128 | 10 / 2 | |
| RequestUnlock | kind enum, id, purchaseId | 5 / 0.5 | |
| UpdateSettings | table (только известные поля, диапазоны) | 5 / 1 | |
| TutorialProgress | int 0..16 | 10 / 1 | |
| PartyAction | action enum, userId? | 10 / 2 | |
| QueueAction | Join/Leave, modeId? | 6 / 1 | |
| CustomRoomAction | action enum, rules table (валидируется), targetId? | 8 / 1 | |
| StartMode | modeId, venueId? | 4 / 0.5 | |
| VoteTrack | venueId enum | 6 / 1 | TrackVote |
| LoadoutConfirm | — | 4 / 1 | LoadoutLock, GridSetup |
| TrackLoaded | venueId | 4 / 0.5 | |
| StartThrottle | — | 3 / 0.5 | Countdown, Racing |
| DriftEvent | Start/Release/Cancel, tier 0..3 | 12 / 4 | Racing, FinishWindow |
| TrickEvent | jumpId | 6 / 2 | Racing, FinishWindow |
| UseItem | Active/Reserve, aim unit vector? | 6 / 3 | Racing, FinishWindow |
| RequestRespawn | — | 3 / 0.5 | Countdown, Racing, FinishWindow |
| PostRaceChoice | NextRace/ContinueTour/Lobby | 4 / 1 | Results, Rewards, Returning |
| SpectateAction | Next/Prev | 6 / 2 | |
| ClientTelemetry | table ≤64 | 2 / 0.1 | |

Функции: `GetCatalog`, `GetRecords(trackId)`.

## Server → Client

ProfileLoaded(view, status), ProfileUpdated, LobbyState, PartyState, QueueState, RaceState(state, view),
RaceSnapshot (10 Гц: ранги/круги/прогресс всех, снаряды, личные предметы/буст/эффекты),
RaceEvent(name, data): Checkpoint, Lap, Finished, RacerFinished, Incoming, Shard, Eliminated, KnockoutStage,
MissedCheckpoints, Spectate, CoresLost; KartEffect(name, data): StartBoost, Boost, Hit, Respawn, Trick;
ItemState, KartAssigned, VisualEvent (ItemUse, Hit, Shield, Shielded, Wave, StormCrown, Blink, Phase, DriftBoost, Trick, Gate),
Results(results, rewards), ErrorDialog(key, data), Tutorial, GhostData.

## Matchmaking и teleport

Тикет = группа (неделима), TTL 90 с, идемпотентен по id. Local mode: очередь в памяти сервера, матч стартует
в этом же place. Remote mode: тикеты дублируются в MemoryStore SortedMap `RiftRacersQueue`, любой сервер может
собрать матч, минтит токен `tp:<token>` в MemoryStore, резервирует сервер (`ReserveServer` + `TeleportAsync`,
3 попытки с backoff); race-сервер проверяет токен из TeleportData и только тогда стартует сессию.
Провал телепорта → ErrorDialog и возврат в очередь. Формирование матчей — чистая функция
`MatchmakingService.FormMatches` (юнит-тесты).
