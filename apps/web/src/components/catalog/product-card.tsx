'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Check, Heart, Loader2, ShoppingCart } from 'lucide-react';
import type { ProductCardDTO } from '@techmatch/domain';
import { Rating } from '@/components/ui/rating';
import { Price } from '@/components/ui/price';
import { CompatBadge } from '@/components/ui/compat-badge';
import { addToCartAction } from '@/server/actions/cart';
import { toggleFavoriteAction } from '@/server/actions/favorites';
import { useToast } from '@/components/ui/toast';

const BADGE_CLS: Record<string, string> = { 'Хит продаж': 'bg-brand-500 text-white', 'Выбор покупателей': 'bg-success-500 text-white', Скидка: 'bg-danger-500 text-white', Новинка: 'bg-ink-900 text-white' };

export function ProductCard({ product, favorite = false, deviceModelId, priority = false }: { product: ProductCardDTO; favorite?: boolean; deviceModelId?: string | null; priority?: boolean }) {
  const [fav, setFav] = useState(favorite);
  const [added, setAdded] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const badges = [...product.badges, ...(product.isNew && !product.badges.includes('Новинка') ? ['Новинка'] : [])].slice(0, 2);
  const img = product.image;
  const src = img ? (img.variants.card ?? img.url) : null;
  const compat = product.compatibility;
  return (
    <article className="group card relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-[var(--shadow-card-hover)]" data-testid="product-card">
      <div className="relative">
        <Link href={`/product/${product.slug}`} className="block aspect-square overflow-hidden bg-ink-100" tabIndex={-1} aria-hidden="true">
          {src ? (
            <Image src={src} alt={img?.alt ?? product.name} width={480} height={480} sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px" priority={priority} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          ) : (
            <span className="flex size-full items-center justify-center text-ink-400">Нет фото</span>
          )}
        </Link>
        <div className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1">
          {badges.map((b) => (
            <span key={b} className={`badge ${BADGE_CLS[b] ?? 'bg-ink-900 text-white'}`}>{b}</span>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={fav}
          aria-label={fav ? 'Убрать из избранного' : 'В избранное'}
          onClick={() =>
            start(async () => {
              const r = await toggleFavoriteAction(product.id);
              if (r.ok) setFav(r.data.active);
              else toast.error(r.error);
            })
          }
          className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-full bg-surface/90 text-ink-700 shadow-[var(--shadow-card)] hover:text-danger-500"
        >
          <Heart width={17} height={17} fill={fav ? 'currentColor' : 'none'} className={fav ? 'text-danger-500' : ''} />
        </button>
        {!product.inStock && <span className="absolute bottom-2 left-2.5 badge bg-ink-900/80 text-white">Нет в наличии</span>}
      </div>
      <div className="flex flex-1 flex-col p-3 pt-2.5">
        {compat && (
          <div className="mb-1.5">
            <CompatBadge status={compat.status} short />
          </div>
        )}
        <Link href={`/product/${product.slug}`} className="line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3] font-medium text-ink-900 hover:text-brand-600">
          {product.name}
        </Link>
        <div className="mt-1.5">
          <Rating value={product.rating} count={product.reviewCount} />
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
          <Price minor={product.priceMinor} compareAtMinor={product.compareAtMinor} />
          <button
            type="button"
            disabled={!product.inStock || pending}
            aria-label="Добавить в корзину"
            data-testid="add-to-cart"
            onClick={() =>
              start(async () => {
                const r = await addToCartAction({ variantId: product.defaultVariantId, quantity: 1, deviceModelId: deviceModelId ?? null });
                if (r.ok) {
                  setAdded(true);
                  toast.success('Товар добавлен в корзину', { href: '/cart', label: 'Перейти в корзину' });
                  setTimeout(() => setAdded(false), 2000);
                } else toast.error(r.error);
              })
            }
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-ink-900 text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {pending ? <Loader2 width={16} height={16} className="animate-spin" /> : added ? <Check width={16} height={16} /> : <ShoppingCart width={16} height={16} />}
          </button>
        </div>
      </div>
    </article>
  );
}
