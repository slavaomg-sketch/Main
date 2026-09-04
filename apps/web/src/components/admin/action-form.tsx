'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { ActionResult } from '@/lib/errors';

/** Универсальная форма для server action (FormData) с показом результата и refresh страницы. */
export function ActionForm({ action, children, submitLabel = 'Сохранить', className = '', confirm: confirmText, onDone, variant = 'primary' }: { action: (fd: FormData) => Promise<ActionResult<unknown>>; children?: ReactNode; submitLabel?: string; className?: string; confirm?: string; onDone?: () => void; variant?: 'primary' | 'outline' | 'danger' | 'dark' }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const cls = variant === 'danger' ? 'btn btn-outline text-danger-500' : variant === 'outline' ? 'btn btn-outline' : variant === 'dark' ? 'btn btn-dark' : 'btn btn-primary';
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await action(fd);
          setMsg(r.ok ? { ok: true, text: 'Сохранено' } : { ok: false, text: r.error });
          if (r.ok) {
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      {children}
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className={`${cls} btn-sm`} disabled={pending}>{pending ? <Loader2 width={14} height={14} className="animate-spin" /> : null} {submitLabel}</button>
        {msg && <span className={`text-[12.5px] ${msg.ok ? 'text-success-500' : 'text-danger-500'}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

export function ActionButton({ action, children, confirm: confirmText, className = 'btn btn-outline btn-sm', onDone }: { action: () => Promise<ActionResult<unknown>>; children: ReactNode; confirm?: string; className?: string; onDone?: (r: ActionResult<unknown>) => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirmText && !window.confirm(confirmText)) return;
          start(async () => {
            const r = await action();
            setErr(r.ok ? null : r.error);
            if (r.ok) router.refresh();
            onDone?.(r);
          });
        }}
      >
        {pending ? <Loader2 width={14} height={14} className="animate-spin" /> : null} {children}
      </button>
      {err && <span className="text-[12px] text-danger-500">{err}</span>}
    </span>
  );
}
