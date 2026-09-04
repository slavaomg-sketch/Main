import * as XLSX from 'xlsx';
import type { ImportFileAdapter, ParsedTable } from './types';

export class XlsxImportAdapter implements ImportFileAdapter {
  readonly code = 'xlsx' as const;
  readonly extensions = ['.xlsx', '.xls'];
  readonly mimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

  async parse(buffer: Buffer, options: { sheet?: string; maxRows?: number } = {}): Promise<ParsedTable> {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = options.sheet && wb.SheetNames.includes(options.sheet) ? options.sheet : wb.SheetNames[0];
    if (!sheetName) return { headers: [], rows: [], totalRows: 0 };
    const sheet = wb.Sheets[sheetName]!;
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    const rows = records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), v === null || v === undefined ? '' : String(v)])));
    const headers = rows.length ? Object.keys(rows[0]!) : [];
    return { headers, rows: options.maxRows ? rows.slice(0, options.maxRows) : rows, sheetName, totalRows: rows.length };
  }
}

/** Экспорт таблицы в XLSX. */
export function buildXlsx(rows: Array<Record<string, unknown>>, sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}
