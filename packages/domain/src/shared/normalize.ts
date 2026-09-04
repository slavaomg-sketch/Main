import { transliterate } from './slug.js';

/** Частые русские написания брендов и терминов → канонические английские. */
const WORD_SYNONYMS: Array<[RegExp, string]> = [
  [/\bайфон[а-я]*\b/g, 'iphone'],
  [/\bэпл\b|\bэппл\b|\bапл\b/g, 'apple'],
  [/\bмакбук[а-я]*\b/g, 'macbook'],
  [/\bэйр\b|\bаир\b/g, 'air'],
  [/\bпро\b/g, 'pro'],
  [/\bмакс\b/g, 'max'],
  [/\bмини\b/g, 'mini'],
  [/\bплюс\b/g, 'plus'],
  [/\bультра\b/g, 'ultra'],
  [/\bайпад[а-я]*\b/g, 'ipad'],
  [/\bайпод[а-я]*\b|\bэйрпод[а-я]*\b|\bаирпод[а-я]*\b/g, 'airpods'],
  [/\bэпл\s*вотч\b|\bапл\s*вотч\b|\bвотч\b/g, 'watch'],
  [/\bсамсунг[а-я]*\b/g, 'samsung'],
  [/\bгалакси\b|\bгэлакси\b|\bгелакси\b/g, 'galaxy'],
  [/\bсяоми\b|\bксиаоми\b|\bксяоми\b/g, 'xiaomi'],
  [/\bредми\b/g, 'redmi'],
  [/\bпиксель\b|\bпиксел\b/g, 'pixel'],
  [/\bгугл\b/g, 'google'],
  [/\bкэнон\b|\bканон\b/g, 'canon'],
  [/\bпиксма\b/g, 'pixma'],
  [/\bэпсон\b/g, 'epson'],
  [/\bбразер\b/g, 'brother'],
  [/\bсони\b/g, 'sony'],
  [/\bплейстейшн\b|\bплейстейшен\b|\bплойка\b|\bпс\b/g, 'playstation'],
  [/\bиксбокс\b|\bхбокс\b/g, 'xbox'],
  [/\bнинтендо\b/g, 'nintendo'],
  [/\bсвитч\b|\bсвич\b/g, 'switch'],
  [/\bстим\s*дек\b/g, 'steam deck'],
  [/\bделл\b/g, 'dell'],
  [/\bленово\b/g, 'lenovo'],
  [/\bтинкпад\b/g, 'thinkpad'],
  [/\bгопро\b/g, 'gopro'],
  [/\bхуавей\b/g, 'huawei'],
  [/\bпринтер\b/g, 'printer'],
  [/\bноутбук\b/g, 'laptop'],
  [/\bтелефон\b|\bсмартфон\b/g, 'phone'],
  [/\bнаушники\b/g, 'headphones'],
  [/\bчасы\b/g, 'watch'],
  [/\bпланшет\b/g, 'tablet'],
];

const LATIN_ALIASES: Array<[RegExp, string]> = [
  [/\bi\s*phone\b/g, 'iphone'],
  [/\bmac\s*book\b/g, 'macbook'],
  [/\bi\s*pad\b/g, 'ipad'],
  [/\bair\s*pods\b/g, 'airpods'],
  [/\bapple\s*watch\b/g, 'watch'],
  [/\bps\s*5\b|\bps5\b|\bplaystation\s*5\b/g, 'playstation 5'],
  [/\bps\s*4\b|\bps4\b/g, 'playstation 4'],
  [/\bgen(eration)?\b/g, 'gen'],
  [/\bм2\b/g, 'm2'],
  [/\bм1\b/g, 'm1'],
  [/\bм3\b/g, 'm3'],
  [/\bм4\b/g, 'm4'],
];

/**
 * Нормализация свободного запроса пользователя для поиска устройств:
 * нижний регистр, ё→е, русские названия брендов → английские,
 * удаление пунктуации, разделение букв и цифр ("iphone15pro" → "iphone 15 pro").
 */
export function normalizeDeviceQuery(input: string): string {
  let s = input.toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`]/g, ' ');
  for (const [re, rep] of WORD_SYNONYMS) s = s.replace(re, rep);
  s = s.replace(/[-_/\\.,()+]/g, ' ');
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
  for (const [re, rep] of LATIN_ALIASES) s = s.replace(re, rep);
  s = transliterate(s);
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "iphone 15 pro max" — стабилизируем известные последовательности
  s = s.replace(/\bpro max\b/g, 'pro max');
  return s;
}

export function normalizeIdentifier(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeSearchText(parts: Array<string | null | undefined>): string {
  return Array.from(new Set(parts.filter(Boolean).map((p) => normalizeDeviceQuery(p as string)))).join(' ');
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}
