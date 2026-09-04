# Авторинг трасс

Трасса — запись в `Shared/Config/TrackDefinitions.luau`. Геометрия строится процедурно `TrackBuilder`,
поэтому новая трасса — это данные, не моделирование.

## Поля TrackDefinition

- `Id`, `NameKey`, `DescriptionKey`, `Theme`, `Difficulty`, `ContentVersion`
- `Path` — замкнутый контур контрольных точек Catmull-Rom (Vector3), `Scale` — множитель координат
- `Width`, `WidthOverrides[{From,To,Width}]` — ширина дороги по долям круга
- `CheckpointCount` — равномерные обязательные чекпоинты (последний = финиш)
- `GridRows × GridColumns` ≥ 12 мест
- `SurfaceZones[{From,To,Surface}]` — Asphalt, Dirt, Sand, Ice, Wet, EnergyLane, Hazard, BoostPad, Grass, MagRail
- `HazardZones[{Id,At,To?,Kind,Period?,Duration?,Force?,StunLevel?,Lateral?}]` — Geyser, Press, Wind, Current, Conveyor, LavaPool, Collapse
- `Jumps[{Id,At,GapLength,LaunchPitch,Trick}]` — разрыв дороги + рампа + триггер трюка
- `Shortcuts[{Id,EntryT,ExitT,Path,Width,Surface,Difficulty,Gate?,RequiresJump,NameKey}]` — концы автоматически
  привязываются к основной дороге; `Gate` задаёт цикл открыт/закрыт
- `ItemSpawnGroups[{At,Lateral[]}]`, `ShardGroups[{At,Count,Lateral,Spacing}]`
- `MovingElements` — Crane, Ring, Press, Bridge, Conveyor, Rail (анимируются сервером от серверного времени)
- `Decor[{Kind,At,Lateral,Scale,Color?,Height?}]` — виды см. `Builders/DecorBuilder.luau`
- `Atmosphere` — цвета неба/тумана/земли/стен, ClockTime, Brightness, Glow
- `CameraZones`, `AudioZones`, `SpectatorCameras`, `SupportedModes`, `SupportedLapCounts`, `MirrorSupport`,
  `MinimapDetail`, `KnockoutGates`, `Landmarks`, `UniqueMechanic`

## Валидатор

`TrackValidator.ValidateDefinition` проверяет: метаданные, ≥6 точек, ≥4 чекпоинтов, grid ≥12, ширину,
известные поверхности, диапазоны, уникальные Id, ≥2 групп предметов, ≥1 альтернативный маршрут, уникальную
механику, режимы, длину круга 2500–9000 studs, порядок чекпоинтов, достижимость (каждые 10 studs позиция на
сплайне обязана локализоваться в коридор), grid и respawn на дороге, соединение шорткатов и их выигрыш
(не короче 55% сектора), кривизну для ботов. `ValidateModel` проверяет собранную модель: обязательные папки,
незакреплённые части (кроме `Dynamic`), посторонние скрипты. Bootstrap не стартует при ошибке.

## Практика

Целевая длина круга 4500–5500 studs даёт 55–65 с на круг для Normal-бота и 3-круговую гонку 3–4 минуты.
`tests/Integration/Balance.spec.luau` печатает время круга каждой трассы; используйте его при правке.
Зеркало (`MirrorSupport=true`) отражает X; проверьте, что декор не пересекает дорогу.
