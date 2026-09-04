export * from './types.js';
export * from './csv.js';
export * from './xlsx.js';
export * from './yml.js';
import { CsvImportAdapter } from './csv.js';
import { XlsxImportAdapter } from './xlsx.js';
import { YmlImportAdapter } from './yml.js';
import type { ImportFileAdapter } from './types.js';

export const IMPORT_FILE_ADAPTERS: ImportFileAdapter[] = [new CsvImportAdapter(), new XlsxImportAdapter(), new YmlImportAdapter()];

export function pickImportAdapter(fileName: string, mimeType?: string): ImportFileAdapter | null {
  const lower = fileName.toLowerCase();
  return (
    IMPORT_FILE_ADAPTERS.find((a) => a.extensions.some((ext) => lower.endsWith(ext))) ??
    IMPORT_FILE_ADAPTERS.find((a) => mimeType && a.mimeTypes.includes(mimeType)) ??
    null
  );
}
