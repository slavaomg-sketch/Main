import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __techmatchPrisma: PrismaClient | undefined;
}

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Единственный экземпляр Prisma на процесс (переживает hot reload в dev). */
export const prisma: PrismaClient = globalThis.__techmatchPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__techmatchPrisma = prisma;
}

export type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
export type DbClient = PrismaClient | TransactionClient;
