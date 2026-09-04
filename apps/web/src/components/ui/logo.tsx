import Link from 'next/link';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-500 text-white" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 1 0 0 8" />
        <path d="M12 12h7" />
      </svg>
    </span>
  );
}

export function Logo({ withTagline = true, className = '' }: { withTagline?: boolean; className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="TechMatch — на главную">
      <LogoMark />
      <span className="flex items-center gap-3">
        <span className="text-[22px] font-extrabold tracking-[-0.02em] text-ink-900">TechMatch</span>
        {withTagline && <span className="hidden text-[11px] leading-[1.15] text-ink-500 xl:block">Аксессуары<br />для любых устройств</span>}
      </span>
    </Link>
  );
}
