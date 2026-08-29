"""Командная строка трекера доставок.

    python -m tracker add https://dostavka.yandex.ru/route/<id> --alert 5 --notify reminders --watch
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import notifiers as notifiers_registry
from .eta import humanize
from .models import Trip
from .notifiers.icsfile import IcsNotifier, build_ics, describe
from .providers import TrackerError, YandexDeliveryProvider, normalize_url, parse_key
from .store import DEFAULT_PATH, TripStore
from .watcher import Watcher

DEFAULT_ALERTS = os.getenv("TRACKER_ALERTS", "5")
DEFAULT_NOTIFIERS = os.getenv("TRACKER_NOTIFIERS", "console")


def parse_alerts(values: list[str] | None) -> list[int]:
    """['5', '15,30'] -> [30, 15, 5]; проверяет, что это разумные минуты."""
    raw = values or [DEFAULT_ALERTS]
    minutes: set[int] = set()
    for value in raw:
        for chunk in str(value).replace(";", ",").split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                number = int(chunk)
            except ValueError:
                raise ValueError(f"'{chunk}' — не количество минут")
            if not 0 <= number <= 24 * 60:
                raise ValueError(f"{number}: интервал должен быть от 0 до 1440 минут")
            minutes.add(number)
    if not minutes:
        raise ValueError("Нужен хотя бы один интервал напоминания")
    return sorted(minutes, reverse=True)


def _store(args) -> TripStore:
    return TripStore(Path(args.state))


def _describe_notifiers(names: list[str]) -> str:
    parts = []
    for notifier in notifiers_registry.build(names):
        mark = "" if notifier.available else f" (недоступно: {notifier.unavailable_reason})"
        parts.append(f"{notifier.name}{mark}")
    return ", ".join(parts)


def cmd_add(args) -> int:
    try:
        url = normalize_url(args.url)
        key = parse_key(url)
        alerts = parse_alerts(args.alert)
        names = notifiers_registry.parse_names(args.notify, DEFAULT_NOTIFIERS)
    except (TrackerError, ValueError) as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 2

    trip = Trip(key=key, url=url, label=args.label or "", alerts=alerts, notifiers=names)
    store = _store(args)
    store.add(trip)

    print(f"Отслеживаю: {trip.title}")
    print(f"  ссылка:      {url}")
    print(f"  напомню за:  {', '.join(humanize(a) for a in alerts)} до прибытия")
    print(f"  уведомления: {_describe_notifiers(names)}")

    provider = YandexDeliveryProvider()
    try:
        state = provider.fetch(key)
    except TrackerError as exc:
        print(f"  внимание: {exc}", file=sys.stderr)
    else:
        print(f"  сейчас:      {state.headline()}")

    if args.watch:
        return cmd_watch(args)

    if not any(name in notifiers_registry.STANDALONE for name in names):
        print("\nЧтобы напоминания сработали, оставьте запущенным: python -m tracker watch")
    return 0


def cmd_list(args) -> int:
    trips = _store(args).load()
    if not trips:
        print("Пока ничего не отслеживается.")
        return 0
    for trip in trips:
        mark = "✅" if trip.done else "•"
        alerts = ", ".join(humanize(a) for a in sorted(trip.alerts, reverse=True))
        print(f"{mark} {trip.id}  {trip.title}")
        print(f"    {trip.url}")
        print(f"    напоминания за: {alerts} | способ: {', '.join(trip.notifiers)}")
        if trip.last_summary:
            print(f"    последнее состояние: {trip.last_summary}")
    return 0


def cmd_remove(args) -> int:
    removed = _store(args).remove(args.trip)
    if removed is None:
        print(f"Не нашёл поездку '{args.trip}'.", file=sys.stderr)
        return 1
    for notifier in notifiers_registry.build(removed.notifiers):
        notifier.cancel(removed)
    print(f"Убрал из отслеживания: {removed.title}")
    return 0


def cmd_prune(args) -> int:
    removed = _store(args).prune()
    print(f"Удалено завершённых поездок: {removed}")
    return 0


def cmd_status(args) -> int:
    try:
        key = parse_key(args.url)
        state = YandexDeliveryProvider().fetch(key)
    except TrackerError as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 2

    print(state.headline())
    if state.description:
        print(state.description)
    if state.destination:
        print(f"Адрес: {state.destination}")
    if state.performer or state.vehicle:
        print("Курьер: " + " · ".join(p for p in (state.performer, state.vehicle) if p))
    if state.eta_minutes is not None:
        arrival = state.arrival_at
        print(f"Осталось: {humanize(state.eta_minutes)} (примерно к {arrival.astimezone():%H:%M})")
    print(f"Статус: {state.status}")
    return 0


def cmd_ics(args) -> int:
    try:
        url = normalize_url(args.url)
        key = parse_key(url)
        alerts = parse_alerts(args.alert)
        state = YandexDeliveryProvider().fetch(key)
    except (TrackerError, ValueError) as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 2

    if state.arrival_at is None:
        print("Яндекс пока не сообщает время прибытия — событие делать не из чего.", file=sys.stderr)
        return 1

    trip = Trip(key=key, url=url, label=args.label or "", alerts=alerts)
    path = Path(args.output) if args.output else IcsNotifier().path_for(trip)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        build_ics(
            uid=f"{trip.id}@taxi-tracker",
            title=f"{trip.title}: прибытие курьера",
            description=describe(trip, state),
            url=url,
            arrival=state.arrival_at,
            alerts=alerts,
        ),
        encoding="utf-8",
    )
    print(f"Готово: {path}")
    print("Откройте файл на iPhone (почта, Телеграм, iCloud) — событие добавится в Календарь.")
    return 0


def cmd_watch(args) -> int:
    store = _store(args)
    trips = store.active()
    if not trips:
        print("Нечего отслеживать. Сначала: python -m tracker add <ссылка>")
        return 1

    names: list[str] = []
    for trip in trips:
        for name in trip.notifiers:
            if name not in names:
                names.append(name)
    built = notifiers_registry.build(names)

    print(f"Слежу за поездками: {len(trips)}. Уведомления: {_describe_notifiers(names)}")
    print("Остановить — Ctrl+C.")

    watcher = Watcher(store, built, provider=YandexDeliveryProvider())
    try:
        watcher.run(iterations=1 if args.once else None)
    except KeyboardInterrupt:
        print("\nОстановлено.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tracker",
        description="Отслеживает доставку по ссылке Яндекса и напоминает за N минут до прибытия.",
    )
    parser.add_argument(
        "--state",
        default=str(DEFAULT_PATH),
        help=f"файл со списком поездок (по умолчанию {DEFAULT_PATH})",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    notify_help = "через что напоминать: " + "; ".join(
        f"{name} — {text}" for name, text in notifiers_registry.DESCRIPTIONS.items()
    )

    add = sub.add_parser("add", help="взять ссылку в отслеживание")
    add.add_argument("url", help="ссылка вида https://dostavka.yandex.ru/route/<id>")
    add.add_argument(
        "--alert",
        action="append",
        metavar="МИНУТЫ",
        help=f"за сколько минут напомнить; можно несколько (по умолчанию {DEFAULT_ALERTS})",
    )
    add.add_argument("--label", help="как назвать поездку в напоминании")
    add.add_argument("--notify", help=notify_help)
    add.add_argument("--watch", action="store_true", help="сразу начать следить")
    add.add_argument("--once", action="store_true", help=argparse.SUPPRESS)
    add.set_defaults(func=cmd_add)

    listing = sub.add_parser("list", help="показать отслеживаемые поездки")
    listing.set_defaults(func=cmd_list)

    remove = sub.add_parser("remove", help="убрать поездку из отслеживания")
    remove.add_argument("trip", help="id из `list`, ссылка или идентификатор поездки")
    remove.set_defaults(func=cmd_remove)

    prune = sub.add_parser("prune", help="почистить завершённые поездки")
    prune.set_defaults(func=cmd_prune)

    status = sub.add_parser("status", help="разово показать, где курьер")
    status.add_argument("url", help="ссылка отслеживания")
    status.set_defaults(func=cmd_status)

    ics = sub.add_parser("ics", help="сделать .ics с будильниками для календаря")
    ics.add_argument("url", help="ссылка отслеживания")
    ics.add_argument("--alert", action="append", metavar="МИНУТЫ", help="за сколько минут")
    ics.add_argument("--label", help="название события")
    ics.add_argument("-o", "--output", help="куда сохранить файл")
    ics.set_defaults(func=cmd_ics)

    watch = sub.add_parser("watch", help="следить за всеми поездками и напоминать")
    watch.add_argument("--once", action="store_true", help="один проход и выход")
    watch.set_defaults(func=cmd_watch)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
