import type { ReactNode } from 'react';

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-ink-100 text-ink-500">{icon}</div>}
      <h3 className="h3 mb-1.5">{title}</h3>
      {text && <p className="max-w-md text-ink-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
