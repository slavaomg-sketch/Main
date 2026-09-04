'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { saveProductAction } from '@/server/actions/admin/products';
import type { ActionResult } from '@/lib/errors';
import { Field } from '@/components/admin/ui';

export interface ProductFormData {
  id: string | null;
  name: string;
  slug: string;
  brandId: string;
  categoryId: string;
  status: string;
  shortDescription: string;
  description: string;
  badges: string[];
  packageContents: string[];
  warrantyMonths: number;
  isFeatured: boolean;
  isNew: boolean;
  seoTitle: string;
  seoDescription: string;
  weightGrams: number | null;
}

export function ProductForm({ product, brands, categories }: { product: ProductFormData; brands: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> }) {
  const bound = saveProductAction.bind(null, product.id);
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(bound, null);
  return (
    <form action={action} className="card space-y-4 p-5" data-testid="product-form">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Название"><input name="name" className="input" defaultValue={product.name} required /></Field>
        <Field label="Slug (URL)" hint="Пусто — сформируется автоматически"><input name="slug" className="input" defaultValue={product.slug} /></Field>
        <Field label="Бренд"><select name="brandId" className="input" defaultValue={product.brandId}><option value="">— без бренда —</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Категория"><select name="categoryId" className="input" defaultValue={product.categoryId} required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Статус"><select name="status" className="input" defaultValue={product.status}><option value="DRAFT">Черновик</option><option value="ACTIVE">Активен</option><option value="ARCHIVED">Архив</option></select></Field>
        <Field label="Гарантия, мес."><input name="warrantyMonths" type="number" className="input" defaultValue={product.warrantyMonths} min={0} /></Field>
        <Field label="Вес, г (для доставки)"><input name="weightGrams" type="number" className="input" defaultValue={product.weightGrams ?? ''} min={0} /></Field>
        <div className="flex items-end gap-6 pb-2">
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="isFeatured" defaultChecked={product.isFeatured} className="size-4 accent-brand-500" /> Рекомендуемый</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="isNew" defaultChecked={product.isNew} className="size-4 accent-brand-500" /> Новинка</label>
        </div>
      </div>
      <Field label="Краткое описание"><textarea name="shortDescription" className="input min-h-16 py-2" defaultValue={product.shortDescription} maxLength={500} /></Field>
      <Field label="Описание"><textarea name="description" className="input min-h-32 py-2" defaultValue={product.description} /></Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Бейджи (по одному в строке)" hint="Хит продаж, Выбор покупателей, Скидка, Новинка"><textarea name="badges" className="input min-h-16 py-2" defaultValue={product.badges.join('\n')} /></Field>
        <Field label="Комплектация (по одному в строке)"><textarea name="packageContents" className="input min-h-16 py-2" defaultValue={product.packageContents.join('\n')} /></Field>
        <Field label="SEO title"><input name="seoTitle" className="input" defaultValue={product.seoTitle} /></Field>
        <Field label="SEO description"><input name="seoDescription" className="input" defaultValue={product.seoDescription} /></Field>
      </div>
      {state && !state.ok && <p className="text-[13px] text-danger-500" role="alert">{state.error}</p>}
      {state?.ok && <p className="text-[13px] text-success-500" role="status">Сохранено</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending} data-testid="product-save">{pending ? <Loader2 width={14} height={14} className="animate-spin" /> : null} Сохранить</button>
    </form>
  );
}
