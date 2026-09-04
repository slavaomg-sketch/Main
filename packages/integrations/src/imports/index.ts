export * from './types';
export * from './csv';
export * from './xlsx';
export * from './yml';
import { CsvImportAdapter } from './csv';
import { XlsxImportAdapter } from './xlsx';
import { YmlImportAdapter } from './yml';
import type { ImportFileAdapter } from './types';

export const IMPORT_FILE_ADAPTERS: ImportFileAdapter[] = [new CsvImportAdapter(), new XlsxImportAdapter(), new YmlImportAdapter()];

export function pickImportAdapter(fileName: string, mimeType?: string): ImportFileAdapter | null {
  const lower = fileName.toLowerCase();
  return (
    IMPORT_FILE_ADAPTERS.find((a) => a.extensions.some((ext) => lower.endsWith(ext))) ??
    IMPORT_FILE_ADAPTERS.find((a) => mimeType && a.mimeTypes.includes(mimeType)) ??
    null
  );
}
