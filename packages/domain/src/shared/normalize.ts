import { transliterate } from './slug.js';

/** Частые русские написания брендов и терминов → канонические английские. */
const B_LEFT = '(?<![а-яёa-z0-9])';
const B_RIGHT = '(?![а-яёa-z0-9])';
/** Регулярка со «словесными» границами, работающими для кириллицы. */
function cy(pattern: string): RegExp {
  return new RegExp(B_LEFT + '(?:' + pattern + ')' + B_RIGHT, 'g');
}

const WORD_SYNONYMS: Array<[RegExp, string]> = [
  [cy(String.raw`айфон[а-я]*`), 'iphone'],
  [cy(String.raw`эпл|эппл|апл`), 'apple'],
  [cy(String.raw`макбук[а-я]*`), 'macbook'],
  [cy(String.raw`эйр|аир`), 'air'],
  [cy(String.raw`про`), 'pro'],
  [cy(String.raw`макс`), 'max'],
  [cy(String.raw`мини`), 'mini'],
  [cy(String.raw`плюс`), 'plus'],
  [cy(String.raw`ультра`), 'ultra'],
  [cy(String.raw`айпад[а-я]*`), 'ipad'],
  [cy(String.raw`айпод[а-я]*|эйрпод[а-я]*|аирпод[а-я]*`), 'airpods'],
  [cy(String.raw`эпл\s*вотч|апл\s*вотч|вотч`), 'watch'],
  [cy(String.raw`самсунг[а-я]*`), 'samsung'],
  [cy(String.raw`галакси|гэлакси|гелакси`), 'galaxy'],
  [cy(String.raw`сяоми|ксиаоми|ксяоми`), 'xiaomi'],
  [cy(String.raw`редми`), 'redmi'],
  [cy(String.raw`пиксель|пиксел`), 'pixel'],
  [cy(String.raw`гугл`), 'google'],
  [cy(String.raw`кэнон|канон`), 'canon'],
  [cy(String.raw`пиксма`), 'pixma'],
  [cy(String.raw`эпсон`), 'epson'],
  [cy(String.raw`бразер`), 'brother'],
  [cy(String.raw`сони`), 'sony'],
  [cy(String.raw`плейстейшн|плейстейшен|плойка|пс`), 'playstation'],
  [cy(String.raw`иксбокс|хбокс`), 'xbox'],
  [cy(String.raw`нинтендо`), 'nintendo'],
  [cy(String.raw`свитч|свич`), 'switch'],
  [cy(String.raw`стим\s*дек`), 'steam deck'],
  [cy(String.raw`делл`), 'dell'],
  [cy(String.raw`леново`), 'lenovo'],
  [cy(String.raw`тинкпад`), 'thinkpad'],
  [cy(String.raw`гопро`), 'gopro'],
  [cy(String.raw`хуавей`), 'huawei'],
  [cy(String.raw`принтер`), 'printer'],
  [cy(String.raw`ноутбук`), 'laptop'],
  [cy(String.raw`телефон|смартфон`), 'phone'],
  [cy(String.raw`наушники`), 'headphones'],
  [cy(String.raw`часы`), 'watch'],
  [cy(String.raw`планшет`), 'tablet'],
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
  s = transliterate(s);
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
  for (const [re, rep] of LATIN_ALIASES) s = s.replace(re, rep);
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
