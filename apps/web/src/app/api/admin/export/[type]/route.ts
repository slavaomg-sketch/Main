import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';
import { exportCatalogCsv, exportCatalogXlsx, exportCompatibilityCsv, exportPricesStocksCsv, exportYml, hasPermission } from '@techmatch/domain';
import { getAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const admin = await getAdmin();
  if (!admin || !hasPermission(admin, 'imports.read')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { type } = await ctx.params;
  const stamp = new Date().toISOString().slice(0, 10);
  switch (type) {
    case 'catalog.csv':
      return new NextResponse(await exportCatalogCsv(prisma), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="techmatch-catalog-${stamp}.csv"` } });
    case 'catalog.xlsx':
      return new NextResponse(new Uint8Array(await exportCatalogXlsx(prisma)), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="techmatch-catalog-${stamp}.xlsx"` } });
    case 'prices-stocks.csv':
      return new NextResponse(await exportPricesStocksCsv(prisma), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="techmatch-prices-${stamp}.csv"` } });
    case 'compatibility.csv':
      return new NextResponse(await exportCompatibilityCsv(prisma), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="techmatch-compatibility-${stamp}.csv"` } });
    case 'feed.yml':
      return new NextResponse(await exportYml(prisma, getEnv().APP_URL), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="techmatch-feed.yml"` } });
    default:
      return NextResponse.json({ error: 'unknown export' }, { status: 404 });
  }
}
