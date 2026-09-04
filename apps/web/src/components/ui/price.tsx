import { formatRub } from '@techmatch/domain/shared/money';

export function Price({ minor, compareAtMinor, size = 'md' }: { minor: number; compareAtMinor?: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'text-[28px]' : size === 'sm' ? 'text-[15px]' : 'text-[17px]';
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={`${cls} font-bold tracking-[-0.01em] text-ink-900`}>{formatRub(minor)}</span>
      {compareAtMinor && compareAtMinor > minor ? <span className="text-[13px] text-ink-400 line-through">{formatRub(compareAtMinor)}</span> : null}
    </span>
  );
}
