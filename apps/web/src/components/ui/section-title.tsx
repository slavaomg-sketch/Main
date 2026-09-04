import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function SectionTitle({ title, href, linkLabel = 'Смотреть все', as: Tag = 'h2' }: { title: string; href?: string; linkLabel?: string; as?: 'h1' | 'h2' | 'h3' }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <Tag className="h2">{title}</Tag>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-500 hover:text-brand-700">
          {linkLabel} <ArrowRight width={14} height={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
