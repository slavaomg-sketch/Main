import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { getProductCardsByIds, listBundles, listCustomerDevices, listProducts } from '@techmatch/domain';
import { AccountShell } from '@/components/account/account-shell';
import { DevicesList } from '@/components/account/devices-list';
import { DeviceSearchBox } from '@/components/devices/device-search-box';
import { ProductGrid } from '@/components/catalog/product-grid';
import { BundleCard } from '@/components/catalog/bundle-card';
import { getCustomer } from '@/lib/session';

export const metadata: Metadata = { title: 'Мои устройства', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function MyDevicesPage() {
  const session = await getCustomer();
  if (!session) redirect('/account/login?next=/account/devices');
  const devices = await listCustomerDevices(prisma, session.customer.id);
  const primary = devices.find((d) => d.isPrimary) ?? devices[0];
  const recommended = primary ? await listProducts(prisma, { deviceModelId: primary.deviceModelId, perPage: 10, sort: 'compat' }) : null;
  const bundles = primary ? await listBundles(prisma, { deviceModelId: primary.deviceModelId, limit: 2 }) : [];
  // Аксессуары для всех устройств: по 5 на каждое
  const perDevice = await Promise.all(devices.filter((d) => d.id !== primary?.id).slice(0, 3).map(async (d) => ({ device: d, items: (await listProducts(prisma, { deviceModelId: d.deviceModelId, perPage: 5, sort: 'compat' })).items })));
  void getProductCardsByIds;
  return (
    <AccountShell title="Мои устройства" current="/account/devices">
      <section className="card mb-5 p-5">
        <h2 className="h3 mb-2">Добавить устройство</h2>
        <p className="mb-3 text-[13px] text-ink-600">Найдите модель и нажмите «Сделать моим устройством» на её странице — она появится здесь.</p>
        <DeviceSearchBox placeholder="Например, Galaxy S25 или Canon G3410" popular={[]} />
      </section>
      {devices.length ? <DevicesList devices={devices} /> : <p className="text-[13px] text-ink-500">Сохранённых устройств пока нет.</p>}
      {recommended && recommended.items.length > 0 && primary && (
        <section className="mt-8">
          <h2 className="h2 mb-3">Подходит для {primary.deviceModel.name}</h2>
          <ProductGrid products={recommended.items} deviceModelId={primary.deviceModelId} cols={5} />
        </section>
      )}
      {bundles.length > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-3">Комплекты для {primary!.deviceModel.name}</h2>
          <div className="grid gap-4 md:grid-cols-2">{bundles.map((b) => <BundleCard key={b.id} bundle={b} />)}</div>
        </section>
      )}
      {perDevice.map(({ device, items }) => items.length > 0 && (
        <section key={device.id} className="mt-8">
          <h2 className="h3 mb-3">Для {device.deviceModel.name}</h2>
          <ProductGrid products={items} deviceModelId={device.deviceModelId} cols={5} />
        </section>
      ))}
    </AccountShell>
  );
}
