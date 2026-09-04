'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import { saveBundleAction, saveCouponAction, savePromotionAction } from '@/server/actions/admin/promotions';

const dt = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 16) : '');

export interface CouponRow { id: string; code: string; discountType: string; value: number; minSubtotalMinor: number; maxDiscountMinor: number | null; usageLimit: number | null; usedCount: number; perCustomerLimit: number | null; startsAt: string | null; endsAt: string | null; isActive: boolean; promotionId: string | null }

export function CouponsEditor({ coupons, promotions }: { coupons: CouponRow[]; promotions: Array<{ id: string; name: string }> }) {
  const [adding, setAdding] = useState(false);
  const form = (c?: CouponRow) => (
    <ActionForm key={c?.id ?? 'new'} action={saveCouponAction} submitLabel="Сохранить промокод" className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={() => setAdding(false)}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Код"><input name="code" className="input min-h-9 uppercase" defaultValue={c?.code ?? ''} required data-testid="coupon-code" /></Field>
        <Field label="Тип"><select name="discountType" className="input min-h-9" defaultValue={c?.discountType ?? 'PERCENT'}><option value="PERCENT">Процент</option><option value="FIXED">Фиксированная, ₽</option></select></Field>
        <Field label="Значение (% или ₽)"><input name="value" type="number" step="0.01" className="input min-h-9" defaultValue={c ? (c.discountType === 'PERCENT' ? c.value : c.value / 100) : ''} required /></Field>
        <Field label="Мин. сумма заказа, ₽"><input name="minSubtotalRub" type="number" className="input min-h-9" defaultValue={c ? c.minSubtotalMinor / 100 : 0} /></Field>
        <Field label="Макс. скидка, ₽"><input name="maxDiscountRub" type="number" className="input min-h-9" defaultValue={c?.maxDiscountMinor ? c.maxDiscountMinor / 100 : ''} /></Field>
        <Field label="Лимит использований" hint={c ? `использовано: ${c.usedCount}` : undefined}><input name="usageLimit" type="number" className="input min-h-9" defaultValue={c?.usageLimit ?? ''} /></Field>
        <Field label="На одного клиента"><input name="perCustomerLimit" type="number" className="input min-h-9" defaultValue={c?.perCustomerLimit ?? ''} /></Field>
        <Field label="Акция"><select name="promotionId" className="input min-h-9" defaultValue={c?.promotionId ?? ''}><option value="">—</option>{promotions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Действует с"><input name="startsAt" type="datetime-local" className="input min-h-9" defaultValue={dt(c?.startsAt ?? null)} /></Field>
        <Field label="Действует до"><input name="endsAt" type="datetime-local" className="input min-h-9" defaultValue={dt(c?.endsAt ?? null)} /></Field>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={c?.isActive ?? true} className="size-4 accent-brand-500" /> активен</label>
      </div>
    </ActionForm>
  );
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Промокоды</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Промокод'}</button></div>
      <div className="space-y-3">{adding && form()}{coupons.map((c) => form(c))}</div>
    </section>
  );
}

export interface PromoRow { id: string; name: string; slug: string; description: string | null; discountType: string; value: number; scope: string; categoryId: string | null; brandId: string | null; badgeLabel: string | null; startsAt: string | null; endsAt: string | null; isActive: boolean }

export function PromotionsEditor({ promotions, categories, brands }: { promotions: PromoRow[]; categories: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string }> }) {
  const [adding, setAdding] = useState(false);
  const form = (p?: PromoRow) => (
    <ActionForm key={p?.id ?? 'new'} action={savePromotionAction} submitLabel="Сохранить акцию" className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={() => setAdding(false)}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Название"><input name="name" className="input min-h-9" defaultValue={p?.name ?? ''} required /></Field>
        <Field label="Slug"><input name="slug" className="input min-h-9" defaultValue={p?.slug ?? ''} /></Field>
        <Field label="Тип"><select name="discountType" className="input min-h-9" defaultValue={p?.discountType ?? 'PERCENT'}><option value="PERCENT">Процент</option><option value="FIXED">Фиксированная, ₽</option></select></Field>
        <Field label="Значение"><input name="value" type="number" step="0.01" className="input min-h-9" defaultValue={p ? (p.discountType === 'PERCENT' ? p.value : p.value / 100) : ''} required /></Field>
        <Field label="Область"><select name="scope" className="input min-h-9" defaultValue={p?.scope ?? 'ALL'}><option value="ALL">Весь каталог</option><option value="CATEGORY">Категория</option><option value="BRAND">Бренд</option><option value="PRODUCT">Товары</option><option value="BUNDLE">Комплекты</option></select></Field>
        <Field label="Категория"><select name="categoryId" className="input min-h-9" defaultValue={p?.categoryId ?? ''}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Бренд"><select name="brandId" className="input min-h-9" defaultValue={p?.brandId ?? ''}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Бейдж"><input name="badgeLabel" className="input min-h-9" defaultValue={p?.badgeLabel ?? ''} /></Field>
        <Field label="С"><input name="startsAt" type="datetime-local" className="input min-h-9" defaultValue={dt(p?.startsAt ?? null)} /></Field>
        <Field label="До"><input name="endsAt" type="datetime-local" className="input min-h-9" defaultValue={dt(p?.endsAt ?? null)} /></Field>
        <div className="md:col-span-2"><Field label="Описание"><input name="description" className="input min-h-9" defaultValue={p?.description ?? ''} /></Field></div>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} className="size-4 accent-brand-500" /> активна</label>
      </div>
    </ActionForm>
  );
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Акции и скидки</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Акция'}</button></div>
      <p className="mb-3 text-[12px] text-ink-500">Акции — маркетинговые сущности (бейджи, описание, промокоды). Скидка на цену товара задаётся полем «старая цена» в варианте; скидка за комплект — в самом комплекте.</p>
      <div className="space-y-3">{adding && form()}{promotions.map((p) => form(p))}</div>
    </section>
  );
}

export interface BundleRow { id: string; name: string; slug: string; description: string | null; discountPercent: number; isActive: boolean; sortOrder: number; items: string[]; devices: string[] }

export function BundlesEditor({ bundles }: { bundles: BundleRow[] }) {
  const [adding, setAdding] = useState(false);
  const form = (b?: BundleRow) => (
    <ActionForm key={b?.id ?? 'new'} action={saveBundleAction} submitLabel="Сохранить комплект" className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={() => setAdding(false)}>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Название"><input name="name" className="input min-h-9" defaultValue={b?.name ?? ''} required /></Field>
        <Field label="Slug"><input name="slug" className="input min-h-9" defaultValue={b?.slug ?? ''} /></Field>
        <Field label="Скидка, %"><input name="discountPercent" type="number" className="input min-h-9" defaultValue={b?.discountPercent ?? 10} /></Field>
        <Field label="Порядок"><input name="sortOrder" type="number" className="input min-h-9" defaultValue={b?.sortOrder ?? 0} /></Field>
        <div className="md:col-span-2"><Field label="Состав (SKU × количество, по строке)"><textarea name="items" className="input min-h-20 py-1.5 font-mono text-[12px]" defaultValue={b?.items.join('\n') ?? ''} required /></Field></div>
        <Field label="Для устройств (slug по строке)"><textarea name="devices" className="input min-h-20 py-1.5 font-mono text-[12px]" defaultValue={b?.devices.join('\n') ?? ''} /></Field>
        <div><Field label="Изображение"><input type="file" name="image" accept="image/*" className="text-[12px]" /></Field><label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} className="size-4 accent-brand-500" /> активен</label></div>
        <div className="md:col-span-4"><Field label="Описание"><input name="description" className="input min-h-9" defaultValue={b?.description ?? ''} /></Field></div>
      </div>
    </ActionForm>
  );
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Комплекты</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Комплект'}</button></div>
      <div className="space-y-3">{adding && form()}{bundles.map((b) => form(b))}</div>
    </section>
  );
}
