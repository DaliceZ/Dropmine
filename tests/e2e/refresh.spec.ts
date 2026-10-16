import { test, expect } from '@playwright/test';

for (const layout of [
  { name: 'desktop-thai', width: 1280, height: 900, language: 'th', theme: 'light' },
  { name: 'mobile-english', width: 375, height: 812, language: 'en', theme: 'dark' },
]) {
  test(`device refresh placement and cooldown: ${layout.name}`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.addInitScript(preferences => {
      localStorage.setItem('dropmine.preferences', JSON.stringify(preferences));
    }, { language: layout.language, theme: layout.theme });
    let requests = 0;
    page.on('websocket', socket => socket.on('framesent', frame => {
      if (JSON.parse(String(frame.payload)).type === 'refresh-peers') requests++;
    }));
    await page.goto('/');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-connection', 'online');
    const button = page.getByRole('button', { name: layout.language === 'th' ? 'รีเฟรชอุปกรณ์' : 'Refresh devices', exact: true });
    await expect(button).toBeEnabled();
    const heading = await page.locator('#devices-heading').boundingBox();
    const refresh = await button.boundingBox();
    const status = await page.locator('.discovery-status').boundingBox();
    expect(refresh!.y).toBeGreaterThan(heading!.y + heading!.height);
    expect(Math.abs(refresh!.y + refresh!.height / 2 - status!.y - status!.height / 2)).toBeLessThan(2);
    expect(refresh!.x + refresh!.width).toBeLessThanOrEqual(layout.width);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(page.locator('.discovery-status')).toContainText(layout.language === 'th' ? 'อัปเดตรายชื่อแล้ว' : 'List updated');
    await expect.poll(() => requests).toBe(1);
    await page.screenshot({ path: `test-results/refresh-${layout.name}.png`, fullPage: true });
    await expect(button).toBeEnabled({ timeout: 12_000 });
    await button.click();
    await expect.poll(() => requests).toBe(2);
    await page.context().setOffline(true);
    await expect(button).toBeDisabled();
  });
}
