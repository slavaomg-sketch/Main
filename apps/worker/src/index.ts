import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';
import { evaluateDeviceCatalog, getMarketplaceAdapters, runMaintenance } from '@techmatch/domain';

/**
 * TechMatch worker: фоновые задачи через BullMQ (Redis).
 * Очереди:
 *  - maintenance: истечение резервов, очистка сессий (каждую минуту)
 *  - compatibility: пересчёт правиловых связей (по событию и раз в час)
 *  - marketplace-sync: синхронизация маркетплейсов (только при наличии ключей, раз в 6 часов)
 */
const env = getEnv();
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUES = { maintenance: 'maintenance', compatibility: 'compatibility', marketplaceSync: 'marketplace-sync' } as const;

const maintenanceQueue = new Queue(QUEUES.maintenance, { connection });
const compatibilityQueue = new Queue(QUEUES.compatibility, { connection });
const syncQueue = new Queue(QUEUES.marketplaceSync, { connection });

async function schedule() {
  await maintenanceQueue.upsertJobScheduler('every-minute', { every: 60_000 }, { name: 'tick' });
  await compatibilityQueue.upsertJobScheduler('hourly-recompute', { every: 3_600_000 }, { name: 'recompute-all' });
  await syncQueue.upsertJobScheduler('every-6h', { every: 6 * 3_600_000 }, { name: 'sync-all' });
}

const workers = [
  new Worker(QUEUES.maintenance, async () => {
    const r = await runMaintenance(prisma);
    if (r.expiredOrders) console.log(`[maintenance] отменено просроченных заказов: ${r.expiredOrders}`);
    return r;
  }, { connection }),
  new Worker(QUEUES.compatibility, async (job: Job<{ deviceModelId?: string }>) => {
    if (job.data?.deviceModelId) {
      await evaluateDeviceCatalog(prisma, job.data.deviceModelId, { persist: true, force: true });
      return { devices: 1 };
    }
    const r = await runMaintenance(prisma, { recomputeCompatibility: true });
    console.log(`[compatibility] пересчитано устройств: ${r.recomputedDevices}`);
    return r;
  }, { connection, concurrency: 1 }),
  new Worker(QUEUES.marketplaceSync, async () => {
    const adapters = getMarketplaceAdapters().filter((a) => a.isConfigured());
    if (adapters.length === 0) {
      console.log('[sync] маркетплейсы не настроены (нет ключей) — пропуск');
      return { skipped: true };
    }
    const results: Record<string, number> = {};
    for (const a of adapters) {
      const source = await prisma.externalSource.findUnique({ where: { code: a.code } });
      if (!source) continue;
      const run = await prisma.syncRun.create({ data: { sourceId: source.id, status: 'RUNNING' } });
      try {
        let cursor: string | null = null;
        let total = 0;
        do {
          const page = await a.fetchListings(cursor);
          for (const row of page.rows) {
            await prisma.externalListing.upsert({
              where: { sourceId_externalId: { sourceId: source.id, externalId: row.externalId } },
              create: { sourceId: source.id, externalId: row.externalId, sku: row.sku ?? null, gtin: row.gtin ?? null, externalUrl: row.externalUrl ?? null, rawPayload: row as object, status: 'NEW' },
              update: { sku: row.sku ?? null, gtin: row.gtin ?? null, externalUrl: row.externalUrl ?? null, rawPayload: row as object, lastSyncedAt: new Date() },
            });
            total += 1;
          }
          cursor = page.nextCursor;
        } while (cursor);
        await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), stats: { listings: total } } });
        await prisma.externalSource.update({ where: { id: source.id }, data: { lastSyncAt: new Date() } });
        results[a.code] = total;
      } catch (e) {
        await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: (e as Error).message } });
        console.error(`[sync] ${a.name}:`, e);
      }
    }
    // Полученные листинги дальше проходят обычный конвейер импорта (анализ → dry-run → подтверждение) в админке.
    return results;
  }, { connection }),
];

for (const w of workers) {
  w.on('failed', (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
}

schedule()
  .then(() => console.log(`TechMatch worker запущен (Redis: ${env.REDIS_URL})`))
  .catch((e) => {
    console.error('Не удалось запустить планировщик', e);
    process.exit(1);
  });

const shutdown = async () => {
  console.log('Остановка воркера…');
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
