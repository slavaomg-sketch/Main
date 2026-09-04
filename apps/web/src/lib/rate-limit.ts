import 'server-only';
import { prisma } from '@techmatch/database';
import { getEnv } from '@techmatch/config';

/**
 * Rate limiting на чувствительных endpoint: окно фиксированной длины, счётчик в PostgreSQL
 * (работает при нескольких инстансах без Redis). При QUEUE_DRIVER=bullmq можно перевести на Redis.
 */
export async function rateLimit(key: string, opts: { max?: number; windowSeconds?: number } = {}): Promise<{ ok: boolean; remaining: number; resetAt: Date }> {
  const env = getEnv();
  const max = opts.max ?? env.RATE_LIMIT_MAX;
  const windowMs = (opts.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS) * 1000;
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({ where: { key } });
    if (!existing || existing.resetAt < now) {
      return tx.rateLimitBucket.upsert({ where: { key }, create: { key, count: 1, resetAt }, update: { count: 1, resetAt } });
    }
    return tx.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
  });
  return { ok: row.count <= max, remaining: Math.max(0, max - row.count), resetAt: row.resetAt };
}
