'use client';

import Image from 'next/image';
import { useState } from 'react';

export function Gallery({ images, name }: { images: Array<{ url: string; large: string; thumb: string; alt: string }>; name: string }) {
  const [i, setI] = useState(0);
  const cur = images[i] ?? images[0];
  if (!cur) return <div className="flex aspect-square items-center justify-center rounded-[var(--radius-lg)] bg-ink-100 text-ink-400">Нет фото</div>;
  return (
    <div className="flex flex-col gap-3 sm:flex-row-reverse">
      <div className="relative aspect-square flex-1 overflow-hidden rounded-[var(--radius-lg)] bg-ink-100">
        <Image key={cur.large} src={cur.large} alt={cur.alt || name} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 560px" priority className="object-contain" />
      </div>
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto scrollbar-none sm:w-16 sm:flex-col" aria-label="Изображения товара">
          {images.map((img, idx) => (
            <li key={img.url} className="shrink-0">
              <button type="button" onClick={() => setI(idx)} aria-label={`Фото ${idx + 1}`} aria-pressed={idx === i} className={`relative block size-16 overflow-hidden rounded-[var(--radius-sm)] border-2 bg-ink-100 ${idx === i ? 'border-brand-500' : 'border-transparent hover:border-ink-300'}`}>
                <Image src={img.thumb} alt="" fill sizes="64px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
