import { expect, test } from '@playwright/test';
import { useDevice } from './helpers';

test('товар несовместим с выбранным устройством (USB-C кабель и iPhone 14 с Lightning)', async ({ page }) => {
  await useDevice(page, 'apple-iphone-14');
  await page.goto('/product/ugreen-usb-c-usb-c-100w');
  await expect(page.getByTestId('compat-inline')).toContainText('Не совместимо');
  await expect(page.getByTestId('compat-explanation')).toContainText('Lightning');
});

test('товар совместим с ограничениями (кабель USB 2.0 и iPhone 15 Pro с USB 3)', async ({ page }) => {
  await useDevice(page, 'apple-iphone-15-pro');
  await page.goto('/product/ugreen-usb-c-usb-c-100w');
  await expect(page.getByTestId('compat-inline')).toContainText('Совместимо с ограничениями');
  await expect(page.getByTestId('compat-panel')).toContainText('480 Мбит/с');
});

test('зарядка 12 Вт USB-A для iPhone 14 — с ограничением скорости', async ({ page }) => {
  await useDevice(page, 'apple-iphone-14');
  await page.goto('/product/apple-12w-usb-power-adapter');
  await expect(page.getByTestId('compat-inline')).toContainText('Совместимо с ограничениями');
  await expect(page.getByTestId('compat-panel')).toContainText(/базовой скорости|12 Вт/);
});

test('чернила GI-490 подходят Canon G3410 и не подходят G3420', async ({ page }) => {
  await useDevice(page, 'canon-pixma-g3410');
  await page.goto('/product/canon-gi-490-ink-set');
  await expect(page.getByTestId('compat-inline')).toContainText('Проверено');
  await useDevice(page, 'canon-pixma-g3420');
  await page.goto('/product/canon-gi-490-ink-set');
  await expect(page.getByTestId('compat-inline')).toContainText('Не совместимо');
});

test('страница устройства требует уточнить модификацию для часов', async ({ page }) => {
  await page.goto('/device/apple-watch-series-10');
  await expect(page.getByTestId('needs-variant')).toBeVisible();
  await page.getByTestId('variant-picker').getByText('46 мм').click();
  await page.waitForURL(/variant=46mm/);
  await expect(page.getByTestId('needs-variant')).toHaveCount(0);
});
