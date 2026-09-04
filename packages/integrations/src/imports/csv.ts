import { parse } from 'csv-parse/sync';
import type { ImportFileAdapter, ParsedTable } from './types';

export class CsvImportAdapter implements ImportFileAdapter {
  readonly code = 'csv' as const;
  readonly extensions = ['.csv', '.txt'];
  readonly mimeTypes = ['text/csv', 'text/plain', 'application/csv'];

  async parse(buffer: Buffer, options: { delimiter?: string; maxRows?: number } = {}): Promise<ParsedTable> {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const delimiter = options.delimiter ?? detectDelimiter(text);
    const records = parse(text, {
      columns: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }) as Array<Record<string, string>>;
    const headers = records.length ? Object.keys(records[0]!) : firstLineHeaders(text, delimiter);
    const rows = options.maxRows ? records.slice(0, options.maxRows) : records;
    return { headers, rows, totalRows: records.length };
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t', '|'].map((d) => ({ d, n: firstLine.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 1 ? counts[0]!.d : ',';
}

function firstLineHeaders(text: string, delimiter: string): string[] {
  return (text.split(/\r?\n/, 1)[0] ?? '').split(delimiter).map((h) => h.trim()).filter(Boolean);
}
