import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@techmatch/database';
import { getImportJob, listImportRows, NotFoundError } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { ApplyPanel, MappingForm } from '@/components/admin/import-job';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/format';

const ACTION_CLS: Record<string, string> = { CREATE: 'bg-success-100 text-success-500', UPDATE: 'bg-brand-50 text-brand-600', SKIP: 'bg-ink-100 text-ink-500', CONFLICT: 'bg-warning-100 text-warning-500', ERROR: 'bg-danger-100 text-danger-500', PENDING: 'bg-ink-100 text-ink-500' };

export default async function ImportJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string; page?: string }> }) {
  await requireAdmin('imports.read');
  const { id } = await params;
  const sp = await searchParams;
  let job: Awaited<ReturnType<typeof getImportJob>>;
  try {
    job = await getImportJob(prisma, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const analysis = job.analysis as { headers: string[]; sample: Array<Record<string, string>>; totalRows: number; previousJobId?: string | null; previousJobAt?: string | null };
  const rows = await listImportRows(prisma, id, { action: sp.action ?? null, page: Number(sp.page ?? 1) || 1, perPage: 50 });
  const issues = await prisma.importIssue.findMany({ where: { jobId: id, rowId: null }, take: 20 });
  const summary = job.summary as Record<string, number>;
  return (
    <AdminPage title={job.fileName ?? 'Импорт'} description={`${job.source?.name} · ${analysis.totalRows} строк · загружен ${formatDateTime(job.createdAt)}${job.createdBy ? ` · ${job.createdBy.name}` : ''}`} actions={<Link href="/admin/imports" className="btn btn-outline btn-sm">← Все импорты</Link>}>
      {analysis.previousJobId && <p className="mb-4 rounded-[var(--radius-md)] bg-brand-50 px-4 py-2.5 text-[13px] text-brand-700">Этот файл уже импортировался {analysis.previousJobAt ? formatDateTime(analysis.previousJobAt) : ''} (<Link href={`/admin/imports/${analysis.previousJobId}`} className="underline">задание</Link>). Повторное применение не создаст дубликаты — неизменённые строки будут пропущены.</p>}
      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="mb-2 text-[15px] font-bold">1. Анализ файла</h2>
          <p className="text-[13px] text-ink-600">Столбцы: {analysis.headers.join(', ')}</p>
        </section>
        {job.status !== 'COMPLETED' && job.status !== 'APPLYING' && (
          <MappingForm jobId={id} headers={analysis.headers} mapping={job.mapping as Record<string, string>} sample={analysis.sample} options={{ sourceOwnedFields: ['price', 'stock'], createMissing: true, activateCreated: true, downloadImages: false, ...(job.options as object) }} />
        )}
        {(job.status === 'DRY_RUN_COMPLETE' || job.status === 'COMPLETED' || job.status === 'FAILED') && <ApplyPanel jobId={id} summary={summary} status={job.status} />}
        {issues.length > 0 && <section className="card p-5"><h2 className="mb-2 text-[15px] font-bold">Общие проблемы</h2><ul className="text-[13px]">{issues.map((i) => <li key={i.id}>[{i.level}] {i.message}</li>)}</ul></section>}
        {summary.total !== undefined && (
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-bold">Строки</h2>
              {['', 'CREATE', 'UPDATE', 'SKIP', 'CONFLICT', 'ERROR'].map((a) => <Link key={a} href={`/admin/imports/${id}${a ? `?action=${a}` : ''}`} className={`chip min-h-7 text-[12px] ${(sp.action ?? '') === a ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`}>{a || 'все'}</Link>)}
            </div>
            <Table>
              <thead><tr><th>#</th><th>Внешний ID</th><th>Действие</th><th>Название</th><th>Изменения / сообщение</th><th>Проблемы</th></tr></thead>
              <tbody>
                {rows.items.map((r) => {
                  const n = r.normalizedData as Record<string, unknown> | null;
                  const diff = (r.diff as { changes?: Record<string, { from: unknown; to: unknown }> } | null)?.changes ?? {};
                  return (
                    <tr key={r.id}>
                      <td>{r.rowNumber}</td>
                      <td className="font-mono text-[12px]">{r.externalId ?? '—'}</td>
                      <td><span className={`badge ${ACTION_CLS[r.action]}`}>{r.action}</span></td>
                      <td>{(n?.name as string) ?? (r.rawData as Record<string, string>)[Object.keys(r.rawData as object)[1] ?? ''] ?? ''}{r.matchedProductId && <Link href={`/admin/products/${r.matchedProductId}`} className="ml-2 text-[12px] text-brand-600">товар</Link>}</td>
                      <td className="text-[12px] text-ink-600">{Object.entries(diff).map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`).join('; ').slice(0, 160) || r.message}</td>
                      <td className="text-[12px]">{r.issues.map((i) => <div key={i.id} className={i.level === 'ERROR' ? 'text-danger-500' : i.level === 'WARNING' ? 'text-warning-500' : 'text-ink-500'}>{i.message}</div>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={rows.page} pages={rows.pages} hrefFor={(p) => `/admin/imports/${id}?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), page: String(p) })}`} />
          </section>
        )}
      </div>
    </AdminPage>
  );
}
