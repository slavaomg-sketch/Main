import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/ui/logo';

const COLS = [
  { title: 'Покупателям', links: [['Доставка', '/info/delivery'], ['Оплата', '/info/payment'], ['Возврат', '/info/returns'], ['Гарантия', '/info/warranty']] },
  { title: 'Компания', links: [['О нас', '/info/about'], ['Блог', '/info/blog'], ['Партнерам', '/info/partners'], ['Контакты', '/info/contacts']] },
  { title: 'Поддержка', links: [['Помощь', '/help'], ['Частые вопросы', '/help#faq'], ['Статус заказа', '/account/orders'], ['Связаться с нами', '/info/contacts']] },
];

const SOCIAL = [
  { label: 'VK', href: '#', path: 'M12.8 17.4c-5.6 0-8.8-3.8-8.9-10.2h2.8c.1 4.7 2.2 6.7 3.8 7.1V7.2h2.6v4c1.6-.2 3.3-2 3.9-4h2.6c-.4 2.5-2.3 4.3-3.6 5.1 1.3.6 3.4 2.2 4.2 5.1h-2.9c-.6-1.9-2.2-3.4-4.2-3.6v3.6h-.3z' },
  { label: 'Telegram', href: '#', path: 'M20.6 4.4 3.6 11c-1.2.5-1.2 1.1-.2 1.4l4.3 1.4 1.7 5.1c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.4-2.3 4.4 3.3c.8.4 1.4.2 1.6-.8l2.9-13.7c.3-1.2-.5-1.8-1.8-1.3zM9.4 13.3l8.9-5.6c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.1-1.7-4.4z' },
  { label: 'YouTube', href: '#', path: 'M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8 1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3-5.2 3z' },
  { label: 'Instagram', href: '#', path: 'M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2zm0 7.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.9-7.8a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM21 8.5c-.1-1.6-.4-3-1.6-4.2S16.8 2.7 15.2 2.6c-1.7-.1-6.7-.1-8.4 0-1.6.1-3 .4-4.2 1.6S1 6.9.9 8.5c-.1 1.7-.1 6.7 0 8.4.1 1.6.4 3 1.6 4.2s2.6 1.5 4.2 1.6c1.7.1 6.7.1 8.4 0 1.6-.1 3-.4 4.2-1.6s1.5-2.6 1.6-4.2c.1-1.7.1-6.7 0-8.4zm-2 10.2c-.3.9-1 1.6-1.9 1.9-1.3.5-4.5.4-6 .4s-4.7.1-6-.4c-.9-.3-1.6-1-1.9-1.9-.5-1.3-.4-4.5-.4-6s-.1-4.7.4-6c.3-.9 1-1.6 1.9-1.9 1.3-.5 4.5-.4 6-.4s4.7-.1 6 .4c.9.3 1.6 1 1.9 1.9.5 1.3.4 4.5.4 6s.1 4.7-.4 6z' },
];

export function Footer({ trustTitle, trustText }: { trustTitle: string; trustText: string }) {
  return (
    <footer className="mt-12 border-t border-ink-200 bg-surface pb-24 md:pb-8">
      <div className="shell grid grid-cols-1 gap-8 py-8 md:grid-cols-[1.3fr_1fr_1fr_1fr_1.3fr]">
        <div>
          <Logo withTagline={false} />
          <p className="mt-2 text-[12px] text-ink-500">Аксессуары для любых устройств</p>
          <p className="mt-8 hidden text-[12px] text-ink-500 md:block">© {new Date().getFullYear()} TechMatch. Все права защищены.</p>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <h3 className="mb-3 text-[13px] font-bold">{c.title}</h3>
            <ul className="space-y-2">
              {c.links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href!} className="text-[13px] text-ink-600 hover:text-ink-900">{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="md:text-right">
          <div className="flex gap-2 md:justify-end">
            {SOCIAL.map((s) => (
              <a key={s.label} href={s.href} aria-label={s.label} className="inline-flex size-9 items-center justify-center rounded-full text-ink-600 hover:bg-ink-100 hover:text-ink-900">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d={s.path} /></svg>
              </a>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3 md:justify-end">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-ink-300 text-ink-700"><ShieldCheck width={22} height={22} strokeWidth={1.6} /></span>
            <span className="text-left text-[12px] leading-snug">
              <span className="block font-semibold text-ink-900">{trustTitle}</span>
              <span className="block text-ink-500">{trustText}</span>
            </span>
          </div>
        </div>
        <p className="text-[12px] text-ink-500 md:hidden">© {new Date().getFullYear()} TechMatch. Все права защищены.</p>
      </div>
    </footer>
  );
}
