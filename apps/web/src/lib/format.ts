export { formatRub } from '@techmatch/domain/shared/money';

export function formatDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  return new Intl.DateTimeFormat('ru-RU', opts).format(typeof d === 'string' ? new Date(d) : d);
}

export function formatDateTime(d: Date | string): string {
  return formatDate(d, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function reviewsLabel(n: number) {
  return `${n} ${plural(n, ['отзыв', 'отзыва', 'отзывов'])}`;
}
