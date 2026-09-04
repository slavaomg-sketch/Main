import type { ProductCardDTO } from '@techmatch/domain';
import { ProductCard } from '@/components/catalog/product-card';

export function ProductGrid({ products, favorites = [], deviceModelId, cols = 6, priorityCount = 0 }: { products: ProductCardDTO[]; favorites?: string[]; deviceModelId?: string | null; cols?: 4 | 5 | 6; priorityCount?: number }) {
  const colCls = cols === 6 ? 'lg:grid-cols-5 xl:grid-cols-6' : cols === 5 ? 'lg:grid-cols-4 xl:grid-cols-5' : 'lg:grid-cols-3 xl:grid-cols-4';
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 ${colCls}`} data-testid="product-grid">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} favorite={favorites.includes(p.id)} deviceModelId={deviceModelId} priority={i < priorityCount} />
      ))}
    </div>
  );
}
