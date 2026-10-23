import { test, expect, type Page } from '@playwright/test';

async function chooseLanguage(page: Page, language: 'th' | 'en') {
  await page.getByRole('button', { name: /^(ภาษา|Language)$/ }).click();
  await page.getByRole('option', { name: language === 'en' ? 'English' : 'ไทย', exact: true }).click();
}

test('light defaults, language and theme persist, English transfers stay localized', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const receiverContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const sender = await senderContext.newPage();
  const receiver = await receiverContext.newPage();
  try {
    await sender.goto('/');
    await receiver.goto('/');
    for (const page of [sender, receiver]) {
      await expect(page.locator('.app-shell')).toHaveAttribute('data-connection', 'online');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await expect(page.getByText('เชื่อมต่อแล้ว', { exact: true })).toHaveCount(0);
    }
    await sender.getByLabel('ชื่ออุปกรณ์', { exact: true }).fill('English Sender');
    await sender.getByLabel('ชื่ออุปกรณ์', { exact: true }).blur();
    await receiver.getByLabel('ชื่ออุปกรณ์', { exact: true }).fill('English Receiver');
    await receiver.getByLabel('ชื่ออุปกรณ์', { exact: true }).blur();
    await sender.screenshot({ path: 'test-results/light-desktop.png', fullPage: true });
    await receiver.screenshot({ path: 'test-results/light-mobile.png', fullPage: true });
    for (const page of [sender, receiver]) {
      await chooseLanguage(page, 'en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { name: 'Send files', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await sender.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
    await expect(sender.locator('html')).toHaveAttribute('data-theme', 'dark');
    await receiver.getByRole('button', { name: 'Connect with QR', exact: true }).click();
    const qr = receiver.getByRole('dialog', { name: 'Connect with QR', exact: true });
    await expect(qr).toBeVisible();
    await expect(qr.getByAltText('QR code to pair with this device')).toBeVisible();
    await receiver.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await sender.getByLabel('Choose files to send', { exact: true }).setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await sender.getByRole('button', { name: /English Receiver/ }).click();
    await expect(sender.getByRole('dialog', { name: 'Confirm transfer', exact: true })).toBeVisible();
    await sender.getByRole('button', { name: 'Confirm send', exact: true }).click();
    const incoming = receiver.getByRole('dialog', { name: 'Incoming files', exact: true });
    await expect(incoming).toBeVisible();
    await expect(incoming.getByText('Sender', { exact: true })).toBeVisible();
    await expect(incoming.getByText('Total size', { exact: true })).toBeVisible();
    await receiver.getByRole('button', { name: 'Accept files', exact: true }).click();
    await expect(receiver.getByRole('heading', { name: 'Files received', exact: true })).toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Download all (.zip)', exact: true })).toHaveCount(0);
    await expect(sender.getByRole('heading', { name: 'Files sent', exact: true })).toBeVisible();
    await expect(receiver.getByRole('link', { name: 'Save hello.txt', exact: true })).toBeInViewport();
    await expect(receiver.locator('.completion-toast').getByText('Files received', { exact: true })).toBeVisible();
    await chooseLanguage(receiver, 'th');
    await expect(receiver.getByRole('heading', { name: 'รับไฟล์สำเร็จ', exact: true })).toBeVisible();
    await receiver.getByRole('button', { name: 'ใช้ธีมมืด', exact: true }).click();
    await expect(receiver.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await receiver.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await receiver.screenshot({ path: 'test-results/dark-received-mobile.png' });
    await sender.reload();
    await expect(sender.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(sender.locator('html')).toHaveAttribute('lang', 'en');
    await expect(sender.getByRole('button', { name: 'Language', exact: true })).toHaveText('English');
    await expect(sender.locator('[data-transfer-id]')).toHaveCount(0);
    await sender.screenshot({ path: 'test-results/dark-english-desktop.png', fullPage: true });
  } finally {
    await senderContext.close();
    await receiverContext.close();
  }
});

test('custom language dropdown supports keyboard and device names persist only after editing', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection', 'online');
  const name = page.getByLabel('ชื่ออุปกรณ์', { exact: true });
  await expect(name).toHaveValue(/^[A-Za-z]+ [A-Za-z]+ \d{2}$/);
  expect(await page.evaluate(() => localStorage.getItem('dropmine.device-name'))).toBeNull();
  const visibility = page.getByRole('switch', { name: 'ให้เครื่องอื่นมองเห็น', exact: true });
  await visibility.click();
  await expect(visibility).toHaveAttribute('aria-checked', 'false');
  await expect(visibility.locator('.visibility-thumb')).toHaveCSS('transform', 'none');
  await expect(visibility.getByText('ซ่อนอยู่', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dropmine.device-name'))).toBeNull();
  await visibility.focus();
  await page.keyboard.press('Space');
  await expect(visibility).toHaveAttribute('aria-checked', 'true');
  await expect(visibility.locator('.visibility-thumb')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 14, 0)');
  await page.reload();
  await expect(name).toHaveValue(/^[A-Za-z]+ [A-Za-z]+ \d{2}$/);
  const headerHeight = (await page.locator('.header').boundingBox())!.height;
  await name.fill('My MacBook');
  await name.press('Enter');
  await expect(page.getByText('บันทึกชื่อแล้ว', { exact: true })).toBeVisible();
  expect((await page.locator('.header').boundingBox())!.height).toBe(headerHeight);
  await page.getByRole('button', { name: 'แก้ไขชื่ออุปกรณ์', exact: true }).click();
  await expect(name).toBeFocused();
  await name.fill('Cancelled name');
  await name.press('Escape');
  await expect(name).toHaveValue('My MacBook');
  await expect(page.getByText('บันทึกชื่อแล้ว', { exact: true })).toHaveCount(0);
  await name.fill('');
  await name.press('Enter');
  await expect(name).toHaveValue('My MacBook');
  await expect(page.getByText('กรุณาใส่ชื่ออุปกรณ์', { exact: true })).toBeVisible();
  await name.fill('My Desktop');
  await page.getByRole('button', { name: 'บันทึกชื่อ', exact: true }).click();
  await expect(page.getByText('บันทึกชื่อแล้ว', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dropmine.device-name'))).toBe('My Desktop');
  await name.fill('My MacBook');
  await name.press('Enter');
  await page.reload();
  await expect(name).toHaveValue('My MacBook');
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('ชื่ออุปกรณ์', { exact: true })).toHaveValue('My MacBook');
  await second.close();
  expect(await page.evaluate(() => localStorage.getItem('dropmine.device-name'))).toBe('My MacBook');
  await expect(page.locator('select')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'ภาษา', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'ไทย', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'English', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const englishTrigger = page.getByRole('button', { name: 'Language', exact: true });
  await expect(englishTrigger).toBeFocused();
  await expect(englishTrigger).toHaveAttribute('aria-expanded', 'false');
  await englishTrigger.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'English', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(englishTrigger).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await englishTrigger.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch to dark theme', exact: true })).toBeFocused();
  await englishTrigger.click();
  await page.getByRole('heading', { name: 'Send files', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.header').boundingBox())!.height).toBeLessThan(width <= 760 ? 160 : 100);
    expect((await page.locator('.device-name-field').boundingBox())!.width).toBeGreaterThan(120);
    await expect(page.getByRole('button', { name: 'Edit device name', exact: true })).toBeInViewport();
    await englishTrigger.click();
    await expect(page.getByRole('option', { name: 'English', exact: true })).toBeInViewport();
    const menu = (await page.locator('.language-popover').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(16);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width - 16);
    await page.keyboard.press('Escape');
  }
  await englishTrigger.click();
  await page.screenshot({ path: 'test-results/custom-language-dropdown.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('.visibility-track')).toHaveCSS('background-color', 'rgb(145, 201, 163)');
  await page.screenshot({ path: 'test-results/identity-dark-mobile.png' });
  await englishTrigger.click();
  await page.screenshot({ path: 'test-results/language-dark-mobile.png' });
  await page.keyboard.press('Escape');
  expect(await page.locator('.brand-symbol').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('device rename reports when persistent storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'dropmine.device-name') throw new DOMException('Storage blocked', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection', 'online');
  const name = page.getByLabel('ชื่ออุปกรณ์', { exact: true });
  await name.fill('Temporary name');
  await name.press('Enter');
  await expect(name).toHaveValue('Temporary name');
  await expect(page.getByText('ใช้ชื่อนี้ชั่วคราว จำชื่อในเครื่องไม่ได้', { exact: true })).toBeVisible();
  await expect(page.getByText('บันทึกชื่อแล้ว', { exact: true })).toHaveCount(0);
});
