import Link from 'next/link';
import { prisma, type Prisma } from '@techmatch/database';
import { formatRub } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { Pagination } from '@/components/ui/pagination';

export default async function AdminProducts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; stock?: string; page?: string; category?: string }> }) {
  await requireAdmin('products.read');
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const where: Prisma.ProductWhereInput = {};
  if (sp.q) where.OR = [{ name: { contains: sp.q, mode: 'insensitive' } }, { variants: { some: { sku: { contains: sp.q, mode: 'insensitive' } } } }];
  if (sp.status) where.status = sp.status as Prisma.ProductWhereInput['status'];
  if (sp.category) where.category = { slug: sp.category };
  if (sp.stock === 'low') where.variants = { some: { inventory: { some: { quantity: { lte: 5 } } } } };
  const [items, total, categories] = await Promise.all([
    prisma.product.findMany({ where, include: { brand: true, category: true, variants: { include: { prices: { where: { priceList: 'retail', validTo: null }, take: 1 }, inventory: true } }, images: { take: 1, include: { asset: true }, orderBy: { sortOrder: 'asc' } }, _count: { select: { relations: { where: { isActive: true, status: { in: ['VERIFIED', 'COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS'] } } } } } }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * 30, take: 30 }),
    prisma.product.count({ where }),
    prisma.accessoryCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  const qs = (p: number) => `/admin/products?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.category ? { category: sp.category } : {}), ...(sp.stock ? { stock: sp.stock } : {}), page: String(p) }).toString()}`;
  return (
    <AdminPage title="Товары" description={`${total} товаров`} actions={<Link href="/admin/products/new" className="btn btn-primary btn-sm">+ Новый товар</Link>}>
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input name="q" defaultValue={sp.q ?? ''} className="input min-h-9 max-w-xs" placeholder="Название или SKU" aria-label="Поиск" />
        <select name="status" defaultValue={sp.status ?? ''} className="input min-h-9 w-auto" aria-label="Статус"><option value="">Все статусы</option><option value="ACTIVE">Активные</option><option value="DRAFT">Черновики</option><option value="ARCHIVED">Архив</option></select>
        <select name="category" defaultValue={sp.category ?? ''} className="input min-h-9 w-auto" aria-label="Категория"><option value="">Все категории</option>{categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</select>
        <button type="submit" className="btn btn-outline btn-sm">Найти</button>
      </form>
      <Table>
        <thead><tr><th></th><th>Товар</th><th>Категория</th><th>Статус</th><th>Цена</th><th>Остаток</th><th>Совмест.</th></tr></thead>
        <tbody>
          {items.map((p) => {
            const v = p.variants.find((x) => x.isDefault) ?? p.variants[0];
            const stock = p.variants.reduce((s, x) => s + x.inventory.reduce((a, i) => a + i.quantity, 0), 0);
            return (
              <tr key={p.id}>
                <td className="w-12"><span className="block size-10 overflow-hidden rounded-[6px] bg-white">{p.images[0] && <img src={(p.images[0].asset.variants as Record<string, string>).thumb ?? p.images[0].asset.publicUrl} alt="" className="size-full object-contain" />}</span></td>
                <td><Link href={`/admin/products/${p.id}`} className="font-semibold text-brand-600">{p.name}</Link><div className="text-[12px] text-ink-500">{p.brand?.name} · {v?.sku}{p.variants.length > 1 ? ` (+${p.variants.length - 1})` : ''}</div></td>
                <td>{p.category.name}</td>
                <td><span className={`badge ${p.status === 'ACTIVE' ? 'bg-success-100 text-success-500' : p.status === 'DRAFT' ? 'bg-warning-100 text-warning-500' : 'bg-ink-100 text-ink-500'}`}>{p.status}</span></td>
                <td>{v?.prices[0] ? formatRub(v.prices[0].amountMinor) : '—'}</td>
                <td className={stock <= 5 ? 'font-semibold text-danger-500' : ''}>{stock}</td>
                <td>{p._count.relations}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 30))} hrefFor={qs} />
    </AdminPage>
  );
}
