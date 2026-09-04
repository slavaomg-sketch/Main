import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { listAutoCandidates, listProductsWithoutVerifiedCompatibility } from '@techmatch/domain';
import { requireAdmin } from '@/lib/admin';
import { AdminPage, Table } from '@/components/admin/ui';
import { CompatBadge } from '@/components/ui/compat-badge';
import { CompatTools } from '@/components/admin/compat-tools';
import { ActionButton } from '@/components/admin/action-form';
import { confirmCandidateAction, deactivateRelationAction, removeOverrideAction } from '@/server/actions/admin/compatibility';
import { formatDateTime } from '@/lib/format';

export default async function AdminCompatibility({ searchParams }: { searchParams: Promise<{ product?: string; device?: string; tab?: string }> }) {
  await requireAdmin('compatibility.read');
  const sp = await searchParams;
  const tab = sp.tab ?? 'explicit';
  const [products, devices, explicit, candidates, unverified, overrides, rules, history] = await Promise.all([
    prisma.product.findMany({ where: { status: { not: 'ARCHIVED' } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.deviceModel.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    prisma.compatibilityRelation.findMany({ where: { isActive: true, source: { in: ['EXPLICIT', 'MANUFACTURER', 'IMPORT'] }, ...(sp.product ? { productId: sp.product } : {}), ...(sp.device ? { deviceModelId: sp.device } : {}) }, include: { product: { select: { name: true, id: true } }, deviceModel: { select: { fullName: true, id: true } }, verifiedBy: { select: { name: true } }, evidence: true }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    tab === 'candidates' ? listAutoCandidates(prisma, { limit: 100 }) : [],
    tab === 'unverified' ? listProductsWithoutVerifiedCompatibility(prisma, 100) : [],
    prisma.compatibilityOverride.findMany({ where: { isActive: true }, include: { product: { select: { name: true } }, deviceModel: { select: { fullName: true } }, admin: { select: { name: true } } }, orderBy: { updatedAt: 'desc' } }),
    tab === 'rules' ? prisma.compatibilityRule.findMany({ orderBy: { priority: 'asc' } }) : [],
    tab === 'history' ? prisma.auditLog.findMany({ where: { action: { startsWith: 'compatibility.' } }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
  ]);
  const tabs = [['explicit', 'Явные связи'], ['candidates', 'Автокандидаты'], ['unverified', 'Без подтверждения'], ['overrides', 'Override'], ['rules', 'Правила движка'], ['history', 'История']];
  return (
    <AdminPage title="Совместимость" description="Явные связи, правила, автоматические кандидаты, подтверждение и запрет">
      <CompatTools products={products.map((p) => ({ id: p.id, label: p.name }))} devices={devices.map((d) => ({ id: d.id, label: d.fullName }))} initialProduct={sp.product ?? ''} initialDevice={sp.device ?? ''} />
      <div className="mt-6 mb-3 flex flex-wrap gap-2">
        {tabs.map(([t, l]) => <Link key={t} href={`/admin/compatibility?tab=${t}${sp.product ? `&product=${sp.product}` : ''}${sp.device ? `&device=${sp.device}` : ''}`} className={`chip ${tab === t ? 'bg-ink-900 text-white hover:bg-ink-800' : ''}`}>{l}</Link>)}
      </div>
      {tab === 'explicit' && (
        <Table>
          <thead><tr><th>Товар</th><th>Устройство</th><th>Статус</th><th>Источник</th><th>Подтверждение</th><th>Обновлено</th><th></th></tr></thead>
          <tbody>
            {explicit.length === 0 && <tr><td colSpan={7} className="text-ink-500">Нет явных связей</td></tr>}
            {explicit.map((r) => (
              <tr key={r.id} data-testid="relation-row">
                <td><Link href={`/admin/products/${r.product.id}`} className="text-brand-600">{r.product.name}</Link></td>
                <td><Link href={`/admin/devices/${r.deviceModel.id}`} className="text-brand-600">{r.deviceModel.fullName}</Link></td>
                <td><CompatBadge status={r.status} short /></td>
                <td>{r.source}</td>
                <td className="text-[12px] text-ink-500">{r.evidence.map((e) => e.type).join(', ') || '—'}{r.verifiedBy ? ` · ${r.verifiedBy.name}` : ''}</td>
                <td>{formatDateTime(r.updatedAt)}</td>
                <td><ActionButton action={deactivateRelationAction.bind(null, r.id)} confirm="Деактивировать связь?" className="text-[12px] text-danger-500 hover:underline">снять</ActionButton></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {tab === 'candidates' && (
        <>
          <p className="mb-2 text-[12px] text-ink-500">Правиловые связи с уверенностью ≥ 85%, ещё не подтверждённые явно. Подтверждение переводит их в VERIFIED.</p>
          <Table>
            <thead><tr><th>Товар</th><th>Устройство</th><th>Статус</th><th>Уверенность</th><th>Правила</th><th></th></tr></thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}><td>{c.product.name}</td><td>{c.deviceModel.name}</td><td><CompatBadge status={c.status} short /></td><td>{Math.round(c.confidence * 100)}%</td><td className="text-[12px] text-ink-500">{c.rulesApplied.join(', ')}</td><td><ActionButton action={confirmCandidateAction.bind(null, c.id)} className="btn btn-outline btn-sm min-h-8">Подтвердить</ActionButton></td></tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {tab === 'unverified' && (
        <Table>
          <thead><tr><th>Товар</th><th>Категория</th><th></th></tr></thead>
          <tbody>{unverified.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.category.name}</td><td><Link href={`/admin/compatibility?product=${p.id}`} className="text-brand-600">выбрать</Link></td></tr>)}</tbody>
        </Table>
      )}
      {tab === 'overrides' && (
        <Table>
          <thead><tr><th>Товар</th><th>Устройство</th><th>Вердикт</th><th>Причина</th><th>Кто</th><th></th></tr></thead>
          <tbody>
            {overrides.length === 0 && <tr><td colSpan={6} className="text-ink-500">Нет override</td></tr>}
            {overrides.map((o) => <tr key={o.id}><td>{o.product.name}</td><td>{o.deviceModel.fullName}</td><td><CompatBadge status={o.status} short /></td><td>{o.reason}</td><td>{o.admin?.name ?? '—'}</td><td><ActionButton action={removeOverrideAction.bind(null, o.id)} confirm="Снять override?" className="text-[12px] text-danger-500 hover:underline">снять</ActionButton></td></tr>)}
          </tbody>
        </Table>
      )}
      {tab === 'rules' && (
        <div className="card p-5 text-[13px]">
          <p className="mb-3 text-ink-600">Правила движка реализованы в коде (packages/domain/src/compatibility/rules.ts) и версионируются вместе с релизом. Таблица CompatibilityRule хранит их настройки и позволяет отключать правило.</p>
          <ul className="space-y-1.5">
            {['CATEGORY_SCOPE — область применения аксессуара', 'CONSUMABLE_MATCH — коды картриджей, чернил, батарей', 'FIT_MODEL_LIST — явный список моделей (чехлы, стёкла)', 'BAND_SIZE — размер ремешка', 'CONNECTOR_MATCH — совпадение разъёмов', 'PLATFORM_MATCH — платформа, карты памяти, наушники', 'POWER_DELIVERY — USB PD / PPS / QC, ватты, профили напряжения', 'WIRELESS_CHARGING — Qi / Qi2 / MagSafe', 'DISPLAY_OUTPUT — DP Alt Mode, Thunderbolt, HDMI', 'DATA_TRANSFER — версии USB и скорость', 'PHYSICAL_FIT — VESA, диагональ, автодержатели'].map((r) => <li key={r}>• {r}</li>)}
          </ul>
          {rules.length > 0 && <p className="mt-3 text-ink-500">Настроек в БД: {rules.length}</p>}
        </div>
      )}
      {tab === 'history' && (
        <Table>
          <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Данные</th></tr></thead>
          <tbody>{history.map((h) => <tr key={h.id}><td>{formatDateTime(h.createdAt)}</td><td>{h.actorEmail}</td><td>{h.action}</td><td className="font-mono text-[11px] text-ink-500">{JSON.stringify(h.after ?? h.before ?? {}).slice(0, 120)}</td></tr>)}</tbody>
        </Table>
      )}
    </AdminPage>
  );
}
