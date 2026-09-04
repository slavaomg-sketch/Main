'use client';

import { CANONICAL_FIELDS } from '@techmatch/integrations/imports';
import { ActionButton, ActionForm } from '@/components/admin/action-form';
import { applyImportAction, rerunDryRunAction, setMappingAction } from '@/server/actions/admin/imports';

export function MappingForm({ jobId, headers, mapping, sample, options }: { jobId: string; headers: string[]; mapping: Record<string, string>; sample: Array<Record<string, string>>; options: { sourceOwnedFields: string[]; createMissing: boolean; activateCreated: boolean; downloadImages: boolean } }) {
  return (
    <ActionForm action={(fd) => setMappingAction(jobId, fd)} submitLabel="Проверить и выполнить dry-run" className="card p-5">
      <h2 className="mb-1 text-[15px] font-bold">2. Сопоставление столбцов</h2>
      <p className="mb-3 text-[12px] text-ink-500">Для каждого столбца файла выберите поле каталога. Несопоставленные столбцы сохранятся как атрибуты.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[11px] tracking-wider text-ink-500 uppercase"><th className="py-1.5 pr-3">Столбец файла</th><th className="py-1.5 pr-3">Пример</th><th className="py-1.5">Поле каталога</th></tr></thead>
          <tbody>
            {headers.map((h) => (
              <tr key={h} className="border-t border-ink-100">
                <td className="py-1.5 pr-3 font-medium">{h}</td>
                <td className="py-1.5 pr-3 text-ink-500">{sample.map((r) => r[h]).filter(Boolean).slice(0, 2).join(' · ').slice(0, 60)}</td>
                <td className="py-1.5">
                  <select name={`map:${h}`} className="input min-h-9 w-auto" defaultValue={mapping[h] ?? ''} data-testid={`map-${h}`}>
                    <option value="">— не импортировать —</option>
                    {CANONICAL_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}{f.required ? ' *' : ''}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-1.5 text-[13px] font-semibold">Какими полями управляет источник при обновлении</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          {([['price', 'цена'], ['stock', 'остаток'], ['name', 'название'], ['description', 'описание'], ['images', 'изображения']] as Array<[string, string]>).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="owned" value={k} defaultChecked={options.sourceOwnedFields.includes(k)} className="size-4 accent-brand-500" /> {l}</label>)}
        </div>
        <p className="mt-1 text-[12px] text-ink-500">Поля, закреплённые вручную в карточке товара, не перезаписываются в любом случае.</p>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="createMissing" defaultChecked={options.createMissing} className="size-4 accent-brand-500" /> создавать новые товары</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="activateCreated" defaultChecked={options.activateCreated} className="size-4 accent-brand-500" /> сразу активировать созданные (при наличии цены)</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="downloadImages" defaultChecked={options.downloadImages} className="size-4 accent-brand-500" /> скачивать изображения по ссылкам</label>
      </div>
    </ActionForm>
  );
}

export function ApplyPanel({ jobId, summary, status }: { jobId: string; summary: Record<string, number>; status: string }) {
  const applicable = (summary.create ?? 0) + (summary.update ?? 0);
  return (
    <section className="card p-5" data-testid="apply-panel">
      <h2 className="mb-1 text-[15px] font-bold">3. Отчёт dry-run и применение</h2>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([['create', 'Создастся', 'text-success-500'], ['update', 'Обновится', 'text-brand-600'], ['skip', 'Пропустится', 'text-ink-500'], ['conflict', 'Конфликт', 'text-warning-500'], ['error', 'Ошибка', 'text-danger-500']] as Array<[string, string, string]>).map(([k, l, c]) => (
          <div key={k} className="rounded-[var(--radius-md)] bg-ink-50 p-3"><div className="text-[11px] text-ink-500 uppercase">{l}</div><div className={`text-[22px] font-bold ${c}`} data-testid={`summary-${k}`}>{summary[k] ?? 0}</div></div>
        ))}
      </div>
      {status === 'DRY_RUN_COMPLETE' ? (
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton action={() => applyImportAction(jobId)} confirm={`Применить ${applicable} изменений к каталогу?`} className="btn btn-primary btn-sm">Применить {applicable} изменений</ActionButton>
          <ActionButton action={() => rerunDryRunAction(jobId)} className="btn btn-outline btn-sm">Пересчитать dry-run</ActionButton>
          <span className="text-[12px] text-ink-500">Строки с ошибками и конфликтами не применяются. Применение идемпотентно.</span>
        </div>
      ) : status === 'COMPLETED' ? (
        <p className="text-[13px] text-success-500">Импорт применён{summary.applied ? `: создано ${(summary.applied as unknown as Record<string, number>).created}, обновлено ${(summary.applied as unknown as Record<string, number>).updated}, ошибок ${(summary.applied as unknown as Record<string, number>).failed}` : ''}. Повторная загрузка этого файла покажет «пропустится» для всех строк без изменений.</p>
      ) : (
        <p className="text-[13px] text-ink-500">Статус: {status}</p>
      )}
    </section>
  );
}
