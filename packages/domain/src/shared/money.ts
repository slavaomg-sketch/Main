/**
 * Деньги: только целые числа в минимальных единицах валюты (копейки).
 * Никаких float в расчётах.
 */
export type Minor = number;

export function assertMinor(value: number, label = 'amount'): asserts value is Minor {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} должен быть целым числом в копейках, получено ${value}`);
  }
}

export function formatRub(minor: Minor, opts: { withKopecks?: boolean } = {}): string {
  assertMinor(minor);
  const sign = minor < 0 ? '−' : '';
  const abs = Math.abs(minor);
  const rub = Math.floor(abs / 100);
  const kop = abs % 100;
  const rubStr = rub.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  if (opts.withKopecks || kop !== 0) {
    return `${sign}${rubStr},${kop.toString().padStart(2, '0')} ₽`;
  }
  return `${sign}${rubStr} ₽`;
}

/** Процент от суммы с округлением до копейки (банковское округление не нужно — используем half-up). */
export function percentOf(minor: Minor, percent: number): Minor {
  assertMinor(minor);
  return Math.round((minor * percent) / 100);
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce((acc, v) => {
    assertMinor(v);
    return acc + v;
  }, 0);
}

export function clampMinor(value: Minor, min: Minor, max: Minor): Minor {
  return Math.min(Math.max(value, min), max);
}

export function rubToMinor(rub: number): Minor {
  return Math.round(rub * 100);
}
