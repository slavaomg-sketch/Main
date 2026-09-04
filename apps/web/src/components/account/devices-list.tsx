'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Star, Trash2 } from 'lucide-react';
import { removeDeviceAction, setPrimaryDeviceAction } from '@/server/actions/account';
import { useToast } from '@/components/ui/toast';

export function DevicesList({ devices }: { devices: Array<{ id: string; isPrimary: boolean; nickname: string | null; deviceModel: { slug: string; fullName: string; imageUrl: string | null; category: { name: string } }; deviceVariant: { name: string } | null }> }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? 'Ошибка');
      router.refresh();
    });
  return (
    <ul className="grid gap-3 md:grid-cols-2" data-testid="my-devices">
      {devices.map((d) => (
        <li key={d.id} className={`card flex items-center gap-3 p-3 ${d.isPrimary ? 'border-brand-200 bg-brand-50/40' : ''}`}>
          <span className="relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-ink-100">{d.deviceModel.imageUrl && <Image src={d.deviceModel.imageUrl} alt="" fill sizes="64px" className="object-cover" />}</span>
          <span className="min-w-0 flex-1">
            <Link href={`/device/${d.deviceModel.slug}`} className="block truncate text-[14px] font-semibold hover:text-brand-600">{d.deviceModel.fullName}</Link>
            <span className="block text-[12px] text-ink-500">{d.deviceModel.category.name}{d.deviceVariant ? ` · ${d.deviceVariant.name}` : ''}{d.isPrimary ? ' · активное' : ''}</span>
          </span>
          {!d.isPrimary && <button type="button" className="icon-btn size-9" title="Сделать активным" aria-label="Сделать активным" disabled={pending} onClick={() => run(() => setPrimaryDeviceAction(d.id))}><Star width={16} height={16} /></button>}
          <button type="button" className="icon-btn size-9 text-ink-400 hover:text-danger-500" aria-label="Удалить" disabled={pending} onClick={() => run(() => removeDeviceAction(d.id))}><Trash2 width={16} height={16} /></button>
        </li>
      ))}
    </ul>
  );
}
