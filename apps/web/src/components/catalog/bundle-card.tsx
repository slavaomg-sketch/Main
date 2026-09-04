import Image from 'next/image';
import Link from 'next/link';
import { calculateBundlePrice, formatRub } from '@techmatch/domain';
import { AddBundleButton } from '@/components/cart/add-bundle-button';

type BundleRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  discountPercent: number;
  fixedPriceMinor: number | null;
  imageAsset: { publicUrl: string; variants: unknown } | null;
  items: Array<{ quantity: number; variant: { id: string; name: string; prices: Array<{ amountMinor: number }>; inventory: Array<{ quantity: number; reservedQuantity: number }>; product: { name: string; slug: string; images: Array<{ asset: { publicUrl: string; variants: unknown } }> } } }>;
  devices: Array<{ deviceModel: { name: string; slug: string } }>;
};

export function bundlePricing(b: BundleRow) {
  const items = b.items.filter((i) => i.variant.prices[0]).map((i) => ({ unitPriceMinor: i.variant.prices[0]!.amountMinor, quantity: i.quantity }));
  const inStock = b.items.every((i) => i.variant.inventory.reduce((s, x) => s + x.quantity - x.reservedQuantity, 0) >= i.quantity);
  return { ...calculateBundlePrice(items, { discountPercent: b.discountPercent, fixedPriceMinor: b.fixedPriceMinor }), inStock };
}

export function BundleCard({ bundle }: { bundle: BundleRow }) {
  const p = bundlePricing(bundle);
  const img = bundle.imageAsset ? ((bundle.imageAsset.variants as Record<string, string>).card ?? bundle.imageAsset.publicUrl) : null;
  return (
    <article className="card flex flex-col overflow-hidden" data-testid="bundle-card">
      <Link href={`/bundles/${bundle.slug}`} className="relative block aspect-[16/9] bg-white">
        {img && <Image src={img} alt={bundle.name} fill sizes="(max-width: 768px) 100vw, 400px" className="object-contain p-3" />}
        <span className="badge absolute top-2.5 left-2.5 bg-success-500 text-white">Выгода {formatRub(p.savingsMinor)}</span>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[15px] font-bold"><Link href={`/bundles/${bundle.slug}`}>{bundle.name}</Link></h3>
        {bundle.description && <p className="mt-1 text-[12.5px] text-ink-600">{bundle.description}</p>}
        <ul className="mt-3 space-y-1.5">
          {bundle.items.map((i) => {
            const pic = i.variant.product.images[0]?.asset;
            return (
              <li key={i.variant.id} className="flex items-center gap-2 text-[12.5px]">
                <span className="relative size-8 shrink-0 overflow-hidden rounded-[6px] border border-ink-100 bg-white">
                  {pic && <Image src={(pic.variants as Record<string, string>).thumb ?? pic.publicUrl} alt="" fill sizes="32px" className="object-contain" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{i.variant.product.name}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <div className="text-[18px] font-bold">{formatRub(p.bundleMinor)}</div>
            <div className="text-[12px] text-ink-400 line-through">{formatRub(p.regularMinor)}</div>
          </div>
          <AddBundleButton items={bundle.items.map((i) => ({ variantId: i.variant.id, quantity: i.quantity }))} disabled={!p.inStock} />
        </div>
      </div>
    </article>
  );
}
