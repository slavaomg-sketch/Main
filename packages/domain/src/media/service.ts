import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getEnv, REPO_ROOT } from '@techmatch/config';
import type { DbClient } from '@techmatch/database';
import { ValidationError } from '../shared/errors';
import { normalizeProductImage } from './normalize';

export { normalizeProductImage, IMAGE_STANDARD } from './normalize';

/**
 * Варианты изображения. thumb/card/large — WebP с прозрачным фоном для витрины (фон задаёт карточка),
 * white — JPEG 1200×1200 на белом фоне для экспорта на маркетплейсы и в YML.
 */
export const IMAGE_VARIANTS: Record<string, { width: number; height?: number; fit: 'inside' | 'contain'; format: 'webp' | 'jpeg' }> = {
  thumb: { width: 160, height: 160, fit: 'contain', format: 'webp' },
  card: { width: 480, height: 480, fit: 'contain', format: 'webp' },
  large: { width: 1200, fit: 'inside', format: 'webp' },
  white: { width: 1200, height: 1200, fit: 'contain', format: 'jpeg' },
};

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export interface MediaStorage {
  readonly driver: 'local' | 's3';
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  publicUrl(key: string): string;
}

class LocalMediaStorage implements MediaStorage {
  readonly driver = 'local' as const;
  constructor(private readonly dir: string, private readonly baseUrl: string) {}
  async put(key: string, data: Buffer) {
    const file = resolve(this.dir, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    return this.publicUrl(key);
  }
  publicUrl(key: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/${key}`;
  }
  resolvePath(key: string) {
    const p = resolve(this.dir, key);
    if (!p.startsWith(resolve(this.dir))) throw new ValidationError('Недопустимый путь');
    return p;
  }
}

/** S3-совместимое хранилище: включается при MEDIA_DRIVER=s3 и заполненных ключах (SDK подключается при настройке). */
class S3MediaStorage implements MediaStorage {
  readonly driver = 's3' as const;
  constructor(private readonly opts: { bucket: string; endpoint: string; publicBaseUrl: string }) {
    if (!opts.bucket || !opts.endpoint) throw new Error('S3: не заданы параметры');
  }
  async put(key: string): Promise<string> {
    throw new Error(`S3-хранилище не подключено: установите @aws-sdk/client-s3 и реализуйте загрузку ${key} в бакет ${this.opts.bucket}`);
  }
  publicUrl(key: string) {
    return `${this.opts.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}

let storage: MediaStorage | null = null;
export function getMediaStorage(): MediaStorage {
  if (storage) return storage;
  const env = getEnv();
  storage = env.MEDIA_DRIVER === 's3' && env.S3_BUCKET && env.S3_ENDPOINT ? new S3MediaStorage({ bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT, publicBaseUrl: env.S3_PUBLIC_BASE_URL }) : new LocalMediaStorage(resolve(REPO_ROOT, env.MEDIA_LOCAL_DIR), env.MEDIA_PUBLIC_BASE_URL);
  return storage;
}

export function resolveLocalMediaPath(key: string): string {
  const s = getMediaStorage();
  if (!(s instanceof LocalMediaStorage)) throw new ValidationError('Локальное хранилище не используется');
  return s.resolvePath(key);
}

export interface StoreImageInput {
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
  source?: 'UPLOAD' | 'IMPORT' | 'SEED' | 'EXTERNAL_URL';
  originalUrl?: string | null;
  license?: string | null;
  attribution?: string | null;
  /** Приводить к стандарту товарного фото (по умолчанию — значение IMAGE_NORMALIZE). */
  normalize?: boolean;
}

/**
 * Сохраняет изображение: проверка типа/размера, дедупликация по sha256,
 * генерация вариантов (thumb/card/large) в WebP через sharp.
 */
export async function storeImage(db: DbClient, input: StoreImageInput) {
  const env = getEnv();
  const maxBytes = env.UPLOAD_MAX_IMAGE_MB * 1024 * 1024;
  if (input.buffer.length === 0) throw new ValidationError('Пустой файл');
  if (input.buffer.length > maxBytes) throw new ValidationError(`Изображение больше ${env.UPLOAD_MAX_IMAGE_MB} МБ`);
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  const existing = await db.mediaAsset.findUnique({ where: { sha256 } });
  if (existing) return existing;

  const sharp = (await import('sharp')).default;
  const image = sharp(input.buffer, { failOn: 'error' }).rotate();
  const sourceMeta = await image.metadata();
  const sourceMime = sourceMeta.format === 'jpeg' ? 'image/jpeg' : sourceMeta.format === 'png' ? 'image/png' : sourceMeta.format === 'webp' ? 'image/webp' : sourceMeta.format === 'avif' ? 'image/avif' : null;
  if (!sourceMime || !ALLOWED_MIME.has(sourceMime)) throw new ValidationError('Допустимы только JPEG, PNG, WebP и AVIF');

  const normalize = input.normalize ?? env.IMAGE_NORMALIZE === 'true';
  const master = normalize ? (await normalizeProductImage(input.buffer)).buffer : input.buffer;
  const meta = normalize ? await sharp(master).metadata() : sourceMeta;
  const mime = normalize ? 'image/webp' : sourceMime;
  const ext = normalize ? 'webp' : sourceMeta.format === 'jpeg' ? 'jpg' : sourceMeta.format;

  const store = getMediaStorage();
  const prefix = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}`;
  const baseKey = `${prefix}/${sha256}`;
  const originalKey = `${baseKey}.${ext}`;
  const publicUrl = await store.put(originalKey, master, mime);
  const variants: Record<string, string> = {};
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  for (const [name, spec] of Object.entries(IMAGE_VARIANTS)) {
    const pipeline = sharp(master).rotate().resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true, background: spec.format === 'jpeg' ? '#ffffff' : transparent });
    const buf = spec.format === 'jpeg' ? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer() : await pipeline.webp({ quality: 82 }).toBuffer();
    variants[name] = await store.put(`${baseKey}-${name}.${spec.format === 'jpeg' ? 'jpg' : 'webp'}`, buf, spec.format === 'jpeg' ? 'image/jpeg' : 'image/webp');
  }
  return db.mediaAsset.create({
    data: {
      storageKey: originalKey,
      publicUrl,
      originalUrl: input.originalUrl ?? null,
      mimeType: mime,
      width: meta.width ?? null,
      height: meta.height ?? null,
      sizeBytes: master.length,
      sha256,
      variants,
      source: input.source ?? 'UPLOAD',
      license: input.license ?? null,
      attribution: input.attribution ?? null,
    },
  });
}

/** Загрузка изображения по внешнему URL (импорт). Не полагается на URL после сохранения. */
export async function storeImageFromUrl(db: DbClient, url: string, opts: { source?: 'IMPORT' | 'EXTERNAL_URL' } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new ValidationError(`Не удалось скачать изображение: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return storeImage(db, { buffer, originalUrl: url, source: opts.source ?? 'IMPORT', mimeType: res.headers.get('content-type') ?? undefined });
}

export async function storeImageFromFile(db: DbClient, path: string, opts: { source?: 'SEED' | 'UPLOAD'; license?: string | null; attribution?: string | null; originalUrl?: string | null } = {}) {
  await stat(path);
  const buffer = await readFile(path);
  return storeImage(db, { buffer, fileName: join(path), source: opts.source ?? 'SEED', license: opts.license, attribution: opts.attribution, originalUrl: opts.originalUrl });
}
