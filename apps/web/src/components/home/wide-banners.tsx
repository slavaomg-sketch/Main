import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { PromoCardData } from '@/components/home/promo-cards';

export function WideBanners({ banners }: { banners: Array<PromoCardData & { handwrittenNote: string | null }> }) {
  if (banners.length === 0) return null;
  return (
    <section className="shell py-4" aria-label="Тематические разделы">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {banners.map((b) => {
          const dark = b.theme === 'DARK';
          return (
            <article key={b.id} className={`relative flex min-h-[200px] overflow-hidden rounded-[var(--radius-lg)] ${dark ? 'bg-ink-900 text-white' : 'bg-canvas text-ink-900'}`}>
              {b.imageUrl && (
                <div className="absolute inset-y-3 right-4 w-[46%]">
                  <Image src={b.imageUrl} alt="" fill sizes="(max-width: 1024px) 50vw, 320px" className={`object-contain ${dark ? "drop-shadow-[0_18px_28px_rgba(0,0,0,0.45)]" : "drop-shadow-[0_18px_28px_rgba(15,23,42,0.18)]"}`} />
                  <div className={`absolute inset-y-0 left-0 w-1/3 ${dark ? 'bg-gradient-to-r from-ink-900 to-transparent' : 'bg-gradient-to-r from-canvas to-transparent'}`} />
                </div>
              )}
              <div className="relative z-10 flex w-[58%] flex-col p-6">
                <h3 className="max-w-[260px] text-[22px] leading-[1.15] font-bold">{b.title}</h3>
                {b.subtitle && <p className={`mt-2 max-w-[240px] text-[13px] ${dark ? 'text-ink-300' : 'text-ink-600'}`}>{b.subtitle}</p>}
                {b.ctaUrl && b.ctaLabel && (
                  <Link href={b.ctaUrl} className={`${dark ? 'btn btn-light' : 'btn btn-dark'} btn-sm mt-auto w-fit`}>
                    {b.ctaLabel} <ArrowRight width={14} height={14} aria-hidden="true" />
                  </Link>
                )}
              </div>
              {b.handwrittenNote && (
                <span className={`hand absolute right-[30%] bottom-4 z-10 hidden rotate-[-8deg] text-[26px] leading-none font-semibold sm:block ${dark ? 'text-white' : 'text-ink-800'}`} aria-hidden="true">
                  {b.handwrittenNote}
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
