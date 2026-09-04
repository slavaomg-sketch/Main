import Link from 'next/link';
import { Info } from 'lucide-react';
import type { CompatibilityResult } from '@techmatch/domain';
import { CompatBadge } from '@/components/ui/compat-badge';
import { DeviceSearchBox } from '@/components/devices/device-search-box';

/** Блок совместимости на странице товара: вердикт для активного устройства + объяснение + ограничения. */
export function CompatPanel({ device, result, devicesCount }: { device: { name: string; slug: string } | null; result: CompatibilityResult | null; devicesCount: number }) {
  return (
    <section className="card p-5" aria-labelledby="compat-heading" data-testid="compat-panel">
      <h2 id="compat-heading" className="h3 mb-3">Совместимость</h2>
      {device && result ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CompatBadge status={result.status} />
            <span className="text-[13px] text-ink-600">с <Link href={`/device/${device.slug}`} className="font-semibold text-ink-900 hover:underline">{device.name}</Link></span>
            {result.source !== 'RULE' && <span className="badge bg-ink-100 text-ink-600">{result.source === 'MANUFACTURER' ? 'подтверждено производителем' : result.source === 'ADMIN_OVERRIDE' ? 'решение специалиста' : result.source === 'IMPORT' ? 'по данным поставщика' : 'подтверждено специалистом'}</span>}
          </div>
          <p className="mt-3 text-[14px] text-ink-800" data-testid="compat-explanation">{result.explanation}</p>
          {result.reasons.length > 0 && (
            <ul className="mt-3 space-y-1 text-[13px] text-ink-700">
              {result.reasons.map((r) => (
                <li key={r} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink-400" />{r}</li>
              ))}
            </ul>
          )}
          {result.limitations.length > 0 && (
            <div className="mt-3 rounded-[var(--radius-md)] bg-warning-100 p-3 text-[13px] text-ink-800">
              <div className="mb-1 font-semibold text-warning-500">Ограничения</div>
              <ul className="space-y-1">
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {result.constraints.length > 0 && (
            <ul className="mt-3 space-y-1 text-[13px] text-ink-600">
              {result.constraints.map((c) => (
                <li key={c.kind + c.description} className="flex items-center gap-1.5"><Info width={14} height={14} className="shrink-0 text-brand-500" /> {c.description}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] text-ink-400">
            Правила: {result.rulesApplied.join(', ') || '—'} · уверенность {Math.round(result.confidence * 100)}%
            {result.verifiedAt && ` · проверено ${new Date(result.verifiedAt).toLocaleDateString('ru-RU')}`}
          </p>
        </div>
      ) : (
        <div>
          <p className="text-[13px] text-ink-600">Укажите своё устройство — покажем, подойдёт ли этот товар и с какими ограничениями.</p>
          <div className="mt-3">
            <DeviceSearchBox placeholder="Ваше устройство, например iPhone 15 Pro" popular={[]} />
          </div>
        </div>
      )}
      <p className="mt-4 text-[13px] text-ink-600">
        Подходит для <b className="text-ink-900">{devicesCount}</b> устройств из нашей базы — список ниже.
      </p>
    </section>
  );
}
