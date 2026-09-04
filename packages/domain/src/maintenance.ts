import type { PrismaClient } from '@techmatch/database';
import { expireUnpaidOrders } from './orders/service';
import { evaluateDeviceCatalog } from './compatibility/service';

/**
 * Фоновые задачи. Выполняются воркером (BullMQ) по расписанию или inline
 * (QUEUE_DRIVER=inline) — тогда вызываются лениво из web при обращениях.
 */
export async function runMaintenance(db: PrismaClient, opts: { recomputeCompatibility?: boolean } = {}) {
  const expired = await expireUnpaidOrders(db);
  let recomputed = 0;
  if (opts.recomputeCompatibility) {
    const devices = await db.deviceModel.findMany({ where: { isActive: true }, select: { id: true } });
    for (const d of devices) {
      await evaluateDeviceCatalog(db, d.id, { persist: true, force: true });
      recomputed += 1;
    }
  }
  const cleaned = await db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 3_600_000) } } });
  const sessions = await db.customerSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const adminSessions = await db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { expiredOrders: expired, recomputedDevices: recomputed, cleanedRateLimits: cleaned.count, cleanedSessions: sessions.count + adminSessions.count };
}

let lastInlineRun = 0;
/** Ленивая обработка для inline-режима: не чаще раза в минуту на процесс. */
export async function maybeRunInlineMaintenance(db: PrismaClient): Promise<void> {
  if (Date.now() - lastInlineRun < 60_000) return;
  lastInlineRun = Date.now();
  try {
    await runMaintenance(db);
  } catch (e) {
    console.warn('[maintenance] ошибка', e);
  }
}
