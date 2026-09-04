import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { getMarketplaceAdapters, listImportJobs } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { formatDateTime } from '@/lib/format';

const STATUS: Record<string, string> = { UPLOADED: 'Загружен', ANALYZED: 'Проанализирован', MAPPED: 'Сопоставлен', VALIDATED: 'Проверен', DRY_RUN_COMPLETE: 'Предпросмотр готов', APPLYING: 'Применяется', COMPLETED: 'Завершён', FAILED: 'Ошибка', CANCELLED: 'Отменён' };

export default async function AdminImports() {
  await requireAdmin('imports.read');
  const [jobs, runs] = await Promise.all([listImportJobs(prisma, 50), prisma.syncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20, include: { source: true } })]);
  const adapters = getMarketplaceAdapters();
  return (
    <AdminPage title="Импорт и синхронизация" description="CSV, XLSX, YML и официальные API маркетплейсов" actions={<Link href="/admin/imports/new" className="btn btn-primary btn-sm">+ Загрузить файл</Link>}>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section>
          <h2 className="mb-2 text-[15px] font-bold">История запусков</h2>
          <Table>
            <thead><tr><th>Файл / источник</th><th>Статус</th><th>Строк</th><th>Создать / обновить / пропустить / конфликт / ошибка</th><th>Проблем</th><th>Кто</th><th>Когда</th></tr></thead>
            <tbody>
              {jobs.length === 0 && <tr><td colSpan={7} className="text-ink-500">Импортов ещё не было</td></tr>}
              {jobs.map((j) => {
                const s = j.summary as Record<string, number>;
                return (
                  <tr key={j.id} data-testid="import-row">
                    <td><Link href={`/admin/imports/${j.id}`} className="font-semibold text-brand-600">{j.fileName ?? j.source?.name}</Link><div className="text-[12px] text-ink-500">{j.source?.name} · {j.type}</div></td>
                    <td><span className={`badge ${j.status === 'COMPLETED' ? 'bg-success-100 text-success-500' : j.status === 'FAILED' ? 'bg-danger-100 text-danger-500' : 'bg-ink-100 text-ink-600'}`}>{STATUS[j.status] ?? j.status}</span></td>
                    <td>{j._count.rows}</td>
                    <td className="text-[12px]">{s.create !== undefined ? `${s.create} / ${s.update} / ${s.skip} / ${s.conflict} / ${s.error}` : '—'}</td>
                    <td>{j._count.issues}</td>
                    <td>{j.createdBy?.name ?? '—'}</td>
                    <td>{formatDateTime(j.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-2 text-[15px] font-bold">Маркетплейсы (официальные API)</h2>
            <ul className="space-y-2 text-[13px]">
              {adapters.map((a) => <li key={a.code} className="flex items-center justify-between"><span>{a.name}</span><span className={`badge ${a.isConfigured() ? 'bg-success-100 text-success-500' : 'bg-warning-100 text-warning-500'}`}>{a.isConfigured() ? 'подключён' : 'нет ключей'}</span></li>)}
            </ul>
            <p className="mt-3 text-[12px] text-ink-500">Ключи задаются в .env (WILDBERRIES_API_TOKEN, OZON_CLIENT_ID/OZON_API_KEY, YANDEX_MARKET_OAUTH_TOKEN/CAMPAIGN_ID). После подключения синхронизация запускается воркером по расписанию и проходит тот же конвейер: анализ → dry-run → применение. Парсинг публичных страниц не используется.</p>
          </section>
          <section className="card p-5">
            <h2 className="mb-2 text-[15px] font-bold">Экспорт</h2>
            <ul className="space-y-1.5 text-[13px]">
              <li><a href="/api/admin/export/catalog.csv" className="text-brand-600 underline">Каталог CSV</a></li>
              <li><a href="/api/admin/export/catalog.xlsx" className="text-brand-600 underline">Каталог XLSX</a></li>
              <li><a href="/api/admin/export/prices-stocks.csv" className="text-brand-600 underline">Цены и остатки CSV</a></li>
              <li><a href="/api/admin/export/compatibility.csv" className="text-brand-600 underline">Связи совместимости CSV</a></li>
              <li><a href="/api/admin/export/feed.yml" className="text-brand-600 underline">YML-фид каталога</a></li>
              <li><a href="/import-sample.csv" className="text-ink-600 underline">Пример файла импорта (CSV)</a></li>
            </ul>
          </section>
          {runs.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-2 text-[15px] font-bold">Синхронизации</h2>
              <ul className="space-y-1 text-[12.5px]">{runs.slice(0, 8).map((r) => <li key={r.id}>{formatDateTime(r.startedAt)} · {r.source.name} · {r.status}{r.error ? ` · ${r.error}` : ''}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </AdminPage>
  );
}
