import { expect, test } from '@playwright/test';
import { adminLogin } from './helpers';

test('обычный пользователь не может открыть /admin', async ({ page }) => {
  const res = await page.goto('/admin');
  expect(page.url()).toContain('/admin/login');
  expect(res?.status()).toBe(200);
  // авторизованный покупатель — тоже не может
  await page.goto('/account/login');
  await page.fill('#l-email', 'customer@techmatch.local');
  await page.fill('#l-password', 'Customer12345!');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/account/);
  await page.goto('/admin/orders');
  expect(page.url()).toContain('/admin/login');
  const api = await page.request.get('/api/admin/export/catalog.csv');
  expect([401, 403]).toContain(api.status());
});

test('созданный заказ виден в админке, повторный импорт CSV не создаёт дубликатов', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/orders');
  await expect(page.getByTestId('admin-order-row').first()).toBeVisible();
  await page.getByTestId('admin-order-row').first().locator('a').first().click();
  await page.waitForURL(/\/admin\/orders\//);
  await expect(page.getByTestId('order-status').first()).toBeVisible();

  const runImport = async () => {
    await page.goto('/admin/imports/new');
    await page.getByTestId('import-file').setInputFiles('public/import-sample.csv');
    await page.getByTestId('import-submit').click();
    await page.waitForURL(/\/admin\/imports\/(?!new)[a-z0-9]+/);
    await page.getByRole('button', { name: /dry-run/ }).click();
    await expect(page.getByTestId('apply-panel')).toBeVisible();
    const create = Number(await page.getByTestId('summary-create').innerText());
    const skip = Number(await page.getByTestId('summary-skip').innerText());
    const update = Number(await page.getByTestId('summary-update').innerText());
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Применить/ }).click();
    await expect(page.getByText('Импорт применён')).toBeVisible({ timeout: 60_000 });
    return { create, skip, update };
  };
  const first = await runImport();
  const second = await runImport();
  expect(first.create + first.update + first.skip).toBe(5);
  expect(second.create).toBe(0);
  expect(second.skip).toBe(5);
});
