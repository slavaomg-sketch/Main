import { Star } from 'lucide-react';

export function Rating({ value, count, size = 13 }: { value: number; count?: number; size?: number }) {
  const stars = Array.from({ length: 5 }, (_, i) => Math.min(1, Math.max(0, value - i)));
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Рейтинг ${value.toFixed(1)} из 5${count !== undefined ? `, отзывов: ${count}` : ''}`}>
      <span className="inline-flex items-center gap-[1px]" aria-hidden="true">
        {stars.map((fill, i) => (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-ink-300" width={size} height={size} fill="currentColor" strokeWidth={0} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="text-star" width={size} height={size} fill="currentColor" strokeWidth={0} />
            </span>
          </span>
        ))}
      </span>
      {count !== undefined && <span className="text-[12px] text-ink-500">({count})</span>}
    </span>
  );
}
