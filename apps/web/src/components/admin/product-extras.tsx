'use client';

import { useState } from 'react';
import { ActionButton, ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import { removeProductImageAction, saveAttributesAction, saveVariantAction, setOwnershipAction, uploadProductImageAction } from '@/server/actions/admin/products';

export interface VariantRow {
  id: string;
  sku: string;
  name: string;
  status: string;
  gtin: string | null;
  optionValues: Record<string, string>;
  priceRub: number;
  compareAtRub: number | null;
  stock: number;
  reserved: number;
}

export function VariantsEditor({ productId, variants }: { productId: string; variants: VariantRow[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Варианты, SKU, цены и остатки</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Вариант'}</button></div>
      <div className="space-y-3">
        {adding && <VariantForm productId={productId} onDone={() => setAdding(false)} />}
        {variants.map((v) => <VariantForm key={v.id} productId={productId} variant={v} />)}
      </div>
    </section>
  );
}

function VariantForm({ productId, variant, onDone }: { productId: string; variant?: VariantRow; onDone?: () => void }) {
  return (
    <ActionForm action={(fd) => saveVariantAction(productId, fd)} className="rounded-[var(--radius-md)] border border-ink-200 p-3" submitLabel={variant ? 'Сохранить вариант' : 'Создать вариант'} onDone={onDone}>
      {variant && <input type="hidden" name="variantId" value={variant.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="SKU"><input name="sku" className="input min-h-9" defaultValue={variant?.sku ?? ''} required data-testid="variant-sku" /></Field>
        <Field label="Название варианта"><input name="name" className="input min-h-9" defaultValue={variant?.name ?? ''} required /></Field>
        <Field label="Цена, ₽"><input name="priceRub" type="number" step="0.01" min={0} className="input min-h-9" defaultValue={variant?.priceRub ?? ''} required data-testid="variant-price" /></Field>
        <Field label="Старая цена, ₽"><input name="compareAtRub" type="number" step="0.01" min={0} className="input min-h-9" defaultValue={variant?.compareAtRub ?? ''} /></Field>
        <Field label="Остаток, шт" hint={variant ? `в резерве: ${variant.reserved}` : undefined}><input name="stock" type="number" min={0} className="input min-h-9" defaultValue={variant?.stock ?? 0} required data-testid="variant-stock" /></Field>
        <Field label="GTIN / штрихкод"><input name="gtin" className="input min-h-9" defaultValue={variant?.gtin ?? ''} /></Field>
        <Field label="Опции (key=value построчно)"><textarea name="optionValues" className="input min-h-9 py-1.5" defaultValue={Object.entries(variant?.optionValues ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')} /></Field>
        <Field label="Статус"><select name="status" className="input min-h-9" defaultValue={variant?.status ?? 'ACTIVE'}><option value="ACTIVE">Активен</option><option value="ARCHIVED">Архив</option></select></Field>
      </div>
    </ActionForm>
  );
}

export interface AttrDef {
  code: string;
  name: string;
  type: string;
  group: string | null;
  unit: string | null;
  value: string;
  compat: boolean;
}

export function AttributesEditor({ productId, defs, specs }: { productId: string; defs: AttrDef[]; specs: Array<{ name: string; value: string }> }) {
  const groups = Array.from(new Set(defs.map((d) => d.group ?? 'Прочее')));
  return (
    <section className="card p-5">
      <h2 className="mb-1 text-[15px] font-bold">Характеристики и данные для совместимости</h2>
      <p className="mb-3 text-[12px] text-ink-500">{'Атрибуты с пометкой «совм.» использует Compatibility Engine. Списки и JSON — в формате JSON (например ["USB_PD","PPS"] или [{"type":"USB_C","maxWatts":30}]).'}</p>
      <ActionForm action={(fd) => saveAttributesAction(productId, fd)} submitLabel="Сохранить характеристики">
        <div className="space-y-4">
          {groups.map((g) => (
            <fieldset key={g}>
              <legend className="mb-2 text-[12px] font-semibold tracking-wider text-ink-500 uppercase">{g}</legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {defs.filter((d) => (d.group ?? 'Прочее') === g).map((d) => (
                  <Field key={d.code} label={`${d.name}${d.unit ? `, ${d.unit}` : ''}${d.compat ? ' · совм.' : ''}`} hint={d.code}>
                    {d.type === 'JSON' || d.type === 'LIST' ? <textarea name={`attr:${d.code}`} className="input min-h-9 py-1.5 font-mono text-[12px]" defaultValue={d.value} /> : <input name={`attr:${d.code}`} className="input min-h-9" defaultValue={d.value} />}
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
          <Field label="Видимые характеристики (Название = Значение построчно)"><textarea name="specs" className="input min-h-24 py-2" defaultValue={specs.map((s) => `${s.name} = ${s.value}`).join('\n')} /></Field>
        </div>
      </ActionForm>
    </section>
  );
}

export function ImagesEditor({ productId, images }: { productId: string; images: Array<{ id: string; url: string; isPrimary: boolean }> }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-[15px] font-bold">Изображения</h2>
      <ul className="mb-4 flex flex-wrap gap-3">
        {images.map((img) => (
          <li key={img.id} className="relative">
            <img src={img.url} alt="" className="size-24 rounded-[var(--radius-sm)] border border-ink-200 object-contain" />
            {img.isPrimary && <span className="badge absolute top-1 left-1 bg-brand-500 text-white">главное</span>}
            <div className="mt-1 text-center"><ActionButton action={() => removeProductImageAction(productId, img.id)} confirm="Удалить изображение?" className="text-[12px] text-danger-500 hover:underline">удалить</ActionButton></div>
          </li>
        ))}
      </ul>
      <ActionForm action={(fd) => uploadProductImageAction(productId, fd)} submitLabel="Загрузить">
        <input type="file" name="files" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="text-[13px]" />
        <p className="mt-1 text-[12px] text-ink-500">JPEG, PNG, WebP или AVIF, до 8 МБ. Дубликаты определяются по содержимому, создаются размеры thumb/card/large.</p>
      </ActionForm>
    </section>
  );
}

export function OwnershipPanel({ productId, rows }: { productId: string; rows: Array<{ field: string; owner: string; source: string | null }> }) {
  const FIELDS = ['name', 'description', 'price', 'stock', 'images', 'brand', 'category'];
  const LABEL: Record<string, string> = { name: 'Название', description: 'Описание', price: 'Цена', stock: 'Остаток', images: 'Изображения', brand: 'Бренд', category: 'Категория' };
  return (
    <section className="card p-5">
      <h2 className="mb-1 text-[15px] font-bold">Кто управляет полями</h2>
      <p className="mb-3 text-[12px] text-ink-500">«Вручную» — импорт из источника не перезапишет поле. «Источник» — поле обновляется при синхронизации.</p>
      <ul className="divide-y divide-ink-100 text-[13px]">
        {FIELDS.map((f) => {
          const r = rows.find((x) => x.field === f);
          const manual = r?.owner === 'MANUAL';
          return (
            <li key={f} className="flex items-center justify-between py-2">
              <span>{LABEL[f]} <span className={`ml-2 badge ${manual ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-600'}`}>{manual ? 'вручную' : r ? `источник${r.source ? `: ${r.source}` : ''}` : 'не задано (источник)'}</span></span>
              <ActionButton action={() => setOwnershipAction(productId, f, manual ? 'SOURCE' : 'MANUAL')} className="text-[12px] text-brand-600 hover:underline">{manual ? 'отдать источнику' : 'закрепить вручную'}</ActionButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
