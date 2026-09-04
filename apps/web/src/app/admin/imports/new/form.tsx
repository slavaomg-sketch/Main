'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { uploadImportAction } from '@/server/actions/admin/imports';
import { Field } from '@/components/admin/ui';
import type { ActionResult } from '@/lib/errors';

export function UploadForm({ sources }: { sources: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<ActionResult<undefined> | null, FormData>(uploadImportAction, null);
  return (
    <form action={action} className="card max-w-xl space-y-4 p-5" data-testid="import-upload">
      <Field label="Файл (CSV, XLSX, YML/XML)"><input type="file" name="file" accept=".csv,.txt,.xlsx,.xls,.yml,.xml" required className="text-[13px]" data-testid="import-file" /></Field>
      <Field label="Источник" hint="Определяет ключ идемпотентности: внешний ID уникален в рамках источника"><select name="sourceCode" className="input"><option value="">Автоматически по типу файла</option>{sources.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
      {state && !state.ok && <p className="text-[13px] text-danger-500" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending} data-testid="import-submit">{pending ? <Loader2 width={14} height={14} className="animate-spin" /> : null} Загрузить и проанализировать</button>
      <p className="text-[12px] text-ink-500">Обязателен столбец с внешним ID (артикул источника). Цены в рублях, остатки в штуках, изображения — ссылками через «;». Столбец «Совместимые устройства» принимает slug устройств через «;». Повторная загрузка того же файла не создаёт дублей.</p>
    </form>
  );
}
