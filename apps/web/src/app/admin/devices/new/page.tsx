import { prisma } from '@techmatch/database';
import { requireAdmin } from '@/lib/admin';
import { AdminPage } from '@/components/admin/ui';
import { DeviceForm } from '@/components/admin/device-form';

export default async function NewDevicePage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  await requireAdmin('devices.write');
  const { name } = await searchParams;
  const [brands, categories] = await Promise.all([prisma.deviceBrand.findMany({ orderBy: { name: 'asc' } }), prisma.deviceCategory.findMany({ orderBy: { sortOrder: 'asc' } })]);
  return (
    <AdminPage title="Новое устройство">
      <DeviceForm device={{ id: null, name: name ?? '', fullName: name ?? '', slug: '', brandId: '', categoryId: categories[0]?.id ?? '', familyName: '', generation: '', releaseYear: null, primaryModelNumber: '', description: '', popularity: 0, isActive: true, specsAreDemo: false, specs: '', aliases: '', identifiers: '', variants: '', imageUrl: null }} brands={brands} categories={categories} />
    </AdminPage>
  );
}
