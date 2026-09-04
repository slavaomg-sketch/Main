# Implementation Status

## Работает и проверено headless (Lune)
Серверный цикл целиком: лобби, профили (DataStore backend с session lock, миграции, temporary), группы,
очередь/matchmaking (local + MemoryStore/teleport flow), голосование, загрузка, loadout lock, сетка, отсчёт,
стартовый буст, круги/чекпоинты/позиции, предметы (12) и осколки, снаряды/ловушки/хазарды, попадания/щиты/фаза,
slipstream, дрифт/трюки (валидация намерений), респавн, боты Easy/Normal/Hard с ограниченным rubber band,
режимы Quick/Grand Tour/Time Trial (призрак)/Custom/Knockout/Team/Core Clash/Shard Rush/Practice,
результаты, идемпотентные награды, разблокировки, сохранение, безопасность (схемы, лимиты, валидация физики,
suspicion/kick), контент (8/8/6/2/12, EN/RU), валидатор трасс.

## Написано, типизировано, не запускалось в Studio
Клиент полностью: KartController (raycast-подвеска, тяга, руление, дрифт, трюки, стан, респавн, Track Assist),
камера, HUD/миникарта/тач-контролы, все экраны меню, гараж, обучение, VFX, аудио (плейсхолдеры), spectator,
ghost playback. Процедурные билдеры трасс/арен/машин/героев/пикапов и `RobloxWorld`.
Рекомендуемый первый playtest: `rojo build`, Studio → 2 клиента → Quick Play. Ожидаемые точки настройки:
жёсткость/демпфирование подвески (`GameConfig.Physics`), `AlignOrientation` торк, коэффициент Grip.

## Ограничения alpha
- Аудио — тишина до лицензирования (AudioConfig).
- Selene не запускается офлайн; StyLua и luau-analyze работают.
- Noclip-эвристика `CheckWallCrossing` не включена в цикл.
- Нет playtest-евиденса из Studio (скриншотов/FPS). Studio MCP в среде недоступен.
- 16/24 участников — только headless-эксперимент; MaxRacers = 12.

## Definition of Done (сверка с ТЗ)
Выполнено кодом и тестами: 2–31, 35–39 (headless), 43–47. Требуют Studio-прогона: 1, 32–34, 36, 40–42.

## Ровно одно следующее действие владельца
Открыть `build/RiftRacers.rbxlx` (или `rojo serve`) в Roblox Studio и запустить Test → Clients and Servers на
2 клиентах — это даст первый реальный playtest клиентской физики и UI, которые здесь невозможно было запустить.
