import { prisma } from '@techmatch/database';
import { listAudit } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/format';

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ entityType?: string; action?: string; page?: string }> }) {
  await requireAdmin('audit.read');
  const sp = await searchParams;
  const res = await listAudit(prisma, { entityType: sp.entityType || null, action: sp.action || null, page: Number(sp.page ?? 1) || 1 });
  return (
    <AdminPage title="Аудит" description="Кто, что изменил, когда, старое и новое значение">
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input name="entityType" defaultValue={sp.entityType ?? ''} className="input min-h-9 w-auto" placeholder="Тип объекта (Product, Order…)" aria-label="Тип объекта" />
        <input name="action" defaultValue={sp.action ?? ''} className="input min-h-9 w-auto" placeholder="Действие (product.update…)" aria-label="Действие" />
        <button type="submit" className="btn btn-outline btn-sm">Фильтровать</button>
      </form>
      <Table>
        <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Было</th><th>Стало</th></tr></thead>
        <tbody>
          {res.items.map((a) => (
            <tr key={a.id} className="align-top">
              <td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
              <td>{a.actorEmail ?? a.actorType}<div className="text-[11px] text-ink-400">{a.ip ?? ''}</div></td>
              <td className="font-medium">{a.action}</td>
              <td className="text-ink-600">{a.entityType}<div className="font-mono text-[11px] text-ink-400">{a.entityId?.slice(0, 12)}</div></td>
              <td className="max-w-[260px] font-mono text-[11px] whitespace-pre-wrap text-ink-500">{a.before ? JSON.stringify(a.before, null, 0).slice(0, 300) : '—'}</td>
              <td className="max-w-[260px] font-mono text-[11px] whitespace-pre-wrap text-ink-700">{a.after ? JSON.stringify(a.after, null, 0).slice(0, 300) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={res.page} pages={res.pages} hrefFor={(p) => `/admin/audit?${new URLSearchParams({ ...(sp.entityType ? { entityType: sp.entityType } : {}), ...(sp.action ? { action: sp.action } : {}), page: String(p) })}`} />
    </AdminPage>
  );
}
