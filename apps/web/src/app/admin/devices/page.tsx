import Link from 'next/link';
import { prisma, type Prisma } from '@techmatch/database';
import { failedDeviceSearches } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/format';

export default async function AdminDevices({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; page?: string; tab?: string }> }) {
  await requireAdmin('devices.read');
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const where: Prisma.DeviceModelWhereInput = {};
  if (sp.q) where.OR = [{ fullName: { contains: sp.q, mode: 'insensitive' } }, { aliases: { some: { alias: { contains: sp.q, mode: 'insensitive' } } } }, { identifiers: { some: { value: { contains: sp.q, mode: 'insensitive' } } } }];
  if (sp.category) where.category = { slug: sp.category };
  const [items, total, categories, failed] = await Promise.all([
    prisma.deviceModel.findMany({ where, include: { brand: true, category: true, _count: { select: { variants: true, aliases: true, relations: { where: { isActive: true, status: { in: ['VERIFIED', 'COMPATIBLE', 'COMPATIBLE_WITH_LIMITATIONS'] } } } } } }, orderBy: [{ popularity: 'desc' }], skip: (page - 1) * 30, take: 30 }),
    prisma.deviceModel.count({ where }),
    prisma.deviceCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    sp.tab === 'failed' ? failedDeviceSearches(prisma, 50) : [],
  ]);
  return (
    <AdminPage title="Устройства" description={`${total} моделей · категории, бренды, семейства, модели, варианты, номера, характеристики, синонимы`} actions={<><Link href="/admin/devices?tab=failed" className="btn btn-outline btn-sm">Неудачные поиски</Link><Link href="/admin/devices/new" className="btn btn-primary btn-sm">+ Новое устройство</Link></>}>
      {sp.tab === 'failed' ? (
        <Table>
          <thead><tr><th>Запрос (нормализованный)</th><th>Сколько раз</th><th>Последний раз</th><th></th></tr></thead>
          <tbody>
            {failed.length === 0 && <tr><td colSpan={4} className="text-ink-500">Нет неудачных запросов</td></tr>}
            {failed.map((f) => <tr key={f.normalized}><td>{f.normalized}</td><td>{f._count.normalized}</td><td>{f._max.createdAt ? formatDateTime(f._max.createdAt) : '—'}</td><td><Link href={`/admin/devices/new?name=${encodeURIComponent(f.normalized)}`} className="text-brand-600">Добавить устройство</Link></td></tr>)}
          </tbody>
        </Table>
      ) : (
        <>
          <form className="mb-4 flex flex-wrap gap-2" method="get">
            <input name="q" defaultValue={sp.q ?? ''} className="input min-h-9 max-w-xs" placeholder="Название, синоним или номер модели" aria-label="Поиск" />
            <select name="category" defaultValue={sp.category ?? ''} className="input min-h-9 w-auto" aria-label="Категория"><option value="">Все категории</option>{categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}</select>
            <button type="submit" className="btn btn-outline btn-sm">Найти</button>
          </form>
          <Table>
            <thead><tr><th></th><th>Устройство</th><th>Категория</th><th>Год</th><th>Варианты</th><th>Синонимы</th><th>Совместимых</th><th>Статус</th></tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td className="w-12"><span className="block size-10 overflow-hidden rounded-[6px] bg-ink-100">{d.imageUrl && <img src={d.imageUrl} alt="" className="size-full object-cover" />}</span></td>
                  <td><Link href={`/admin/devices/${d.id}`} className="font-semibold text-brand-600">{d.fullName}</Link><div className="text-[12px] text-ink-500">{d.brand.name}{d.primaryModelNumber ? ` · ${d.primaryModelNumber}` : ''}{d.specsAreDemo ? ' · demo-характеристики' : ''}</div></td>
                  <td>{d.category.name}</td><td>{d.releaseYear ?? '—'}</td><td>{d._count.variants}</td><td>{d._count.aliases}</td><td>{d._count.relations}</td>
                  <td><span className={`badge ${d.isActive ? 'bg-success-100 text-success-500' : 'bg-ink-100 text-ink-500'}`}>{d.isActive ? 'активно' : 'скрыто'}</span></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pages={Math.max(1, Math.ceil(total / 30))} hrefFor={(p) => `/admin/devices?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.category ? { category: sp.category } : {}), page: String(p) })}`} />
        </>
      )}
    </AdminPage>
  );
}
