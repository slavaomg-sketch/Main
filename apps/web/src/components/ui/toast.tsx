'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

interface Toast {
  id: number;
  type: 'success' | 'error';
  text: string;
  action?: { href: string; label: string };
}

const Ctx = createContext<{ success: (text: string, action?: Toast['action']) => void; error: (text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 4000);
  }, []);
  const api = useMemo(() => ({ success: (text: string, action?: Toast['action']) => push({ type: 'success', text, action }), error: (text: string) => push({ type: 'error', text }) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[var(--radius-md)] bg-ink-900 px-4 py-3 text-[13px] text-white shadow-[var(--shadow-pop)]">
            {t.type === 'success' ? <CheckCircle2 width={18} height={18} className="shrink-0 text-success-500" /> : <XCircle width={18} height={18} className="shrink-0 text-danger-500" />}
            <span className="flex-1">{t.text}</span>
            {t.action && <Link href={t.action.href} className="font-semibold text-brand-200 hover:underline">{t.action.label}</Link>}
            <button type="button" aria-label="Закрыть" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} className="text-ink-400 hover:text-white"><X width={16} height={16} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast вне ToastProvider');
  return ctx;
}
