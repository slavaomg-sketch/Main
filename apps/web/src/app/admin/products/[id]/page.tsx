import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { Flash } from '@/components/admin/flash';
import { ProductForm } from '@/components/admin/product-form';
import { AttributesEditor, ImagesEditor, OwnershipPanel, VariantsEditor } from '@/components/admin/product-extras';
import { CompatBadge } from '@/components/ui/compat-badge';

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin('products.read');
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      brand: true, category: true,
      variants: { orderBy: { sortOrder: 'asc' }, include: { prices: { where: { priceList: 'retail', validTo: null }, orderBy: { validFrom: 'desc' }, take: 1 }, inventory: true } },
      images: { orderBy: { sortOrder: 'asc' }, include: { asset: true } },
      attributes: { where: { variantId: null }, include: { attribute: true } },
      fieldOwnerships: { where: { scopeKey: '' }, include: { source: true } },
      relations: { where: { isActive: true, source: { in: ['EXPLICIT', 'MANUFACTURER', 'IMPORT'] } }, include: { deviceModel: { select: { name: true, slug: true } } }, take: 20 },
      externalListings: { include: { source: true } },
    },
  });
  if (!product) notFound();
  const [brands, categories, defs] = await Promise.all([prisma.productBrand.findMany({ orderBy: { name: 'asc' } }), prisma.accessoryCategory.findMany({ orderBy: { sortOrder: 'asc' } }), prisma.attributeDefinition.findMany({ where: { NOT: { code: { startsWith: 'spec_' } } }, orderBy: { sortOrder: 'asc' } })]);
  const attrValue = (code: string) => {
    const a = product.attributes.find((x) => x.attribute.code === code);
    if (!a) return '';
    return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value);
  };
  return (
    <AdminPage title={product.name} description={`${product.category.name} · ${product.brand?.name ?? 'без бренда'} · обновлён ${product.updatedAt.toLocaleString('ru-RU')}`} actions={<><Link href={`/product/${product.slug}`} className="btn btn-outline btn-sm" target="_blank">Открыть на витрине</Link><Link href={`/admin/compatibility?product=${product.id}`} className="btn btn-outline btn-sm">Совместимость</Link></>}>
      <Flash />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <ProductForm product={{ id: product.id, name: product.name, slug: product.slug, brandId: product.brandId ?? '', categoryId: product.categoryId, status: product.status, shortDescription: product.shortDescription ?? '', description: product.description ?? '', badges: product.badges, packageContents: product.packageContents, warrantyMonths: product.warrantyMonths, isFeatured: product.isFeatured, isNew: product.isNew, seoTitle: product.seoTitle ?? '', seoDescription: product.seoDescription ?? '', weightGrams: product.variants[0]?.weightGrams ?? null }} brands={brands} categories={categories} />
          <VariantsEditor productId={product.id} variants={product.variants.map((v) => ({ id: v.id, sku: v.sku, name: v.name, status: v.status, gtin: v.gtin, optionValues: v.optionValues as Record<string, string>, priceRub: (v.prices[0]?.amountMinor ?? 0) / 100, compareAtRub: v.prices[0]?.compareAtMinor ? v.prices[0].compareAtMinor / 100 : null, stock: v.inventory.reduce((s, i) => s + i.quantity, 0), reserved: v.inventory.reduce((s, i) => s + i.reservedQuantity, 0) }))} />
          <AttributesEditor productId={product.id} defs={defs.map((d) => ({ code: d.code, name: d.name, type: d.type, group: d.group, unit: d.unit, value: attrValue(d.code), compat: d.isCompatibilityRelevant }))} specs={product.attributes.filter((a) => a.attribute.code.startsWith('spec_')).map((a) => ({ name: a.attribute.name, value: String(a.value) }))} />
        </div>
        <div className="space-y-5">
          <ImagesEditor productId={product.id} images={product.images.map((i) => ({ id: i.id, url: (i.asset.variants as Record<string, string>).thumb ?? i.asset.publicUrl, isPrimary: i.isPrimary }))} />
          <OwnershipPanel productId={product.id} rows={product.fieldOwnerships.map((o) => ({ field: o.field, owner: o.owner, source: o.source?.name ?? null }))} />
          <section className="card p-5">
            <h2 className="mb-2 text-[15px] font-bold">Явные связи совместимости</h2>
            {product.relations.length === 0 ? <p className="text-[13px] text-ink-500">Нет. Правиловые связи считаются автоматически.</p> : (
              <ul className="space-y-1.5 text-[13px]">{product.relations.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><Link href={`/device/${r.deviceModel.slug}`} className="hover:underline">{r.deviceModel.name}</Link><CompatBadge status={r.status} short /></li>)}</ul>
            )}
            <Link href={`/admin/compatibility?product=${product.id}`} className="btn btn-outline btn-sm mt-3">Управлять</Link>
          </section>
          {product.externalListings.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-2 text-[15px] font-bold">Внешние источники</h2>
              <ul className="space-y-1 text-[13px]">{product.externalListings.map((l) => <li key={l.id}>{l.source.name}: <b>{l.externalId}</b>{l.externalUrl && <> · <a href={l.externalUrl} className="text-brand-600 underline" target="_blank" rel="noreferrer">ссылка</a></>} · {l.lastSyncedAt.toLocaleDateString('ru-RU')}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </AdminPage>
  );
}
