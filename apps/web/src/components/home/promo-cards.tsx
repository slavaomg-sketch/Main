import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Percent } from 'lucide-react';

export interface PromoCardData {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  imageUrl: string | null;
  theme: string;
}

const THEME: Record<string, string> = { BLUE: 'bg-tint-blue', MINT: 'bg-tint-mint', ORANGE: 'bg-tint-peach', GREEN: 'bg-tint-mint', LIGHT: 'bg-canvas', DARK: 'bg-ink-900 text-white' };

export function PromoCards({ cards }: { cards: PromoCardData[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="shell py-4" aria-label="Специальные разделы">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((c, i) => (
          <article key={c.id} className={`relative flex min-h-[176px] overflow-hidden rounded-[var(--radius-lg)] ${THEME[c.theme] ?? 'bg-canvas'}`}>
            <div className="relative z-10 flex w-[60%] flex-col p-5">
              <h3 className="text-[19px] leading-tight font-bold">{c.title}</h3>
              {c.subtitle && <p className="mt-2 text-[12.5px] leading-snug text-ink-700">{c.subtitle}</p>}
              {c.ctaUrl && c.ctaLabel && (
                <Link href={c.ctaUrl} className="btn btn-dark btn-sm mt-auto w-fit pt-0.5">
                  {c.ctaLabel} <ArrowRight width={14} height={14} aria-hidden="true" />
                </Link>
              )}
            </div>
            {c.imageUrl && (
              <div className="absolute inset-y-3 right-3 w-[42%] overflow-hidden rounded-[var(--radius-md)]">
                <Image src={c.imageUrl} alt="" fill sizes="(max-width: 768px) 45vw, 200px" className="object-cover" />
              </div>
            )}
            {i === 2 && (
              <span className="absolute top-3 right-3 z-10 inline-flex size-11 items-center justify-center rounded-full bg-danger-500 text-white shadow-[var(--shadow-card-hover)]" aria-hidden="true">
                <Percent width={20} height={20} strokeWidth={2.5} />
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
