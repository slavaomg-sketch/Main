import Link from 'next/link';
import type { ReactNode } from 'react';

export function AdminPage({ title, actions, children, description }: { title: string; actions?: ReactNode; description?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold">{title}</h1>
          {description && <p className="text-[13px] text-ink-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`card overflow-x-auto ${className}`}>
      <table className="w-full text-[13px] [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:tracking-wider [&_th]:text-ink-500 [&_th]:uppercase [&_thead]:bg-ink-50 [&_tr]:border-b [&_tr]:border-ink-100 [&_tbody_tr:last-child]:border-0">{children}</table>
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const inner = (
    <>
      <div className="text-[12px] font-medium text-ink-500">{label}</div>
      <div className="mt-1 text-[24px] font-bold">{value}</div>
      {hint && <div className="text-[12px] text-ink-500">{hint}</div>}
    </>
  );
  return href ? <Link href={href} className="card block p-4 hover:shadow-[var(--shadow-card-hover)]">{inner}</Link> : <div className="card p-4">{inner}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-500">{hint}</span>}
    </label>
  );
}
