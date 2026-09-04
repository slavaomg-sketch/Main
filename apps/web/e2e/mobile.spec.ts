import { expect, test } from '@playwright/test';
import { fillCheckout } from './helpers';

test('мобильное оформление заказа без горизонтального скролла', async ({ page }) => {
  const noHScroll = async () => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(cw + 1);
  };
  await page.goto('/');
  await noHScroll();
  await page.getByTestId('device-search-input').fill('Galaxy S25');
  await page.getByTestId('device-search-submit').click();
  await page.waitForURL(/\/device\/samsung-galaxy-s25/);
  await noHScroll();
  await page.getByTestId('use-device').click();
  await expect(page.getByTestId('use-device')).toContainText('Это моё устройство');
  await page.getByTestId('product-card').first().locator('a').nth(1).click();
  await page.waitForURL(/\/product\//);
  await noHScroll();
  await page.getByTestId('buy-add').click();
  await expect(page.getByTestId('buy-add')).toContainText('Добавлено');
  // нижняя мобильная навигация → корзина
  await page.getByRole('link', { name: /Корзина/ }).last().click();
  await page.waitForURL(/\/cart/);
  await noHScroll();
  await page.getByTestId('go-checkout').click();
  await page.waitForURL(/\/checkout/);
  await noHScroll();
  await fillCheckout(page);
  await page.getByTestId('place-order').click();
  await page.waitForURL(/\/mock-payment\//, { timeout: 60_000 });
  await page.getByTestId('mock-pay-success').click();
  await page.waitForURL(/\/order\/TM-/, { timeout: 60_000 });
  await expect(page.getByTestId('order-status')).toHaveText('Оплачен');
  await noHScroll();
});

test('адаптивные размеры без горизонтального переполнения', async ({ page }) => {
  for (const [w, h] of [[360, 800], [390, 844], [768, 1024], [1024, 1366], [1440, 1000]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const url of ['/', '/device/apple-iphone-15-pro', '/product/anker-511-nano-3-30w', '/catalog', '/cart']) {
      await page.goto(url);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw, `${w}px ${url}`).toBeLessThanOrEqual(cw + 1);
    }
  }
});
