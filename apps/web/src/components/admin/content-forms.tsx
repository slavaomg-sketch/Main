'use client';

import { useState } from 'react';
import type { HomepageSettings } from '@techmatch/domain/content';
import { ActionButton, ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import { deleteBannerAction, deleteFaqAction, saveBannerAction, saveBrandAction, saveCollectionAction, saveFaqAction, saveHomepageAction, savePageAction } from '@/server/actions/admin/content';

export function HomepageForm({ s, collections }: { s: HomepageSettings; collections: Array<{ slug: string; name: string }> }) {
  const tri = (list: Array<{ icon: string; title: string; text: string }>) => list.map((a) => `${a.icon} | ${a.title} | ${a.text}`).join('\n');
  return (
    <ActionForm action={saveHomepageAction} submitLabel="Сохранить главную" className="card p-5">
      <h2 className="mb-3 text-[15px] font-bold">Главная страница и hero</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Надзаголовок (eyebrow)"><input name="heroEyebrow" className="input min-h-9" defaultValue={s.heroEyebrow} /></Field>
        <Field label="Заголовок H1"><input name="heroTitle" className="input min-h-9" defaultValue={s.heroTitle} data-testid="hero-title-input" /></Field>
        <div className="md:col-span-2"><Field label="Подзаголовок"><textarea name="heroSubtitle" className="input min-h-14 py-1.5" defaultValue={s.heroSubtitle} /></Field></div>
        <Field label="Placeholder строки подбора"><input name="heroSearchPlaceholder" className="input min-h-9" defaultValue={s.heroSearchPlaceholder} /></Field>
        <Field label="Рукописная заметка"><input name="heroNote" className="input min-h-9" defaultValue={s.heroNote} /></Field>
        <Field label="Популярные запросы (по строке)"><textarea name="popularQueries" className="input min-h-20 py-1.5" defaultValue={s.popularQueries.join('\n')} /></Field>
        <Field label="Подборка «Популярные товары»"><select name="featuredCollectionSlug" className="input min-h-9" defaultValue={s.featuredCollectionSlug}>{collections.map((c) => <option key={c.slug} value={c.slug}>{c.name} ({c.slug})</option>)}</select></Field>
        <Field label="Преимущества (иконка | заголовок | текст)" hint="Иконки: shield-check, truck, award, package, headset, plug-zap, cable, usb, battery-charging"><textarea name="advantages" className="input min-h-28 py-1.5" defaultValue={tri(s.advantages)} /></Field>
        <Field label="Преимущества в шапке (иконка | заголовок | текст)"><textarea name="headerBenefits" className="input min-h-28 py-1.5" defaultValue={tri(s.headerBenefits)} /></Field>
        <Field label="Подписка: заголовок"><input name="newsletterTitle" className="input min-h-9" defaultValue={s.newsletterTitle} /></Field>
        <Field label="Подписка: текст"><input name="newsletterText" className="input min-h-9" defaultValue={s.newsletterText} /></Field>
        <Field label="Footer: доверие, заголовок"><input name="trustTitle" className="input min-h-9" defaultValue={s.trustTitle} /></Field>
        <Field label="Footer: доверие, текст"><input name="trustText" className="input min-h-9" defaultValue={s.trustText} /></Field>
        <Field label="Комплектов на главной"><input name="bundlesLimit" type="number" className="input min-h-9" defaultValue={s.bundlesLimit} /></Field>
      </div>
    </ActionForm>
  );
}

export interface BannerData {
  id: string;
  placement: string;
  theme: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  handwrittenNote: string | null;
  sortOrder: number;
  isActive: boolean;
  imageUrl: string | null;
}

export function BannerForm({ b, onDone }: { b?: BannerData; onDone?: () => void }) {
  return (
    <ActionForm action={saveBannerAction} submitLabel={b ? 'Сохранить' : 'Создать баннер'} className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={onDone}>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Размещение"><select name="placement" className="input min-h-9" defaultValue={b?.placement ?? 'HOME_PROMO'}><option value="HOME_PROMO">Главная: промо-карточка (3 шт.)</option><option value="HOME_WIDE">Главная: широкий баннер</option><option value="HOME_HERO">Главная: hero</option><option value="CATALOG_TOP">Каталог: верх</option><option value="DEVICE_PAGE">Страница устройства</option></select></Field>
        <Field label="Тема"><select name="theme" className="input min-h-9" defaultValue={b?.theme ?? 'BLUE'}>{['LIGHT', 'DARK', 'BLUE', 'GREEN', 'ORANGE', 'MINT'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Порядок"><input name="sortOrder" type="number" className="input min-h-9" defaultValue={b?.sortOrder ?? 0} /></Field>
        <Field label="Заголовок"><input name="title" className="input min-h-9" defaultValue={b?.title ?? ''} required /></Field>
        <Field label="Подзаголовок"><input name="subtitle" className="input min-h-9" defaultValue={b?.subtitle ?? ''} /></Field>
        <Field label="Рукописная заметка"><input name="handwrittenNote" className="input min-h-9" defaultValue={b?.handwrittenNote ?? ''} /></Field>
        <Field label="Текст кнопки"><input name="ctaLabel" className="input min-h-9" defaultValue={b?.ctaLabel ?? ''} /></Field>
        <Field label="Ссылка кнопки"><input name="ctaUrl" className="input min-h-9" defaultValue={b?.ctaUrl ?? ''} /></Field>
        <Field label="Изображение"><input type="file" name="image" accept="image/*" className="text-[12px]" /></Field>
      </div>
      <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={b?.isActive ?? true} className="size-4 accent-brand-500" /> Активен</label>
    </ActionForm>
  );
}

export function BannersEditor({ banners }: { banners: BannerData[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Баннеры и промо-блоки</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Баннер'}</button></div>
      <div className="space-y-3">
        {adding && <BannerForm onDone={() => setAdding(false)} />}
        {banners.map((b) => (
          <div key={b.id} className="flex gap-3">
            {b.imageUrl && <img src={b.imageUrl} alt="" className="size-20 shrink-0 rounded-[var(--radius-sm)] object-contain" />}
            <div className="min-w-0 flex-1"><BannerForm b={b} /><div className="mt-1"><ActionButton action={() => deleteBannerAction(b.id)} confirm="Удалить баннер?" className="text-[12px] text-danger-500 hover:underline">удалить</ActionButton></div></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CollectionsEditor({ collections }: { collections: Array<{ slug: string; name: string; isActive: boolean; items: string[] }> }) {
  const [adding, setAdding] = useState(false);
  const form = (c?: { slug: string; name: string; isActive: boolean; items: string[] }) => (
    <ActionForm key={c?.slug ?? 'new'} action={saveCollectionAction} submitLabel="Сохранить подборку" className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={() => setAdding(false)}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Slug"><input name="slug" className="input min-h-9" defaultValue={c?.slug ?? ''} readOnly={Boolean(c)} required /></Field>
        <Field label="Название"><input name="name" className="input min-h-9" defaultValue={c?.name ?? ''} required /></Field>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={c?.isActive ?? true} className="size-4 accent-brand-500" /> Активна</label>
      </div>
      <Field label="Товары по порядку (slug товара или SKU, по одному в строке)"><textarea name="products" className="input min-h-28 py-1.5 font-mono text-[12px]" defaultValue={c?.items.join('\n') ?? ''} /></Field>
    </ActionForm>
  );
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Подборки (популярные товары, новинки, акции)</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Подборка'}</button></div>
      <div className="space-y-3">{adding && form()}{collections.map((c) => form(c))}</div>
    </section>
  );
}

export function PagesEditor({ pages }: { pages: Array<{ slug: string; title: string; body: string; seoTitle: string | null; seoDescription: string | null; isPublished: boolean; sortOrder: number }> }) {
  const [current, setCurrent] = useState(pages[0]?.slug ?? 'new');
  const p = pages.find((x) => x.slug === current);
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[15px] font-bold">Информационные страницы</h2>
        {pages.map((x) => <button key={x.slug} type="button" className={`chip min-h-7 text-[12px] ${current === x.slug ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`} onClick={() => setCurrent(x.slug)}>{x.title}</button>)}
        <button type="button" className={`chip min-h-7 text-[12px] ${current === 'new' ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`} onClick={() => setCurrent('new')}>+ новая</button>
      </div>
      <ActionForm key={current} action={savePageAction} submitLabel="Сохранить страницу">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Slug (/info/…)"><input name="slug" className="input min-h-9" defaultValue={p?.slug ?? ''} required /></Field>
          <Field label="Заголовок"><input name="title" className="input min-h-9" defaultValue={p?.title ?? ''} required /></Field>
          <Field label="Порядок"><input name="sortOrder" type="number" className="input min-h-9" defaultValue={p?.sortOrder ?? 0} /></Field>
          <Field label="SEO title"><input name="seoTitle" className="input min-h-9" defaultValue={p?.seoTitle ?? ''} /></Field>
          <Field label="SEO description"><input name="seoDescription" className="input min-h-9" defaultValue={p?.seoDescription ?? ''} /></Field>
          <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isPublished" defaultChecked={p?.isPublished ?? true} className="size-4 accent-brand-500" /> Опубликована</label>
        </div>
        <Field label="Текст (markdown: ## заголовки, списки, таблицы, **жирный**, [ссылки](/url))"><textarea name="body" className="input min-h-64 py-2 font-mono text-[12px]" defaultValue={p?.body ?? ''} /></Field>
      </ActionForm>
    </section>
  );
}

export function FaqEditor({ items }: { items: Array<{ id: string; question: string; answer: string; category: string; sortOrder: number; isActive: boolean }> }) {
  const [adding, setAdding] = useState(false);
  const form = (f?: (typeof items)[number]) => (
    <ActionForm key={f?.id ?? 'new'} action={saveFaqAction} submitLabel="Сохранить" className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={() => setAdding(false)}>
      {f && <input type="hidden" name="id" value={f.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_80px_auto]">
        <Field label="Вопрос"><input name="question" className="input min-h-9" defaultValue={f?.question ?? ''} required /></Field>
        <Field label="Раздел"><input name="category" className="input min-h-9" defaultValue={f?.category ?? 'Общие'} /></Field>
        <Field label="Порядок"><input name="sortOrder" type="number" className="input min-h-9" defaultValue={f?.sortOrder ?? 0} /></Field>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={f?.isActive ?? true} className="size-4 accent-brand-500" /> активен</label>
      </div>
      <Field label="Ответ"><textarea name="answer" className="input min-h-16 py-1.5" defaultValue={f?.answer ?? ''} required /></Field>
      {f && <ActionButton action={() => deleteFaqAction(f.id)} confirm="Удалить вопрос?" className="mt-1 text-[12px] text-danger-500 hover:underline">удалить</ActionButton>}
    </ActionForm>
  );
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">FAQ</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Вопрос'}</button></div>
      <div className="space-y-3">{adding && form()}{items.map((f) => form(f))}</div>
    </section>
  );
}

export function BrandsEditor({ brands }: { brands: Array<{ slug: string; name: string; isPopular: boolean; sortOrder: number; description: string | null }> }) {
  const [adding, setAdding] = useState(false);
  const form = (b?: (typeof brands)[number]) => (
    <ActionForm key={b?.slug ?? 'new'} action={saveBrandAction} submitLabel="Сохранить" className="rounded-[var(--radius-md)] border border-ink-200 p-3" onDone={() => setAdding(false)}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_90px_auto]">
        <Field label="Название"><input name="name" className="input min-h-9" defaultValue={b?.name ?? ''} required /></Field>
        <Field label="Slug"><input name="slug" className="input min-h-9" defaultValue={b?.slug ?? ''} readOnly={Boolean(b)} /></Field>
        <Field label="Порядок"><input name="sortOrder" type="number" className="input min-h-9" defaultValue={b?.sortOrder ?? 100} /></Field>
        <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isPopular" defaultChecked={b?.isPopular ?? false} className="size-4 accent-brand-500" /> на главной</label>
      </div>
      <Field label="Описание"><input name="description" className="input min-h-9" defaultValue={b?.description ?? ''} /></Field>
    </ActionForm>
  );
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-bold">Бренды товаров</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? 'Отмена' : '+ Бренд'}</button></div>
      <div className="space-y-3">{adding && form()}{brands.map((b) => form(b))}</div>
    </section>
  );
}
