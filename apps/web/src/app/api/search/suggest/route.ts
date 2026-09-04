import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@techmatch/database';
import { getSearchProvider } from '@techmatch/domain';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 120);
  if (q.trim().length < 2) return NextResponse.json({ devices: [], products: [], resolution: 'none', hint: null });
  const r = await getSearchProvider().suggest(prisma, q);
  return NextResponse.json({
    devices: r.devices.map((d) => ({ slug: d.slug, name: d.name, fullName: d.fullName, imageUrl: d.imageUrl, category: { name: d.category.name }, variants: d.variants })),
    products: r.products.map((p) => ({ slug: p.slug, name: p.name, image: p.image, priceMinor: p.priceMinor })),
    resolution: r.resolution,
    hint: r.hint,
  }, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
