import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { getEnv } from '@techmatch/config';
import { prisma } from '@techmatch/database';
import { formatRub, getPaymentProvider } from '@techmatch/domain';
import { LogoMark } from '@/components/ui/logo';
import { MockPayButtons } from './buttons';

export const metadata: Metadata = { title: 'Тестовая оплата — TechMatch', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Страница-эмулятор платёжного шлюза. Доступна только при PAYMENT_PROVIDER=mock. */
export default async function MockPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (getPaymentProvider().mode !== 'mock') notFound();
  const payment = await prisma.payment.findFirst({ where: { provider: 'mock', providerPaymentId: id }, include: { order: true } });
  if (!payment) notFound();
  const env = getEnv();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="card w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2"><LogoMark size={28} /><span className="font-bold">TechMatch · Тестовый платёжный шлюз</span></div>
        <p className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-warning-100 p-3 text-[13px] text-ink-800"><AlertTriangle width={16} height={16} className="mt-0.5 shrink-0 text-warning-500" /> Это эмуляция оплаты для разработки (PAYMENT_PROVIDER=mock). Реальные деньги не списываются, реальный провайдер подключается ключами в .env.</p>
        <dl className="space-y-1 text-[14px]">
          <div className="flex justify-between"><dt className="text-ink-500">Заказ</dt><dd className="font-semibold">{payment.order.publicId}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-500">Сумма</dt><dd className="text-[20px] font-bold" data-testid="mock-amount">{formatRub(payment.amountMinor)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-500">Статус платежа</dt><dd>{payment.status}</dd></div>
        </dl>
        {payment.status === 'PENDING' ? (
          <MockPayButtons paymentId={id} amountMinor={payment.amountMinor} returnUrl={`${env.APP_URL}/order/${payment.order.publicId}`} />
        ) : (
          <p className="mt-4 text-[13px] text-ink-600">Платёж уже обработан. <Link href={`/order/${payment.order.publicId}`} className="text-brand-500 underline">Вернуться к заказу</Link></p>
        )}
      </div>
    </div>
  );
}
