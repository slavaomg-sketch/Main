import { expect, test } from '@playwright/test';
import { fillCheckout, pickDevice } from './helpers';

test('главный сценарий: iPhone 15 Pro → совместимые аксессуары → товар → корзина → заказ → номер заказа', async ({ page }) => {
  await pickDevice(page, 'iPhone 15 Pro');
  await page.waitForURL(/\/device\/apple-iphone-15-pro/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('iPhone 15 Pro');
  await page.getByTestId('use-device').click();
  await expect(page.getByTestId('use-device')).toContainText('Это моё устройство');
  const cards = page.getByTestId('product-card');
  await expect(cards.first()).toBeVisible();
  // на странице устройства нет несовместимых товаров
  await expect(page.locator('[data-testid=product-card]', { hasText: 'Не совместимо' })).toHaveCount(0);
  await cards.first().locator('a').nth(1).click();
  await page.waitForURL(/\/product\//);
  await expect(page.getByTestId('compat-panel')).toBeVisible();
  await expect(page.getByTestId('compat-explanation')).toContainText('iPhone 15 Pro');
  await page.getByTestId('buy-add').click();
  await expect(page.getByTestId('buy-add')).toContainText('Добавлено');
  await page.goto('/cart');
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.getByTestId('go-checkout').click();
  await page.waitForURL(/\/checkout/);
  await fillCheckout(page);
  await page.getByTestId('place-order').click();
  await page.waitForURL(/\/mock-payment\//, { timeout: 60_000 });
  await expect(page.getByTestId('mock-amount')).toBeVisible();
  await page.getByTestId('mock-pay-success').click();
  await page.waitForURL(/\/order\/TM-/, { timeout: 60_000 });
  await expect(page.getByTestId('order-status')).toHaveText('Оплачен');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/TM-\d{6}-[A-Z0-9]{5}/);
});

test('неоднозначный запрос «MacBook Air» предлагает уточнить модель', async ({ page }) => {
  await pickDevice(page, 'MacBook Air');
  await page.waitForURL(/\/devices\?q=/);
  await expect(page.getByTestId('device-ambiguous')).toBeVisible();
  const cards = page.getByTestId('device-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await cards.filter({ hasText: 'M2' }).first().click();
  await page.waitForURL(/\/device\/apple-macbook-air-m2-13/);
});

test('несуществующий товар возвращает 404', async ({ page }) => {
  const res = await page.goto('/product/no-such-product-xyz');
  expect(res?.status()).toBe(404);
  await expect(page.getByText('Страница не найдена')).toBeVisible();
});
