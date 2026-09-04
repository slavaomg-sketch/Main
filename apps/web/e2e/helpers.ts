import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@techmatch.local', password: 'Admin12345!' };

export async function pickDevice(page: Page, query: string) {
  await page.goto('/');
  await page.getByTestId('device-search-input').fill(query);
  await page.getByTestId('device-search-submit').click();
}

export async function useDevice(page: Page, slug: string) {
  await page.goto(`/device/${slug}`);
  const btn = page.getByTestId('use-device');
  if ((await btn.innerText()).includes('Сделать')) {
    await btn.click();
    await expect(btn).toContainText('Это моё устройство');
  }
}

export async function fillCheckout(page: Page, email = `e2e-${Date.now()}@example.com`) {
  await page.fill('#f-fullName', 'Тест Тестов');
  await page.fill('#f-phone', '+79000000000');
  await page.fill('#f-email', email);
  await page.fill('#f-street', 'Ленина');
  await page.fill('#f-building', '1');
  await expect(page.locator('input[name=deliveryMethodCode]').first()).toBeVisible();
}

export async function adminLogin(page: Page) {
  await page.goto('/admin/login');
  await page.fill('#a-email', ADMIN.email);
  await page.fill('#a-password', ADMIN.password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/admin$/);
}
