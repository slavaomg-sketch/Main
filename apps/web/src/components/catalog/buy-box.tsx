'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Heart, Loader2, Minus, Plus, ShoppingCart } from 'lucide-react';
import { Price } from '@/components/ui/price';
import { addToCartAction } from '@/server/actions/cart';
import { toggleFavoriteAction } from '@/server/actions/favorites';
import { useToast } from '@/components/ui/toast';

export interface VariantOption {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  compareAtMinor: number | null;
  available: number;
  optionValues: Record<string, string>;
}

export function BuyBox({ productId, variants, selectedId, favorite, deviceModelId, warrantyMonths }: { productId: string; variants: VariantOption[]; selectedId: string; favorite: boolean; deviceModelId: string | null; warrantyMonths: number }) {
  const router = useRouter();
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0]!;
  const [qty, setQty] = useState(1);
  const [fav, setFav] = useState(favorite);
  const [added, setAdded] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const optionKeys = Array.from(new Set(variants.flatMap((v) => Object.keys(v.optionValues))));
  const OPTION_LABEL: Record<string, string> = { color: 'Цвет', length: 'Длина', capacity: 'Объём', set: 'Комплектация', size: 'Размер' };
  return (
    <div className="card p-5" data-testid="buy-box">
      <Price minor={selected.priceMinor} compareAtMinor={selected.compareAtMinor} size="lg" />
      <p className={`mt-1 text-[13px] ${selected.available > 0 ? 'text-success-500' : 'text-danger-500'}`} data-testid="stock-status">
        {selected.available > 5 ? 'В наличии' : selected.available > 0 ? `Осталось ${selected.available} шт.` : 'Нет в наличии'}
      </p>
      {variants.length > 1 && (
        <div className="mt-4 space-y-3">
          {optionKeys.map((key) => (
            <div key={key}>
              <div className="mb-1.5 text-[12px] font-medium text-ink-700">{OPTION_LABEL[key] ?? key}</div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={OPTION_LABEL[key] ?? key}>
                {variants.filter((v) => v.optionValues[key]).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={v.id === selected.id}
                    onClick={() => router.replace(`?variant=${encodeURIComponent(v.sku)}`, { scroll: false })}
                    className={`chip min-h-9 ${v.id === selected.id ? 'bg-ink-900 text-white hover:bg-ink-800' : ''} ${v.available === 0 ? 'opacity-50' : ''}`}
                  >
                    {v.optionValues[key]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 flex items-stretch gap-2">
        <div className="inline-flex h-11 items-center rounded-[var(--radius-pill)] border border-ink-300">
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-l-[var(--radius-pill)] hover:bg-ink-100" aria-label="Меньше" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus width={15} height={15} /></button>
          <span className="w-8 text-center text-[14px] font-semibold" aria-live="polite">{qty}</span>
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-r-[var(--radius-pill)] hover:bg-ink-100" aria-label="Больше" onClick={() => setQty((q) => Math.min(selected.available || 1, q + 1))}><Plus width={15} height={15} /></button>
        </div>
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={selected.available === 0 || pending}
          data-testid="buy-add"
          onClick={() =>
            start(async () => {
              const r = await addToCartAction({ variantId: selected.id, quantity: qty, deviceModelId });
              if (r.ok) {
                setAdded(true);
                toast.success('Товар добавлен в корзину', { href: '/cart', label: 'Перейти в корзину' });
                setTimeout(() => setAdded(false), 2500);
              } else toast.error(r.error);
            })
          }
        >
          {pending ? <Loader2 width={17} height={17} className="animate-spin" /> : added ? <Check width={17} height={17} /> : <ShoppingCart width={17} height={17} />}
          {added ? 'Добавлено' : 'В корзину'}
        </button>
        <button
          type="button"
          aria-pressed={fav}
          aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
          className="btn btn-outline size-11 px-0"
          onClick={() =>
            start(async () => {
              const r = await toggleFavoriteAction(productId);
              if (r.ok) setFav(r.data.active);
            })
          }
        >
          <Heart width={18} height={18} fill={fav ? 'currentColor' : 'none'} className={fav ? 'text-danger-500' : ''} />
        </button>
      </div>
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-ink-500">Артикул</dt><dd className="font-medium" data-testid="sku">{selected.sku}</dd>
        <dt className="text-ink-500">Гарантия</dt><dd className="font-medium">{warrantyMonths > 0 ? `${warrantyMonths} мес.` : 'не предусмотрена'}</dd>
        <dt className="text-ink-500">Доставка</dt><dd className="font-medium">от 1 дня, бесплатно от 3 000 ₽</dd>
        <dt className="text-ink-500">Возврат</dt><dd className="font-medium">14 дней</dd>
      </dl>
    </div>
  );
}
