"""Самодиагностика подключений к маркетплейсам.

    python -m dashboard.diagnose
    python -m dashboard.diagnose --days 7 --marketplace ozon

Команда выполняет те же запросы, что и коннекторы панели, вашими ключами
и на вашей машине, а печатает только структуру ответа: код ответа, число
строк, имена полей и «форму» значений (даты превращаются в 9999-99-99).

Ни ключи, ни суммы, ни названия товаров в вывод не попадают — отчёт можно
безопасно переслать тому, кто помогает настраивать интеграцию. Если нужны
настоящие значения, добавьте --values и смотрите вывод сами.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import date, timedelta
from typing import Any

from .config import Settings, load_settings
from .connectors import MARKETPLACE_ORDER, REAL_CONNECTORS
from .connectors.base import Probe
from .models import Period

MAX_FIELDS = 30
MAX_SHAPE = 40


def secret_values(config: Settings) -> list[str]:
    """Все непустые значения ключей — их нужно вымарывать из вывода."""
    values: list[str] = []
    for credentials in config.marketplaces.values():
        for value in credentials.values.values():
            if value and len(value) >= 6:
                values.append(value)
    return sorted(values, key=len, reverse=True)


def mask(text: str, secrets: list[str]) -> str:
    """Заменить ключи в тексте на «хвост» — по нему видно, какой это ключ."""
    for secret in secrets:
        text = text.replace(secret, "••••" + secret[-4:])
    return text


def shape(value: Any) -> str:
    """Форма значения без самого значения: 2025-03-01 → 9999-99-99."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "да/нет"
    if isinstance(value, (int, float)):
        return "число"
    if isinstance(value, list):
        return f"список[{len(value)}]"
    if isinstance(value, dict):
        keys = ", ".join(list(value)[:5])
        return f"объект{{{keys}}}"

    text = str(value)[:MAX_SHAPE]
    masked = []
    for char in text:
        if char.isdigit():
            masked.append("9")
        elif char.isalpha():
            masked.append("x")
        else:
            masked.append(char)
    return "«" + "".join(masked) + "»"


def describe_rows(rows: list[dict[str, Any]]) -> list[str]:
    """Имена полей и форма их значений по первым строкам ответа."""
    shapes: dict[str, str] = {}
    for row in rows[:20]:
        for key, value in row.items():
            if key not in shapes or shapes[key] == "null":
                shapes[key] = shape(value)
    lines = []
    for key in sorted(shapes)[:MAX_FIELDS]:
        lines.append(f"        {key}: {shapes[key]}")
    if len(shapes) > MAX_FIELDS:
        lines.append(f"        … ещё {len(shapes) - MAX_FIELDS} полей")
    return lines


def describe_probe(probe: Probe, secrets: list[str], with_values: bool) -> list[str]:
    head = f"    {probe.label}"
    if probe.error:
        return [f"{head}  →  ОШИБКА {probe.status or ''}".rstrip(),
                f"        {mask(probe.error, secrets)}"]

    payload = probe.payload
    if isinstance(payload, list):
        lines = [f"{head}  →  {probe.status} · строк: {len(payload)}"]
        if not payload:
            lines.append("        пусто — за этот период данных нет")
            return lines
        lines.extend(describe_rows(payload))
        if with_values:
            sample = json.dumps(payload[0], ensure_ascii=False, indent=2)[:1500]
            lines.append("        пример строки:")
            lines.extend("        " + line for line in mask(sample, secrets).splitlines())
        return lines

    return [f"{head}  →  {probe.status} · {shape(payload)}"]


async def check(code: str, period: Period, config: Settings, with_values: bool) -> list[str]:
    credentials = config.marketplaces[code]
    lines = [f"\n{credentials.title}"]

    missing = [key for key in credentials.required if not credentials.get(key)]
    if missing:
        lines.append(f"    ключи не заданы ({', '.join(missing)}) — площадка работает на демо-данных")
        return lines

    filled = ", ".join(
        f"{key}=••••{credentials.get(key)[-4:]}" for key in credentials.required
    )
    lines.append(f"    ключи: {filled}")

    connector = REAL_CONNECTORS[code](credentials)
    secrets = secret_values(config)

    probes = await connector.probe(period)
    for probe in probes:
        lines.extend(describe_probe(probe, secrets, with_values))

    # Что коннектор сумел собрать из этих ответов — только счётчики, без сумм.
    report = await connector.safe_fetch(period)
    if report.error:
        lines.append(f"    разбор ответа: ОШИБКА — {mask(report.error, secrets)}")
    else:
        lines.append(
            "    разбор ответа: "
            f"точек графика {len(report.series)}, "
            f"товаров {len(report.products)}, "
            f"заказов {'есть' if report.orders else 'нет'}, "
            f"выручка {'посчитана' if report.revenue else 'нулевая'}, "
            f"остатки {'есть' if report.stock_units else 'нет'}"
        )
        if with_values:
            lines.append(
                f"    значения: выручка {report.revenue:.2f}, заказов {report.orders}, "
                f"товаров продано {report.units}"
            )
    return lines


async def run(days: int, only: str | None, with_values: bool) -> str:
    config = load_settings()
    today = date.today()
    period = Period(
        date_from=today - timedelta(days=days - 1),
        date_to=today,
        preset=f"{days}d",
    )

    codes = [only] if only else list(MARKETPLACE_ORDER)
    unknown = [code for code in codes if code not in MARKETPLACE_ORDER]
    if unknown:
        return f"Неизвестная площадка: {', '.join(unknown)}. Доступны: {', '.join(MARKETPLACE_ORDER)}"

    lines = [
        "Диагностика подключений к маркетплейсам",
        f"Период: {period.date_from} — {period.date_to} ({period.days} дн.)",
        "Ключи в выводе замаскированы, значения показаны как форма (9999-99-99).",
    ]
    if config.force_demo:
        lines.append("ВНИМАНИЕ: DASHBOARD_DEMO=1 — панель всё равно покажет демо-данные.")

    results = await asyncio.gather(
        *(check(code, period, config, with_values) for code in codes)
    )
    for result in results:
        lines.extend(result)

    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Проверить ключи маркетплейсов и посмотреть, что отдаёт их API."
    )
    parser.add_argument("--days", type=int, default=30, help="за сколько дней запрашивать (по умолчанию 30)")
    parser.add_argument("--marketplace", help="проверить одну площадку: wildberries, ozon, yandex, ali")
    parser.add_argument(
        "--values",
        action="store_true",
        help="показать настоящие значения (вывод станет непубличным)",
    )
    args = parser.parse_args()
    print(asyncio.run(run(max(args.days, 1), args.marketplace, args.values)))


if __name__ == "__main__":
    main()
