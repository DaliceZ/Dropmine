import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function nameDevice(page: Page, name: string) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-connection', 'online');
  await page.getByLabel('ชื่ออุปกรณ์', { exact: true }).fill(name);
  await page.getByLabel('ชื่ออุปกรณ์', { exact: true }).blur();
}

async function confirmSend(page: Page, peerName: string) {
  const dialog = page.getByRole('dialog', { name: 'ยืนยันการส่งไฟล์', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: peerName, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันการส่ง', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('sends multiple files both ways, verifies downloaded bytes, declines and cancels', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const receiverContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  for (const context of [senderContext, receiverContext]) {
    await context.addInitScript(() => {
      const scope = window as unknown as { completionToneCount: number };
      scope.completionToneCount = 0;
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        scope.completionToneCount++;
        return original.call(this);
      };
    });
  }
  const sender = await senderContext.newPage();
  const receiver = await receiverContext.newPage();
  await sender.goto('/');
  await receiver.goto('/');
  await nameDevice(sender, 'Desktop Test');
  await nameDevice(receiver, 'Phone Test');
  await expect(sender.getByRole('button', { name: /Phone Test/ })).toBeVisible();
  const buffer = Buffer.alloc(3 * 1024 * 1024);
  for (let index = 0; index < buffer.length; index++) buffer[index] = index % 251;
  const fixtures = [{ name: 'ทดสอบ.bin', mimeType: 'application/octet-stream', buffer }, { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) }];
  await receiver.getByRole('button', { name: /เชื่อมต่อด้วย QR/ }).first().click();
  await expect(receiver.getByRole('dialog', { name: 'เชื่อมต่อด้วย QR', exact: true })).toBeVisible();
  await sender.getByLabel('เลือกไฟล์ที่จะส่ง').setInputFiles(fixtures);
  await sender.getByRole('button', { name: /Phone Test/ }).click();
  await expect(sender.getByRole('dialog', { name: 'ยืนยันการส่งไฟล์', exact: true })).toBeVisible();
  await expect(receiver.getByRole('dialog', { name: 'คำขอรับไฟล์', exact: true })).toHaveCount(0);
  await sender.getByRole('button', { name: 'กลับไปแก้ไข', exact: true }).click();
  await expect(sender.locator('[data-transfer-id]')).toHaveCount(0);
  await sender.getByRole('button', { name: /Phone Test/ }).click();
  await sender.screenshot({ path: 'test-results/send-confirm.png' });
  await confirmSend(sender, 'Phone Test');
  await expect(receiver.getByRole('button', { name: 'ยอมรับไฟล์', exact: true })).toBeVisible();
  const receiveDialog = receiver.getByRole('dialog', { name: 'คำขอรับไฟล์', exact: true });
  await expect(receiveDialog).toBeVisible();
  await expect(receiver.getByRole('dialog')).toHaveCount(1);
  await expect(receiveDialog.getByRole('heading', { name: 'Desktop Test', exact: true })).toBeVisible();
  await expect(receiveDialog.getByText('2 ไฟล์', { exact: true })).toBeVisible();
  await expect(receiveDialog.locator('dl').getByText('3.0 MB', { exact: true })).toBeVisible();
  await expect(receiveDialog.getByText('ทดสอบ.bin', { exact: true })).toBeVisible();
  await expect(receiveDialog.getByText('empty.txt', { exact: true })).toBeVisible();
  await expect(receiveDialog.getByRole('button', { name: 'ปฏิเสธ', exact: true })).toBeFocused();
  await receiver.keyboard.press('Escape');
  await expect(receiveDialog).toBeVisible();
  await receiver.screenshot({ path: 'test-results/receive-modal-mobile.png' });
  await receiver.getByRole('button', { name: 'ยอมรับไฟล์', exact: true }).click();
  await expect(receiveDialog).toHaveCount(0);
  await expect(sender.getByText('ผู้รับได้รับไฟล์ครบแล้ว', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(sender.getByRole('heading', { name: 'ส่งไฟล์สำเร็จ', exact: true })).toBeVisible();
  await expect(receiver.getByRole('heading', { name: 'รับไฟล์สำเร็จ', exact: true })).toBeVisible();
  await expect(sender.locator('.completion-toast').getByText('ส่งไฟล์สำเร็จ', { exact: true })).toBeVisible();
  await expect(receiver.locator('.completion-toast').getByText('รับไฟล์สำเร็จ', { exact: true })).toBeVisible();
  await expect.poll(() => sender.evaluate(() => (window as unknown as { completionToneCount: number }).completionToneCount)).toBe(4);
  await expect.poll(() => receiver.evaluate(() => (window as unknown as { completionToneCount: number }).completionToneCount)).toBe(4);
  await receiver.screenshot({ path: 'test-results/completion-toast-mobile.png' });
  await receiver.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(receiver.locator('.completion-toast')).toHaveCount(0);
  await expect(receiver.getByRole('heading', { name: 'รับไฟล์สำเร็จ', exact: true })).toBeVisible();
  await expect(receiver.getByRole('link', { name: 'บันทึก ทดสอบ.bin', exact: true })).toBeInViewport();
  await receiver.screenshot({ path: 'test-results/received-auto-scroll-mobile.png' });
  for (const fixture of fixtures) {
    const downloadPromise = receiver.waitForEvent('download');
    await receiver.getByRole('link', { name: `บันทึก ${fixture.name}`, exact: true }).click();
    const download = await downloadPromise;
    const bytes = await readFile((await download.path())!);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(fixture.buffer).digest('hex'));
  }
  const fileChooserPromise = receiver.waitForEvent('filechooser');
  await receiver.getByRole('button', { name: /Desktop Test/ }).click();
  await (await fileChooserPromise).setFiles({ name: 'return.txt', mimeType: 'text/plain', buffer: Buffer.from('back to desktop') });
  await confirmSend(receiver, 'Desktop Test');
  await sender.getByRole('button', { name: 'ยอมรับไฟล์', exact: true }).click();
  await expect(sender.getByRole('link', { name: 'บันทึก return.txt' })).toBeVisible();
  await expect(sender.getByRole('link', { name: 'บันทึก return.txt' })).toBeInViewport();
  await expect(receiver.getByText('ผู้รับได้รับไฟล์ครบแล้ว', { exact: true })).toBeVisible();
  await sender.getByLabel('เลือกไฟล์ที่จะส่ง').setInputFiles(fixtures[0]);
  await sender.getByRole('button', { name: /Phone Test/ }).click();
  await confirmSend(sender, 'Phone Test');
  await receiver.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click();
  await expect(sender.getByText('ผู้รับปฏิเสธไฟล์', { exact: true })).toBeVisible();
  await expect(receiver.getByRole('dialog')).toHaveCount(0);
  await sender.getByLabel('เลือกไฟล์ที่จะส่ง').setInputFiles(fixtures[0]);
  await sender.getByRole('button', { name: /Phone Test/ }).click();
  await confirmSend(sender, 'Phone Test');
  await expect(receiver.getByRole('button', { name: 'ยอมรับไฟล์', exact: true })).toBeVisible();
  await sender.getByRole('button', { name: 'ยกเลิกการส่ง', exact: true }).click();
  await expect(receiver.getByText('ยกเลิกการส่งแล้ว', { exact: true })).toBeVisible();
  await expect(receiver.getByRole('dialog')).toHaveCount(0);
  await expect(sender.locator('[data-transfer-id]')).toHaveCount(4);
  await expect(receiver.locator('[data-transfer-id]')).toHaveCount(4);
  expect(await sender.evaluate(() => (window as unknown as { completionToneCount: number }).completionToneCount)).toBe(8);
  expect(await receiver.evaluate(() => (window as unknown as { completionToneCount: number }).completionToneCount)).toBe(8);
  const timestamps = await sender.locator('[data-started-at]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-started-at'))));
  expect(timestamps).toEqual([...timestamps].sort((first, second) => second - first));
  expect(timestamps.every(timestamp => timestamp > 0)).toBe(true);
  const previousTransfer = sender.locator('.history-entry').last();
  await previousTransfer.locator('summary').click();
  await expect(previousTransfer.getByText('ทดสอบ.bin', { exact: true })).toBeVisible();
  await sender.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await receiver.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(sender.getByLabel('ชื่ออุปกรณ์', { exact: true })).toBeInViewport();
  await expect(receiver.getByLabel('ชื่ออุปกรณ์', { exact: true })).toBeInViewport();
  await receiver.screenshot({ path: 'test-results/history-mobile.png' });
  await sender.screenshot({ path: 'test-results/history-desktop.png' });
  await sender.reload();
  await expect(sender.locator('[data-transfer-id]')).toHaveCount(0);
  await senderContext.close();
  await receiverContext.close();
});

test('pairs by QR link while hidden and removes devices after leaving', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const host = await first.newPage();
  const guest = await second.newPage();
  await host.goto('/');
  await nameDevice(host, 'Hidden Desktop');
  await host.getByRole('switch').click();
  await host.getByRole('button', { name: /เชื่อมต่อด้วย QR/ }).first().click();
  await expect(host.getByAltText('QR Code สำหรับจับคู่กับอุปกรณ์นี้')).toBeVisible();
  const link = await host.getByLabel('ลิงก์จับคู่ของคุณ', { exact: true }).inputValue();
  await guest.goto(link);
  await expect(guest.getByRole('button', { name: /Hidden Desktop/ })).toBeVisible();
  expect(new URL(guest.url()).hash).toBe('');
  await host.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await first.close();
  await expect(guest.getByRole('button', { name: /Hidden Desktop/ })).toHaveCount(0);
  await second.close();
});

test('mobile layout, dialog focus and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await nameDevice(page, 'Small Phone');
  await expect(page.getByText('เข้ารหัสระหว่างส่ง · ผู้รับต้องยอมรับก่อนเริ่ม', { exact: true })).toHaveCount(0);
  await expect(page.getByText('หาเครื่องไม่เจอ? ใช้ QR หรือลิงก์จับคู่', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ส่งตรงระหว่างอุปกรณ์', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ข้อมูลการเชื่อมต่อ', { exact: true })).toHaveCount(0);
  await expect(page.locator('.step-number')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ดูผลงานอื่นของผม', exact: true })).toHaveAttribute('href', 'https://dalalight.online/');
  const mobileFiles = await page.locator('.files-panel').boundingBox();
  const mobileDevices = await page.locator('.devices-panel').boundingBox();
  expect(mobileFiles!.height).toBeLessThan(160);
  expect(mobileDevices!.height).toBeLessThan(350);
  await expect(page.getByText('ลากไฟล์มาวางที่นี่', { exact: true })).toBeHidden();
  await expect(page.getByText('หรือเลือกไฟล์จากอุปกรณ์ของคุณ', { exact: true })).toBeHidden();
  const chooserButton = page.getByRole('button', { name: 'เลือกไฟล์', exact: true });
  const chooserBox = await chooserButton.boundingBox();
  expect(chooserBox!.height).toBeGreaterThanOrEqual(44);
  expect(chooserBox!.width).toBeLessThan(180);
  const chooserPromise = page.waitForEvent('filechooser');
  await chooserButton.click();
  await (await chooserPromise).setFiles({ name: 'mobile-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Selected from mobile') });
  await expect(page.locator('.selected-files')).toContainText('mobile-note.txt');
  await expect(page.getByRole('button', { name: 'เลือกไฟล์ใหม่', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ล้างรายการ', exact: true }).click();
  await expect(page.locator('.selected-files')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: /เชื่อมต่อด้วย QR/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ปิดหน้าต่าง', exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/mobile-qr.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 812, height: 375 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const desktopFiles = await page.locator('.files-panel').boundingBox();
  await expect(page.getByText('ลากไฟล์มาวางที่นี่', { exact: true })).toBeVisible();
  const desktopDevices = await page.locator('.devices-panel').boundingBox();
  expect(Math.abs(desktopFiles!.height - desktopDevices!.height)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});

test('touch screens use the compact picker in portrait and landscape', async ({ browser }) => {
  const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await nameDevice(page, 'Touch Phone');
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await expect(page.getByText('ลากไฟล์มาวางที่นี่', { exact: true })).toBeHidden();
      await expect(page.getByRole('button', { name: 'เลือกไฟล์', exact: true })).toBeVisible();
      expect((await page.locator('.files-panel').boundingBox())!.height).toBeLessThan(160);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally {
    await context.close();
  }
});
