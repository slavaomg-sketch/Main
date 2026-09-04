# Asset Manifest

Все визуальные ассеты в alpha — процедурные примитивы (Part/WedgePart/Cylinder/Ball с материалами Roblox),
собранные кодом. Внешних моделей, текстур, мешей и Creator Store-ассетов нет. Скриптов внутри контента нет.

| Ассет | Назначение | Источник | Asset ID | Автор | Лицензия | Модифицирован | Скрипты | Заменяем |
|---|---|---|---|---|---|---|---|---|
| Трассы ×6 | гоночные круги | `Builders/TrackBuilder.luau` + `DecorBuilder.luau` из `TrackDefinitions` | — | проект | оригинал | — | нет | да, через World/Builders |
| Арены ×2 | боевые режимы | `Builders/ArenaBuilder.luau` | — | проект | оригинал | — | нет | да |
| Машины ×8 | карт/багги/ховер/трайк/болид | `Builders/VehicleBuilder.luau` из `VehicleDefinitions.Visual` | — | проект | оригинал | — | нет | да (силуэты/цвета/колёса в данных) |
| Герои ×8 | сидячие фигуры | `Builders/HeroBuilder.luau` из `HeroCosmetics` | — | проект | оригинал | — | нет | да |
| Пикапы | item pad, energy shard | `Builders/PickupBuilder.luau` | — | проект | оригинал | — | нет | да |
| Снаряды/ловушки | визуал предметов | `RobloxWorld.SpawnProjectileVisual` | — | проект | оригинал | — | нет | да |
| VFX | ParticleEmitter/Trail/Highlight без текстур | `Controllers/VFXController.luau` | — | проект | оригинал | — | нет | да |
| UI | процедурный UI, шрифты Gotham (встроены в Roblox) | `UI/*` | — | проект | Roblox built-in font | — | нет | да |
| Звуки/музыка | все ключи в `AudioConfig` | placeholder `rbxassetid://0` (тишина) | 0 | — | не лицензированы, не подключены | — | — | да, один файл |

Перед публичным релизом: заменить аудио-плейсхолдеры на оригинальные/лицензированные записи (указать ID,
автора, лицензию здесь), при использовании мешей из Creator Store — записать Asset ID, автора, лицензию,
проверить отсутствие скриптов и количество полигонов.
