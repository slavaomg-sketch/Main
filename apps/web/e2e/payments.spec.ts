import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';
import { fillCheckout } from './helpers';

async function createPendingOrder(page: Page) {
  await page.goto('/product/anker-511-nano-3-30w');
  await page.getByTestId('buy-add').click();
  await expect(page.getByTestId('buy-add')).toContainText('Добавлено');
  await page.goto('/checkout');
  await fillCheckout(page);
  await page.getByTestId('place-order').click();
  await page.waitForURL(/\/mock-payment\//, { timeout: 60_000 });
  const paymentId = page.url().split('/mock-payment/')[1]!.split('?')[0]!;
  const amount = Number((await page.getByTestId('mock-amount').innerText()).replace(/[^\d,]/g, '').replace(',', '.')) * 100;
  return { paymentId, amountMinor: Math.round(amount) };
}

test('неуспешная тестовая оплата: заказ остаётся в ожидании, можно оплатить повторно', async ({ page }) => {
  await createPendingOrder(page);
  await page.getByTestId('mock-pay-fail').click();
  await page.waitForURL(/\/order\/TM-/, { timeout: 60_000 });
  await expect(page.getByTestId('order-status')).toHaveText('Ожидает оплаты');
  await expect(page.getByText('Последняя попытка оплаты не удалась')).toBeVisible();
  await expect(page.getByTestId('pay-now')).toBeVisible();
});

test('повторный webhook оплаты обрабатывается идемпотентно', async ({ page, request, baseURL }) => {
  const { paymentId, amountMinor } = await createPendingOrder(page);
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'change-me-webhook-secret';
  const body = JSON.stringify({ eventId: `e2e-${Date.now()}`, paymentId, event: 'succeeded', amountMinor });
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const first = await request.post(`${baseURL}/api/webhooks/payments/mock`, { headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': signature }, data: body });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
  const second = await request.post(`${baseURL}/api/webhooks/payments/mock`, { headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': signature }, data: body });
  expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
  const bad = await request.post(`${baseURL}/api/webhooks/payments/mock`, { headers: { 'Content-Type': 'application/json', 'X-Mock-Signature': 'deadbeef' }, data: body });
  expect(bad.status()).toBe(400);
  await page.reload();
  await page.waitForURL(/\/mock-payment\//);
  await expect(page.getByText('Платёж уже обработан')).toBeVisible();
});
