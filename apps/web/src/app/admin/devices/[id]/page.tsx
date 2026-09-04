import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { Flash } from '@/components/admin/flash';
import { DeviceForm } from '@/components/admin/device-form';

export default async function AdminDevicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin('devices.read');
  const { id } = await params;
  const d = await prisma.deviceModel.findUnique({ where: { id }, include: { family: true, specifications: true, aliases: { where: { variantId: null }, orderBy: { weight: 'desc' } }, identifiers: { where: { variantId: null } }, variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { specifications: true } } } });
  if (!d) notFound();
  const [brands, categories] = await Promise.all([prisma.deviceBrand.findMany({ orderBy: { name: 'asc' } }), prisma.deviceCategory.findMany({ orderBy: { sortOrder: 'asc' } })]);
  const specs = Object.fromEntries(d.specifications.filter((s) => !s.variantId).map((s) => [s.key, s.value]));
  return (
    <AdminPage title={d.fullName} actions={<><Link href={`/device/${d.slug}`} className="btn btn-outline btn-sm" target="_blank">На витрине</Link><Link href={`/admin/compatibility?device=${d.id}`} className="btn btn-outline btn-sm">Совместимость</Link></>}>
      <Flash />
      <DeviceForm
        device={{ id: d.id, name: d.name, fullName: d.fullName, slug: d.slug, brandId: d.brandId, categoryId: d.categoryId, familyName: d.family?.name ?? '', generation: d.generation ?? '', releaseYear: d.releaseYear, primaryModelNumber: d.primaryModelNumber ?? '', description: d.description ?? '', popularity: d.popularity, isActive: d.isActive, specsAreDemo: d.specsAreDemo, specs: JSON.stringify(specs, null, 2), aliases: d.aliases.map((a) => a.alias).join('\n'), identifiers: d.identifiers.map((i) => `${i.type !== 'MODEL_NUMBER' ? `${i.type}:` : ''}${i.value}${i.region ? ` | ${i.region}` : ''}`).join('\n'), variants: d.variants.map((v) => `${v.slug} | ${v.name}${v.specifications.length ? ` | ${JSON.stringify(Object.fromEntries(v.specifications.map((s) => [s.key, s.value])))}` : ''}`).join('\n'), imageUrl: d.imageUrl }}
        brands={brands}
        categories={categories}
      />
    </AdminPage>
  );
}
