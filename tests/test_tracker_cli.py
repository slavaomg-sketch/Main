"""Командная строка и выбор способов уведомления."""

from __future__ import annotations

import pytest

from tracker import cli, notifiers as registry
from tracker.models import IN_PROGRESS, TripState
from tracker.providers import TrackerError
from tracker.store import TripStore

KEY = "e90be707-1875-4406-b66a-4a6fc1e6955e"
URL = f"https://dostavka.yandex.ru/route/{KEY}"


@pytest.fixture
def state_file(tmp_path):
    return str(tmp_path / "trips.json")


@pytest.fixture(autouse=True)
def offline_provider(monkeypatch):
    """CLI не должен ходить в сеть в тестах."""

    class Provider:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def fetch(self, key):
            return TripState(
                key=key,
                status=IN_PROGRESS,
                summary="Курьер едет к получателю: ~20 мин",
                eta_minutes=20,
                destination="Сколковская улица, 7Б",
            )

    monkeypatch.setattr(cli, "YandexDeliveryProvider", Provider)
    return Provider


@pytest.mark.parametrize(
    "values, expected",
    [
        (None, [5]),
        (["5"], [5]),
        (["5", "15"], [15, 5]),
        (["15,5"], [15, 5]),
        (["5", "5"], [5]),
        (["0"], [0]),
    ],
)
def test_parse_alerts(values, expected):
    assert cli.parse_alerts(values) == expected


@pytest.mark.parametrize("bad", [["пять"], ["-3"], ["5000"], [","]])
def test_parse_alerts_rejects_nonsense(bad):
    with pytest.raises(ValueError):
        cli.parse_alerts(bad)


def test_parse_notifier_names():
    assert registry.parse_names("reminders,telegram") == ["reminders", "telegram"]
    assert registry.parse_names(None, "console") == ["console"]
    assert registry.parse_names("ics, ics") == ["ics"]
    with pytest.raises(ValueError):
        registry.parse_names("почтовый голубь")


def test_add_stores_trip_with_chosen_interval(state_file, capsys):
    code = cli.main(
        ["--state", state_file, "add", URL, "--alert", "10", "--label", "Продукты", "--notify", "ics"]
    )

    assert code == 0
    trips = TripStore(state_file).load()
    assert len(trips) == 1
    assert trips[0].alerts == [10]
    assert trips[0].label == "Продукты"
    assert trips[0].notifiers == ["ics"]
    assert "Продукты" in capsys.readouterr().out


def test_add_accepts_several_intervals(state_file):
    cli.main(["--state", state_file, "add", URL, "--alert", "30", "--alert", "5"])
    assert TripStore(state_file).load()[0].alerts == [30, 5]


def test_add_rejects_bad_link(state_file, capsys):
    assert cli.main(["--state", state_file, "add", "https://example.com/route/abc"]) == 2
    assert "Ошибка" in capsys.readouterr().err


def test_add_rejects_bad_interval(state_file, capsys):
    assert cli.main(["--state", state_file, "add", URL, "--alert", "нисколько"]) == 2
    assert "Ошибка" in capsys.readouterr().err


def test_add_warns_when_reminder_needs_running_watcher(state_file, capsys):
    cli.main(["--state", state_file, "add", URL, "--notify", "console"])
    assert "tracker watch" in capsys.readouterr().out


def test_add_does_not_warn_for_standalone_notifiers(state_file, capsys):
    cli.main(["--state", state_file, "add", URL, "--notify", "ics"])
    assert "tracker watch" not in capsys.readouterr().out


def test_add_survives_unreachable_api(state_file, monkeypatch, capsys):
    class Broken:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def fetch(self, key):
            raise TrackerError("нет связи")

    monkeypatch.setattr(cli, "YandexDeliveryProvider", Broken)
    assert cli.main(["--state", state_file, "add", URL]) == 0
    assert "нет связи" in capsys.readouterr().err
    assert TripStore(state_file).load(), "ссылка всё равно должна сохраниться"


def test_list_remove_and_prune(state_file, capsys):
    cli.main(["--state", state_file, "add", URL, "--notify", "ics"])
    assert cli.main(["--state", state_file, "list"]) == 0
    assert URL in capsys.readouterr().out

    assert cli.main(["--state", state_file, "remove", URL]) == 0
    assert TripStore(state_file).load() == []

    assert cli.main(["--state", state_file, "list"]) == 0
    assert "Пока ничего" in capsys.readouterr().out


def test_remove_unknown_returns_error(state_file, capsys):
    assert cli.main(["--state", state_file, "remove", "нет-такого"]) == 1
    assert "Не нашёл" in capsys.readouterr().err


def test_status_prints_eta(state_file, capsys):
    assert cli.main(["--state", state_file, "status", URL]) == 0
    out = capsys.readouterr().out
    assert "20 мин" in out
    assert "Сколковская улица, 7Б" in out


def test_ics_command_writes_file(tmp_path, state_file, capsys):
    target = tmp_path / "delivery.ics"
    code = cli.main(
        ["--state", state_file, "ics", URL, "--alert", "7", "-o", str(target), "--label", "Суши"]
    )

    assert code == 0
    text = target.read_text(encoding="utf-8")
    assert "TRIGGER:-PT7M" in text
    assert "Суши" in text
    assert str(target) in capsys.readouterr().out


def test_watch_without_trips_complains(state_file, capsys):
    assert cli.main(["--state", state_file, "watch"]) == 1
    assert "Нечего отслеживать" in capsys.readouterr().out


def test_watch_once_runs_a_single_pass(state_file, capsys):
    cli.main(["--state", state_file, "add", URL, "--alert", "30", "--notify", "console"])
    assert cli.main(["--state", state_file, "watch", "--once"]) == 0
    # 30 минут порог, а ехать 20 — напоминание должно сработать сразу.
    assert "🔔" in capsys.readouterr().out
    assert TripStore(state_file).load()[0].fired == [30]
