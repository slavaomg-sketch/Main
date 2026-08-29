"""Интеграция с macOS: Напоминания, Календарь и баннеры уведомлений.

Всё делается через ``osascript``: значения передаются аргументами (``on run argv``),
поэтому кавычки и апострофы в адресах и именах курьеров ничего не ломают.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from ..eta import humanize
from ..models import Event, Trip, TripState, now_utc
from .base import Notifier

# Не дёргаем AppleScript, если время прибытия сдвинулось меньше чем на минуту.
RESCHEDULE_THRESHOLD_SECONDS = 60
EVENT_LENGTH_MINUTES = 15


class AppleScriptError(RuntimeError):
    pass


def macos_available() -> tuple[bool, str]:
    if sys.platform != "darwin":
        return False, "работает только на macOS"
    if not shutil.which("osascript"):
        return False, "не найден osascript"
    return True, ""


def run_osascript(script: str, *args: str, timeout: float = 20.0) -> str:
    """Выполняет AppleScript, передавая значения в argv."""
    try:
        result = subprocess.run(
            ["osascript", "-", *args],
            input=script,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:  # pragma: no cover - среда
        raise AppleScriptError(str(exc)) from exc
    if result.returncode != 0:
        raise AppleScriptError((result.stderr or "").strip() or "osascript вернул ошибку")
    return result.stdout.strip()


def _offset_seconds(moment: datetime) -> int:
    return int((moment - now_utc()).total_seconds())


def _local(moment: datetime) -> datetime:
    return moment.astimezone()


def _body(trip: Trip, state: TripState) -> str:
    parts = []
    if state.destination:
        parts.append(f"Адрес: {state.destination}")
    if state.performer or state.vehicle:
        who = " · ".join(part for part in (state.performer, state.vehicle) if part)
        parts.append(f"Курьер: {who}")
    arrival = state.arrival_at
    if arrival:
        parts.append(f"Прибытие ~{_local(arrival).strftime('%H:%M')}")
    parts.append(trip.url)
    return "\n".join(parts)


_CREATE_REMINDER = """
on run argv
    set theName to item 1 of argv
    set theBody to item 2 of argv
    set theOffset to (item 3 of argv) as integer
    set listName to item 4 of argv
    tell application "Reminders"
        if listName is "" then
            set targetList to default list
        else
            set targetList to list listName
        end if
        set theReminder to make new reminder at end of targetList with properties ¬
            {name:theName, body:theBody, remind me date:((current date) + theOffset)}
        return id of theReminder
    end tell
end run
"""

_UPDATE_REMINDER = """
on run argv
    set theId to item 1 of argv
    set theName to item 2 of argv
    set theBody to item 3 of argv
    set theOffset to (item 4 of argv) as integer
    tell application "Reminders"
        set matches to (every reminder whose id is theId)
        if (count of matches) is 0 then return "missing"
        set theReminder to item 1 of matches
        set name of theReminder to theName
        set body of theReminder to theBody
        set remind me date of theReminder to ((current date) + theOffset)
        return "ok"
    end tell
end run
"""

_DELETE_REMINDER = """
on run argv
    set theId to item 1 of argv
    tell application "Reminders"
        set matches to (every reminder whose id is theId)
        if (count of matches) is 0 then return "missing"
        delete (item 1 of matches)
        return "ok"
    end tell
end run
"""


class RemindersNotifier(Notifier):
    """Кладёт напоминание в Apple Напоминания за N минут до прибытия.

    Напоминание живёт своей жизнью: даже если закрыть трекер, iPhone
    (через iCloud) всё равно поднимет сигнал в назначенное время.
    """

    name = "reminders"

    def __init__(self, list_name: str | None = None) -> None:
        self.list_name = list_name if list_name is not None else os.getenv("TRACKER_REMINDERS_LIST", "")
        self.available, self.unavailable_reason = macos_available()

    def sync(self, trip: Trip, state: TripState) -> None:
        arrival = state.arrival_at
        if not self.available or arrival is None or not state.active:
            return

        for alert in sorted(trip.alerts, reverse=True):
            due = arrival - timedelta(minutes=alert)
            slot = f"reminders:{alert}"
            title = f"{trip.title}: курьер через {humanize(alert)}"
            body = _body(trip, state)

            existing_id = trip.external.get(slot)
            if existing_id:
                if not self._needs_move(trip, slot, due):
                    continue
                answer = self._safe(
                    _UPDATE_REMINDER, existing_id, title, body, str(_offset_seconds(due))
                )
                if answer == "ok":
                    trip.external[f"{slot}:due"] = due.isoformat()
                    continue
                # Напоминание удалили руками — создадим заново.
                trip.external.pop(slot, None)

            if due < now_utc() - timedelta(minutes=1):
                # Этот порог уже прошёл, новое напоминание было бы сразу просроченным.
                continue
            new_id = self._safe(_CREATE_REMINDER, title, body, str(_offset_seconds(due)), self.list_name)
            if new_id:
                trip.external[slot] = new_id
                trip.external[f"{slot}:due"] = due.isoformat()

    def cancel(self, trip: Trip) -> None:
        if not self.available:
            return
        for slot in [key for key in trip.external if key.startswith("reminders:") and not key.endswith(":due")]:
            self._safe(_DELETE_REMINDER, trip.external[slot])
            trip.external.pop(slot, None)
            trip.external.pop(f"{slot}:due", None)

    def _needs_move(self, trip: Trip, slot: str, due: datetime) -> bool:
        previous = trip.external.get(f"{slot}:due")
        if not previous:
            return True
        try:
            planned = datetime.fromisoformat(previous)
        except ValueError:
            return True
        if planned.tzinfo is None:
            planned = planned.replace(tzinfo=timezone.utc)
        return abs((planned - due).total_seconds()) >= RESCHEDULE_THRESHOLD_SECONDS

    def _safe(self, script: str, *args: str) -> str:
        try:
            return run_osascript(script, *args)
        except AppleScriptError as exc:
            print(f"[reminders] не получилось: {exc}", file=sys.stderr)
            return ""


_CREATE_EVENT = """
on run argv
    set theTitle to item 1 of argv
    set theBody to item 2 of argv
    set theOffset to (item 3 of argv) as integer
    set theLength to (item 4 of argv) as integer
    set calName to item 5 of argv
    if (count of argv) < 6 then
        set alarmList to {}
    else
        set alarmList to items 6 thru (count of argv) of argv
    end if
    tell application "Calendar"
        if calName is "" then
            set theCalendar to first calendar whose writable is true
        else
            set theCalendar to calendar calName
        end if
        tell theCalendar
            set startDate to (current date) + theOffset
            set newEvent to make new event with properties ¬
                {summary:theTitle, description:theBody, ¬
                 start date:startDate, end date:(startDate + theLength * minutes)}
            repeat with rawMinutes in alarmList
                tell newEvent
                    make new display alarm at end with properties ¬
                        {trigger interval:-((rawMinutes as string) as integer)}
                end tell
            end repeat
            return uid of newEvent
        end tell
    end tell
end run
"""

_DELETE_EVENT = """
on run argv
    set theUid to item 1 of argv
    tell application "Calendar"
        repeat with theCalendar in calendars
            tell theCalendar
                set matches to (every event whose uid is theUid)
                if (count of matches) > 0 then
                    delete (item 1 of matches)
                    return "ok"
                end if
            end tell
        end repeat
        return "missing"
    end tell
end run
"""


class CalendarNotifier(Notifier):
    """Заводит событие в Календаре с будильниками за каждый выбранный интервал."""

    name = "calendar"

    def __init__(self, calendar_name: str | None = None) -> None:
        self.calendar_name = (
            calendar_name if calendar_name is not None else os.getenv("TRACKER_CALENDAR", "")
        )
        self.available, self.unavailable_reason = macos_available()

    def sync(self, trip: Trip, state: TripState) -> None:
        arrival = state.arrival_at
        if not self.available or arrival is None or not state.active:
            return

        if trip.external.get("calendar:uid"):
            if not self._needs_move(trip, arrival):
                return
            # Календарь не даёт аккуратно переписать будильники — пересоздаём событие.
            self._safe(_DELETE_EVENT, trip.external["calendar:uid"])
            trip.external.pop("calendar:uid", None)

        alarms = [str(int(alert)) for alert in sorted(trip.alerts, reverse=True)]
        uid = self._safe(
            _CREATE_EVENT,
            f"{trip.title}: прибытие курьера",
            _body(trip, state),
            str(_offset_seconds(arrival)),
            str(EVENT_LENGTH_MINUTES),
            self.calendar_name,
            *alarms,
        )
        if uid:
            trip.external["calendar:uid"] = uid
            trip.external["calendar:start"] = arrival.isoformat()

    def cancel(self, trip: Trip) -> None:
        uid = trip.external.pop("calendar:uid", None)
        trip.external.pop("calendar:start", None)
        if uid and self.available:
            self._safe(_DELETE_EVENT, uid)

    def _needs_move(self, trip: Trip, arrival: datetime) -> bool:
        previous = trip.external.get("calendar:start")
        if not previous:
            return True
        try:
            planned = datetime.fromisoformat(previous)
        except ValueError:
            return True
        if planned.tzinfo is None:
            planned = planned.replace(tzinfo=timezone.utc)
        return abs((planned - arrival).total_seconds()) >= RESCHEDULE_THRESHOLD_SECONDS

    def _safe(self, script: str, *args: str) -> str:
        try:
            return run_osascript(script, *args)
        except AppleScriptError as exc:
            print(f"[calendar] не получилось: {exc}", file=sys.stderr)
            return ""


_NOTIFICATION = """
on run argv
    display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"
end run
"""


class MacNotificationNotifier(Notifier):
    """Обычный баннер macOS — работает, только пока трекер запущен."""

    name = "banner"

    def __init__(self) -> None:
        self.available, self.unavailable_reason = macos_available()

    def push(self, event: Event) -> None:
        if not self.available:
            return
        body = event.body.splitlines()[0] if event.body else ""
        try:
            run_osascript(_NOTIFICATION, event.title[:120], body[:200])
        except AppleScriptError as exc:
            print(f"[banner] не получилось: {exc}", file=sys.stderr)

    def cancel(self, trip: Trip) -> None:  # pragma: no cover - нечего отменять
        return None
