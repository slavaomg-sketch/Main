'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { saveDeviceAction, uploadDeviceImageAction } from '@/server/actions/admin/devices';
import { ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import type { ActionResult } from '@/lib/errors';

export interface DeviceFormData {
  id: string | null;
  name: string;
  fullName: string;
  slug: string;
  brandId: string;
  categoryId: string;
  familyName: string;
  generation: string;
  releaseYear: number | null;
  primaryModelNumber: string;
  description: string;
  popularity: number;
  isActive: boolean;
  specsAreDemo: boolean;
  specs: string;
  aliases: string;
  identifiers: string;
  variants: string;
  imageUrl: string | null;
}

const SPEC_EXAMPLE = `{
  "ecosystem": "android",
  "ports": [{ "type": "USB_C", "usbVersion": "3.2 Gen 1", "dataGbps": 5, "dpAltMode": true, "pdIn": true }],
  "charging": { "protocols": ["USB_PD", "PPS"], "maxWatts": 45, "viaUsb": true },
  "wireless": { "qi": true, "qiMaxWatts": 15 },
  "physical": { "caseFamily": "galaxy-s25", "screenInches": 6.2 },
  "audio": { "bluetooth": "5.4", "jack35": false }
}`;

export function DeviceForm({ device, brands, categories }: { device: DeviceFormData; brands: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(saveDeviceAction.bind(null, device.id), null);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form action={action} className="card space-y-4 p-5" data-testid="device-form">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Короткое имя" hint="iPhone 15 Pro"><input name="name" className="input" defaultValue={device.name} required /></Field>
          <Field label="Полное имя" hint="Apple iPhone 15 Pro (2023)"><input name="fullName" className="input" defaultValue={device.fullName} required /></Field>
          <Field label="Бренд"><select name="brandId" className="input" defaultValue={device.brandId} required><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Категория"><select name="categoryId" className="input" defaultValue={device.categoryId} required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Семейство"><input name="familyName" className="input" defaultValue={device.familyName} /></Field>
          <Field label="Поколение"><input name="generation" className="input" defaultValue={device.generation} /></Field>
          <Field label="Год выпуска"><input name="releaseYear" type="number" className="input" defaultValue={device.releaseYear ?? ''} /></Field>
          <Field label="Основной номер модели"><input name="primaryModelNumber" className="input" defaultValue={device.primaryModelNumber} /></Field>
          <Field label="Slug"><input name="slug" className="input" defaultValue={device.slug} /></Field>
          <Field label="Популярность (сортировка)"><input name="popularity" type="number" className="input" defaultValue={device.popularity} /></Field>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={device.isActive} className="size-4 accent-brand-500" /> Активно</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="specsAreDemo" defaultChecked={device.specsAreDemo} className="size-4 accent-brand-500" /> Характеристики демонстрационные (требуют проверки)</label>
        </div>
        <Field label="Описание"><textarea name="description" className="input min-h-16 py-2" defaultValue={device.description} /></Field>
        <Field label="Технические характеристики (JSON для Compatibility Engine)" hint="Ключи: ecosystem, region, ports[], charging{}, wireless{}, consumables{}, physical{}, storage{}, audio{}, display{}"><textarea name="specs" className="input min-h-56 py-2 font-mono text-[12px]" defaultValue={device.specs || SPEC_EXAMPLE} data-testid="device-specs" /></Field>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Синонимы и написания (по одному в строке)" hint="айфон 15 про, iphone15pro, 15 pro"><textarea name="aliases" className="input min-h-28 py-2" defaultValue={device.aliases} /></Field>
          <Field label="Номера моделей (по одному в строке)" hint="A2848 | US  или  MARKETING_CODE:2315C009"><textarea name="identifiers" className="input min-h-28 py-2" defaultValue={device.identifiers} /></Field>
          <Field label="Варианты (slug | Название | JSON характеристик)" hint='42mm | 42 мм | {"physical":{"bandGroup":"apple-small"}}'><textarea name="variants" className="input min-h-28 py-2 font-mono text-[12px]" defaultValue={device.variants} /></Field>
        </div>
        {state && !state.ok && <p className="text-[13px] text-danger-500" role="alert">{state.error}</p>}
        {state?.ok && <p className="text-[13px] text-success-500" role="status">Сохранено. Совместимость пересчитается автоматически.</p>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending} data-testid="device-save">{pending ? <Loader2 width={14} height={14} className="animate-spin" /> : null} Сохранить</button>
      </form>
      {device.id && (
        <section className="card h-fit p-5">
          <h2 className="mb-3 text-[15px] font-bold">Изображение</h2>
          {device.imageUrl && <img src={device.imageUrl} alt="" className="mb-3 size-40 rounded-[var(--radius-md)] border border-ink-200 object-cover" />}
          <ActionForm action={(fd) => uploadDeviceImageAction(device.id!, fd)} submitLabel="Загрузить">
            <input type="file" name="file" accept="image/*" className="text-[13px]" />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
