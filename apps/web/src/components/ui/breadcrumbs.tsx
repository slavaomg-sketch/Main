import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const all = [{ label: 'Главная', href: '/' }, ...items];
  const json = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.href ? { item: c.href } : {}) })) };
  return (
    <nav aria-label="Хлебные крошки" className="mb-4 overflow-x-auto scrollbar-none">
      <ol className="flex items-center gap-1 whitespace-nowrap text-[13px] text-ink-500">
        {all.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight width={14} height={14} aria-hidden="true" className="text-ink-300" />}
            {c.href && i < all.length - 1 ? <Link href={c.href} className="hover:text-ink-900">{c.label}</Link> : <span className="text-ink-700" aria-current={i === all.length - 1 ? 'page' : undefined}>{c.label}</span>}
          </li>
        ))}
      </ol>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
    </nav>
  );
}
