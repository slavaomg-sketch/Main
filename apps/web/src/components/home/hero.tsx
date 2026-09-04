import Image from 'next/image';
import type { HomepageSettings } from '@techmatch/domain';
import { DeviceSearchBox } from '@/components/devices/device-search-box';

export interface HeroImage {
  key: string;
  url: string;
  alt: string;
}

/**
 * Hero по референсу: слева eyebrow + H1 + подзаголовок + строка подбора + популярные запросы,
 * справа — композиция из реальных фото устройств и рукописная заметка.
 */
export function Hero({ settings, images }: { settings: HomepageSettings; images: HeroImage[] }) {
  const byKey = Object.fromEntries(images.map((i) => [i.key, i]));
  const tile = (key: string, cls: string, sizes: string, priority = false) => {
    const img = byKey[key];
    if (!img) return null;
    return (
      <div className={`absolute overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[0_10px_30px_rgba(15,23,42,0.12)] ring-1 ring-black/5 ${cls}`}>
        <Image src={img.url} alt={img.alt} fill sizes={sizes} priority={priority} className="object-cover" />
      </div>
    );
  };
  return (
    <section className="bg-hero" aria-labelledby="hero-title">
      <div className="shell grid items-center gap-8 py-8 md:py-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-8 lg:py-10">
        <div className="relative z-10 max-w-[600px]">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-brand-500 uppercase">{settings.heroEyebrow}</p>
          <h1 id="hero-title" className="h1 text-ink-900">{settings.heroTitle}</h1>
          <p className="mt-4 max-w-[480px] text-[15px] leading-relaxed text-ink-700 sm:text-[16px]">{settings.heroSubtitle}</p>
          <div className="mt-6 max-w-[560px]">
            <DeviceSearchBox placeholder={settings.heroSearchPlaceholder} popular={settings.popularQueries} />
          </div>
        </div>
        <div className="relative mx-auto aspect-[16/10] w-full max-w-[640px] lg:aspect-[17/11]">
          {tile('hero-laptop', 'top-[6%] left-[8%] h-[62%] w-[54%] rotate-[-2deg]', '(max-width: 1024px) 60vw, 360px', true)}
          {tile('hero-tablet', 'top-[14%] right-[4%] h-[44%] w-[30%] rotate-[3deg]', '(max-width: 1024px) 40vw, 220px', true)}
          {tile('hero-phone', 'bottom-[4%] left-[2%] h-[46%] w-[26%] rotate-[-4deg]', '(max-width: 1024px) 30vw, 170px')}
          {tile('hero-watch', 'bottom-[10%] left-[32%] h-[36%] w-[22%]', '(max-width: 1024px) 25vw, 150px')}
          {tile('hero-earbuds', 'right-[30%] bottom-[2%] h-[30%] w-[20%] rotate-[4deg]', '(max-width: 1024px) 22vw, 130px')}
          {tile('hero-controller', 'right-[3%] bottom-[6%] h-[40%] w-[28%] rotate-[-3deg]', '(max-width: 1024px) 30vw, 190px')}
          {tile('hero-camera', 'top-[50%] right-[2%] h-[22%] w-[16%] rotate-[6deg]', '(max-width: 1024px) 18vw, 110px')}
          {settings.heroNote && (
            <p className="hand absolute -top-3 right-0 z-10 max-w-[210px] rotate-[-6deg] text-right text-[22px] leading-[1] font-semibold text-ink-800 sm:text-[26px] lg:-top-7 lg:right-[-6px]" aria-hidden="true">
              {settings.heroNote}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
