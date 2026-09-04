import { NextResponse } from 'next/server';
import { prisma } from '@techmatch/database';
import { describeProviders } from '@techmatch/domain';

export const dynamic = 'force-dynamic';

/** Healthcheck для Docker/оркестратора: проверяет соединение с БД. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'ok', providers: describeProviders(), time: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ status: 'error', db: 'unavailable', error: (e as Error).message }, { status: 503 });
  }
}
