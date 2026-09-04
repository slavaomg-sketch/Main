import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@techmatch/database';
import { listFaq } from '@techmatch/domain';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

export const metadata: Metadata = { title: 'Помощь и частые вопросы' };
export const revalidate = 300;

export default async function HelpPage() {
  const faq = await listFaq(prisma);
  return (
    <div className="shell py-5">
      <Breadcrumbs items={[{ label: 'Помощь' }]} />
      <h1 className="h2 mb-2">Помощь</h1>
      <p className="mb-6 max-w-2xl text-[14px] text-ink-600">Ответы на частые вопросы о подборе, доставке, оплате и возврате. Не нашли ответ — напишите на <a href="mailto:support@techmatch.local" className="text-brand-500 underline">support@techmatch.local</a>.</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {['delivery', 'payment', 'returns', 'warranty'].map((s) => <Link key={s} href={`/info/${s}`} className="chip">{{ delivery: 'Доставка', payment: 'Оплата', returns: 'Возврат', warranty: 'Гарантия' }[s]}</Link>)}
        <Link href="/account/orders" className="chip">Статус заказа</Link>
      </div>
      <div id="faq" className="space-y-6">
        {faq.map((g) => (
          <section key={g.category}>
            <h2 className="h3 mb-2">{g.category}</h2>
            <div className="card divide-y divide-ink-200">
              {g.items.map((f) => (
                <details key={f.id} className="group p-4">
                  <summary className="cursor-pointer list-none text-[14.5px] font-medium marker:hidden">{f.question}</summary>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
