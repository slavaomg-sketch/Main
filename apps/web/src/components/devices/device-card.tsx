import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface DeviceCardData {
  slug: string;
  name: string;
  fullName: string;
  imageUrl: string | null;
  brand: { name: string };
  category: { name: string };
  releaseYear: number | null;
  variants?: Array<{ id: string; name: string }>;
}

export function DeviceCard({ device, hint }: { device: DeviceCardData; hint?: string | null }) {
  return (
    <Link href={`/device/${device.slug}`} className="card flex items-center gap-3 p-3 transition-shadow hover:shadow-[var(--shadow-card-hover)]" data-testid="device-card">
      <span className="relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-ink-100 bg-white">
        {device.imageUrl && <Image src={device.imageUrl} alt="" fill sizes="64px" className="object-contain" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{device.fullName}</span>
        <span className="block text-[12px] text-ink-500">
          {device.category.name}
          {device.variants && device.variants.length > 1 ? ` · ${device.variants.map((v) => v.name).join(' / ')}` : ''}
        </span>
        {hint && <span className="mt-0.5 block text-[12px] text-warning-500">{hint}</span>}
      </span>
      <ChevronRight width={18} height={18} className="shrink-0 text-ink-400" aria-hidden="true" />
    </Link>
  );
}
