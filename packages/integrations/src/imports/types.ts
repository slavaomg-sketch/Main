/** Общий результат разбора файла импорта: заголовки и строки как записи «столбец → строка». */
export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
  sheetName?: string;
  totalRows: number;
}

export interface ImportFileAdapter {
  readonly code: 'csv' | 'xlsx' | 'yml';
  readonly extensions: string[];
  readonly mimeTypes: string[];
  parse(buffer: Buffer, options?: { sheet?: string; delimiter?: string; maxRows?: number }): Promise<ParsedTable>;
}

/** Каноническая структура строки импорта, к которой приводятся все источники. */
export interface CanonicalImportRow {
  externalId: string;
  sku?: string;
  gtin?: string;
  name?: string;
  brand?: string;
  category?: string;
  description?: string;
  priceMinor?: number;
  compareAtMinor?: number;
  stock?: number;
  imageUrls?: string[];
  externalUrl?: string;
  attributes?: Record<string, string>;
  compatibleDevices?: string[];
}

export type CanonicalField = keyof CanonicalImportRow;

export const CANONICAL_FIELDS: Array<{ field: CanonicalField; label: string; required?: boolean; hint?: string }> = [
  { field: 'externalId', label: 'Внешний ID / артикул источника', required: true, hint: 'Ключ идемпотентности — по нему определяется «тот же товар»' },
  { field: 'sku', label: 'SKU (внутренний артикул)', hint: 'Если пусто — создаётся из внешнего ID' },
  { field: 'gtin', label: 'Штрихкод (GTIN/EAN)' },
  { field: 'name', label: 'Название' },
  { field: 'brand', label: 'Бренд' },
  { field: 'category', label: 'Категория (slug или название)' },
  { field: 'description', label: 'Описание' },
  { field: 'priceMinor', label: 'Цена, ₽', hint: 'Преобразуется в копейки' },
  { field: 'compareAtMinor', label: 'Старая цена, ₽' },
  { field: 'stock', label: 'Остаток, шт' },
  { field: 'imageUrls', label: 'Ссылки на изображения', hint: 'Через запятую или «;»' },
  { field: 'externalUrl', label: 'Ссылка на карточку в источнике' },
  { field: 'compatibleDevices', label: 'Совместимые устройства (slug через «;»)' },
];

/** Автоматическое предположение о сопоставлении столбцов по заголовкам. */
export function guessMapping(headers: string[]): Record<string, CanonicalField> {
  const patterns: Array<[CanonicalField, RegExp]> = [
    ['externalId', /^(id|external.?id|nm.?id|offer.?id|артикул\s*(wb|ozon|поставщика)?|номенклатура|product.?id|код\s*товара)$/i],
    ['sku', /^(sku|артикул|vendor.?code|код)$/i],
    ['gtin', /^(gtin|ean|barcode|штрих.?код|баркод)$/i],
    ['name', /^(name|title|название|наименование|наименование\s*товара)$/i],
    ['brand', /^(brand|бренд|производитель|vendor)$/i],
    ['category', /^(category|категория|предмет|раздел)$/i],
    ['description', /^(description|описание)$/i],
    ['priceMinor', /^(price|цена|цена.*продаж|розничная\s*цена|цена,?\s*₽|цена\s*руб)$/i],
    ['compareAtMinor', /^(old.?price|compare.?at|старая\s*цена|цена\s*до\s*скидки)$/i],
    ['stock', /^(stock|quantity|qty|остаток|количество|наличие)$/i],
    ['imageUrls', /^(image|images|picture|pictures|photo|фото|изображени[ея]|картинки)$/i],
    ['externalUrl', /^(url|link|ссылка)$/i],
    ['compatibleDevices', /^(compatib.*|совместим.*|devices|устройства)$/i],
  ];
  const mapping: Record<string, CanonicalField> = {};
  const used = new Set<CanonicalField>();
  for (const h of headers) {
    const clean = h.trim();
    for (const [field, re] of patterns) {
      if (!used.has(field) && re.test(clean)) {
        mapping[h] = field;
        used.add(field);
        break;
      }
    }
  }
  return mapping;
}

export function parseMoneyToMinor(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).replace(/\s|₽|руб\.?|р\./gi, '').replace(',', '.').trim();
  if (s === '') return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

export function parseIntSafe(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(String(raw).replace(/\s/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export function splitList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = String(raw)
    .split(/[;,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

/** Применяет сопоставление столбцов к сырой строке. Неизвестные столбцы уходят в attributes. */
export function applyMapping(raw: Record<string, string>, mapping: Record<string, CanonicalField>): { row: CanonicalImportRow | null; errors: string[] } {
  const errors: string[] = [];
  const out: Partial<CanonicalImportRow> = { attributes: {} };
  for (const [column, value] of Object.entries(raw)) {
    const field = mapping[column];
    const v = value === undefined || value === null ? '' : String(value).trim();
    if (!field) {
      if (v !== '') out.attributes![column] = v;
      continue;
    }
    switch (field) {
      case 'priceMinor':
      case 'compareAtMinor': {
        const n = parseMoneyToMinor(v);
        if (v !== '' && n === undefined) errors.push(`Столбец «${column}»: не удалось прочитать цену «${v}»`);
        if (n !== undefined) out[field] = n;
        break;
      }
      case 'stock': {
        const n = parseIntSafe(v);
        if (v !== '' && n === undefined) errors.push(`Столбец «${column}»: остаток «${v}» не число`);
        if (n !== undefined) out.stock = n;
        break;
      }
      case 'imageUrls':
      case 'compatibleDevices':
        out[field] = splitList(v);
        break;
      default:
        if (v !== '') out[field] = v;
    }
  }
  if (!out.externalId || out.externalId.trim() === '') {
    errors.push('Не задан внешний ID (обязательное поле)');
    return { row: null, errors };
  }
  if (out.priceMinor !== undefined && out.priceMinor < 0) errors.push('Цена не может быть отрицательной');
  if (out.stock !== undefined && out.stock < 0) errors.push('Остаток не может быть отрицательным');
  return { row: out as CanonicalImportRow, errors };
}
