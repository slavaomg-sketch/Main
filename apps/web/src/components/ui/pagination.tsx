import Link from 'next/link';

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  const items: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) items.push(p);
  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Страницы">
      {page > 1 && <Link className="btn btn-outline btn-sm" href={hrefFor(page - 1)}>Назад</Link>}
      {items[0]! > 1 && <span className="px-1 text-ink-400">…</span>}
      {items.map((p) => (
        <Link key={p} href={hrefFor(p)} aria-current={p === page ? 'page' : undefined} className={`inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-sm font-medium ${p === page ? 'bg-brand-500 text-white' : 'hover:bg-ink-100'}`}>
          {p}
        </Link>
      ))}
      {items[items.length - 1]! < pages && <span className="px-1 text-ink-400">…</span>}
      {page < pages && <Link className="btn btn-outline btn-sm" href={hrefFor(page + 1)}>Вперёд</Link>}
    </nav>
  );
}
