import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getEnv } from '@techmatch/config';

const execFileAsync = promisify(execFile);

/**
 * Стандарт товарного фото (как у Amazon и Apple): квадрат 1:1, объект вырезан и отцентрован,
 * занимает {@link SUBJECT_FILL} стороны кадра, поля одинаковые, фон прозрачный (в витрине — белый).
 */
export const IMAGE_STANDARD = { side: 1200, subjectFill: 0.84, maxSide: 1600 } as const;

export interface NormalizeResult {
  buffer: Buffer;
  format: 'webp';
  cutout: boolean;
}

/** Запускает внешнюю команду удаления фона, если она настроена. Возвращает PNG с альфа-каналом или null. */
async function runCutout(input: Buffer): Promise<Buffer | null> {
  const cmd = getEnv().IMAGE_CUTOUT_COMMAND.trim();
  if (!cmd) return null;
  const dir = await mkdtemp(join(tmpdir(), 'tm-cutout-'));
  try {
    const inFile = join(dir, 'in.png');
    const outFile = join(dir, 'out.png');
    await writeFile(inFile, input);
    const [bin, ...args] = cmd.split(/\s+/).map((a) => a.replace('{input}', inFile).replace('{output}', outFile));
    await execFileAsync(bin!, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    return await readFile(outFile);
  } catch (e) {
    console.warn(`[media] удаление фона не выполнено: ${(e as Error).message}`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Приводит фото к стандарту: опциональное удаление фона внешней командой, обрезка пустых полей
 * (прозрачных или однотонного фона по углу), квадратный холст с одинаковыми полями. Итог — WebP с альфа-каналом.
 */
export async function normalizeProductImage(input: Buffer): Promise<NormalizeResult> {
  const sharp = (await import('sharp')).default;
  const base = sharp(input, { failOn: 'error' }).rotate();
  const meta = await base.metadata();
  const png = await base.png().toBuffer();

  const cut = await runCutout(png);
  const source = cut ?? png;

  let trimmed: Buffer;
  try {
    trimmed = await sharp(source).ensureAlpha().trim({ threshold: cut ? 8 : 24 }).png().toBuffer();
  } catch {
    trimmed = await sharp(source).ensureAlpha().png().toBuffer();
  }
  const tm = await sharp(trimmed).metadata();
  const w = tm.width ?? meta.width ?? 1;
  const h = tm.height ?? meta.height ?? 1;
  const longest = Math.max(w, h);
  const targetSubject = Math.min(longest, Math.round(IMAGE_STANDARD.maxSide * IMAGE_STANDARD.subjectFill));
  const scale = targetSubject / longest;
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const side = Math.round(targetSubject / IMAGE_STANDARD.subjectFill);
  const left = Math.floor((side - sw) / 2);
  const top = Math.floor((side - sh) / 2);
  const buffer = await sharp(trimmed)
    .resize({ width: sw, height: sh, fit: 'fill' })
    .extend({ top, bottom: side - sh - top, left, right: side - sw - left, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 92, alphaQuality: 90 })
    .toBuffer();
  return { buffer, format: 'webp', cutout: cut !== null };
}
