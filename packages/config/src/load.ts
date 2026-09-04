import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

/** Корень монорепозитория (packages/config/src → ../../..). */
export const REPO_ROOT: string = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  } catch {
    return process.cwd();
  }
})();

/**
 * Загружает .env из корня монорепозитория (если есть) и из текущей директории.
 * Не переопределяет уже установленные переменные (приоритет у реального окружения).
 */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const candidates = new Set<string>();
  candidates.add(join(process.cwd(), '.env'));
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.add(join(here, '..', '..', '..', '.env'));
  } catch {
    // import.meta.url недоступен (например, в CJS-бандле) — пропускаем
  }
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    candidates.add(join(dir, '.env'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const file of candidates) {
    if (existsSync(file)) dotenvConfig({ path: file, override: false, quiet: true });
  }
}
