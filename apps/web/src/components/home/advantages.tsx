import { Icon } from '@/components/ui/icon';
import type { HomepageSettings } from '@techmatch/domain';

export function Advantages({ items }: { items: HomepageSettings['advantages'] }) {
  return (
    <section className="shell py-3" aria-label="Преимущества">
      <ul className="grid gap-x-4 gap-y-4 rounded-[var(--radius-lg)] border-y border-ink-200 py-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-x-4 lg:divide-x lg:divide-ink-200">
        {items.map((a) => (
          <li key={a.title} className="flex items-center gap-3 lg:pl-4 lg:first:pl-0">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-ink-300 text-ink-800">
              <Icon name={a.icon} width={22} height={22} strokeWidth={1.6} />
            </span>
            <span className="text-[11.5px] leading-[1.25]">
              <span className="block font-semibold text-ink-900">{a.title}</span>
              <span className="block text-ink-500">{a.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
