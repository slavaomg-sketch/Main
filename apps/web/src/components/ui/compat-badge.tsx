import { AlertTriangle, BadgeCheck, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { CompatibilityStatus } from '@techmatch/domain';

const CFG: Record<CompatibilityStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  VERIFIED: { label: 'Проверено', cls: 'bg-success-100 text-success-500', Icon: BadgeCheck },
  COMPATIBLE: { label: 'Полностью совместимо', cls: 'bg-success-100 text-success-500', Icon: CheckCircle2 },
  COMPATIBLE_WITH_LIMITATIONS: { label: 'Совместимо с ограничениями', cls: 'bg-warning-100 text-warning-500', Icon: AlertTriangle },
  UNKNOWN: { label: 'Совместимость не подтверждена', cls: 'bg-ink-100 text-ink-500', Icon: HelpCircle },
  INCOMPATIBLE: { label: 'Не совместимо', cls: 'bg-danger-100 text-danger-500', Icon: XCircle },
};

export function compatLabel(status: CompatibilityStatus) {
  return CFG[status].label;
}

export function CompatBadge({ status, short = false, className = '' }: { status: CompatibilityStatus; short?: boolean; className?: string }) {
  const c = CFG[status];
  const label = short ? (status === 'COMPATIBLE_WITH_LIMITATIONS' ? 'С ограничениями' : status === 'UNKNOWN' ? 'Не подтверждено' : c.label) : c.label;
  return (
    <span className={`badge gap-1 ${c.cls} ${className}`}>
      <c.Icon width={13} height={13} aria-hidden="true" />
      {label}
    </span>
  );
}
