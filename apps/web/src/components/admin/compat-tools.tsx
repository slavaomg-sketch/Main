'use client';

import { useState, useTransition } from 'react';
import type { CompatibilityResult } from '@techmatch/domain';
import { ActionForm } from '@/components/admin/action-form';
import { Field } from '@/components/admin/ui';
import { CompatBadge } from '@/components/ui/compat-badge';
import { checkPairAction, saveOverrideAction, saveRelationAction } from '@/server/actions/admin/compatibility';

type Opt = { id: string; label: string };

export function PairPicker({ products, devices, productId, deviceId, onChange }: { products: Opt[]; devices: Opt[]; productId: string; deviceId: string; onChange: (p: string, d: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="Товар"><select name="productId" className="input min-h-9" value={productId} onChange={(e) => onChange(e.target.value, deviceId)} data-testid="pick-product"><option value="">— выберите —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
      <Field label="Устройство"><select name="deviceModelId" className="input min-h-9" value={deviceId} onChange={(e) => onChange(productId, e.target.value)} data-testid="pick-device"><option value="">— выберите —</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
    </div>
  );
}

export function CompatTools({ products, devices, initialProduct, initialDevice }: { products: Opt[]; devices: Opt[]; initialProduct: string; initialDevice: string }) {
  const [productId, setProductId] = useState(initialProduct);
  const [deviceId, setDeviceId] = useState(initialDevice);
  const [result, setResult] = useState<CompatibilityResult | null>(null);
  const [pending, start] = useTransition();
  const pick = (p: string, d: string) => {
    setProductId(p);
    setDeviceId(d);
    setResult(null);
  };
  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="mb-3 text-[15px] font-bold">Проверить пару «товар — устройство»</h2>
        <PairPicker products={products} devices={devices} productId={productId} deviceId={deviceId} onChange={pick} />
        <button type="button" className="btn btn-outline btn-sm mt-3" disabled={!productId || !deviceId || pending} data-testid="check-pair" onClick={() => start(async () => { const r = await checkPairAction(productId, deviceId); setResult(r.ok ? r.data : null); })}>
          Проверить движком
        </button>
        {result && (
          <div className="mt-4 rounded-[var(--radius-md)] bg-ink-50 p-4 text-[13px]" data-testid="check-result">
            <div className="flex flex-wrap items-center gap-2"><CompatBadge status={result.status} /><span className="text-ink-500">источник: {result.source} · уверенность {Math.round(result.confidence * 100)}% · правила: {result.rulesApplied.join(', ') || '—'}</span></div>
            <p className="mt-2">{result.explanation}</p>
            {result.reasons.length > 0 && <ul className="mt-2 list-disc pl-5">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            {result.limitations.length > 0 && <ul className="mt-2 list-disc pl-5 text-warning-500">{result.limitations.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
        )}
      </section>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-1 text-[15px] font-bold">Явная связь</h2>
          <p className="mb-3 text-[12px] text-ink-500">Подтверждение производителя или проверка специалиста. Правила по-прежнему добавят найденные ограничения.</p>
          <ActionForm action={saveRelationAction} submitLabel="Сохранить связь">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="deviceModelId" value={deviceId} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Статус"><select name="status" className="input min-h-9" defaultValue="VERIFIED" data-testid="relation-status"><option value="VERIFIED">Проверено (VERIFIED)</option><option value="COMPATIBLE">Совместимо</option><option value="COMPATIBLE_WITH_LIMITATIONS">С ограничениями</option><option value="INCOMPATIBLE">Не совместимо</option></select></Field>
              <Field label="Источник"><select name="source" className="input min-h-9" defaultValue="EXPLICIT"><option value="EXPLICIT">Специалист TechMatch</option><option value="MANUFACTURER">Производитель</option></select></Field>
              <Field label="Причины (по строке)"><textarea name="reasons" className="input min-h-16 py-1.5" /></Field>
              <Field label="Ограничения (по строке)"><textarea name="limitations" className="input min-h-16 py-1.5" /></Field>
              <Field label="Подтверждение"><select name="evidenceType" className="input min-h-9" defaultValue="ADMIN_CONFIRMED"><option value="">— без записи —</option><option value="MANUFACTURER_DOC">Документ производителя</option><option value="ADMIN_CONFIRMED">Проверено администратором</option><option value="LAB_TEST">Лабораторный тест</option><option value="CUSTOMER_REPORT">Отзыв покупателя</option></select></Field>
              <Field label="Ссылка на источник"><input name="evidenceUrl" className="input min-h-9" placeholder="https://" /></Field>
              <div className="md:col-span-2"><Field label="Примечание"><input name="evidenceNote" className="input min-h-9" /></Field></div>
            </div>
          </ActionForm>
        </section>
        <section className="card p-5">
          <h2 className="mb-1 text-[15px] font-bold">Ручной override</h2>
          <p className="mb-3 text-[12px] text-ink-500">Имеет высший приоритет над правилами и явными связями. Используйте для запрета или принудительного подтверждения.</p>
          <ActionForm action={saveOverrideAction} submitLabel="Применить override" variant="dark">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="deviceModelId" value={deviceId} />
            <Field label="Вердикт"><select name="status" className="input min-h-9" defaultValue="INCOMPATIBLE"><option value="INCOMPATIBLE">Запретить (INCOMPATIBLE)</option><option value="COMPATIBLE_WITH_LIMITATIONS">С ограничениями</option><option value="VERIFIED">Подтвердить (VERIFIED)</option></select></Field>
            <Field label="Причина (видна покупателю)"><input name="reason" className="input min-h-9" required /></Field>
          </ActionForm>
        </section>
      </div>
    </div>
  );
}
