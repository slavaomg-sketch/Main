'use client';

import { useSearchParams } from 'next/navigation';

/** Сообщение об успехе после redirect с ?ok=... или ?error=... */
export function Flash() {
  const sp = useSearchParams();
  const ok = sp.get('ok');
  const error = sp.get('error');
  if (!ok && !error) return null;
  return <p className={`mb-4 rounded-[var(--radius-md)] px-4 py-2.5 text-[13px] ${error ? 'bg-danger-100 text-danger-500' : 'bg-success-100 text-success-500'}`} role="status">{error ?? ok}</p>;
}
