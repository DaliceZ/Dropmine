import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

test("download all produces one ZIP with intact files and localized mobile controls", async ({ browser }) => {
  const senderContext = await browser.newContext();
  const receiverContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const sender = await senderContext.newPage();
  const receiver = await receiverContext.newPage();
  try {
    for (const [page, name] of [[sender, "ZIP Sender"], [receiver, "ZIP Receiver"]] as const) {
      await page.goto("/");
      await expect(page.locator(".app-shell")).toHaveAttribute("data-connection", "online");
      await page.getByLabel("ชื่ออุปกรณ์", { exact: true }).fill(name);
      await page.getByLabel("ชื่ออุปกรณ์", { exact: true }).blur();
    }
    const fixtures = [
      { name: "ทดสอบ.bin", mimeType: "application/octet-stream", buffer: Buffer.from(Array.from({ length: 1024 * 1024 }, (_, index) => index % 251)) },
      { name: "ทดสอบ.bin", mimeType: "application/octet-stream", buffer: Buffer.from("second file with the same name") },
      { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
    ];
    await sender.getByLabel("เลือกไฟล์ที่จะส่ง").setInputFiles(fixtures);
    await sender.getByRole("button", { name: /ZIP Receiver/ }).click();
    await sender.getByRole("button", { name: "ยืนยันการส่ง", exact: true }).click();
    await expect(receiver.getByRole("button", { name: "ดาวน์โหลดทั้งหมด (.zip)", exact: true })).toHaveCount(0);
    await receiver.getByRole("button", { name: "ยอมรับไฟล์", exact: true }).click();
    const zipButton = receiver.getByRole("button", { name: "ดาวน์โหลดทั้งหมด (.zip)", exact: true });
    await expect(zipButton).toBeVisible();
    await receiver.locator(".zip-download").scrollIntoViewIfNeeded();
    await receiver.screenshot({ path: "test-results/zip-before-download-mobile.png" });
    await expect(sender.getByRole("button", { name: "ดาวน์โหลดทั้งหมด (.zip)", exact: true })).toHaveCount(0);
    const downloaded = receiver.waitForEvent("download");
    await zipButton.focus();
    await receiver.keyboard.press("Enter");
    const download = await downloaded;
    await download.saveAs("test-results/received-batch.zip");
    expect(download.suggestedFilename()).toMatch(/^dropmine-.+\.zip$/);
    const bytes = await readFile((await download.path())!);
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
    try {
      const entries = await reader.getEntries();
      expect(entries.map((entry) => entry.filename)).toEqual(["ทดสอบ.bin", "ทดสอบ (2).bin", "empty.txt"]);
      for (const [index, entry] of entries.entries()) {
        if (entry.directory) throw new Error("Unexpected directory");
        const contents = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true });
        expect(createHash("sha256").update(contents).digest("hex")).toBe(createHash("sha256").update(fixtures[index].buffer).digest("hex"));
      }
    } finally { await reader.close(); }
    const repeated = receiver.waitForEvent("download");
    await receiver.getByRole("link", { name: "ดาวน์โหลด ZIP อีกครั้ง", exact: true }).click();
    expect(await readFile((await (await repeated).path())!)).toEqual(bytes);
    const individual = receiver.waitForEvent("download");
    await receiver.getByRole("link", { name: "บันทึก ทดสอบ.bin", exact: true }).first().click();
    expect(await readFile((await (await individual).path())!)).toEqual(fixtures[0].buffer);

    await receiver.locator(".zip-download").scrollIntoViewIfNeeded();
    await receiver.screenshot({ path: "test-results/zip-th-mobile-light.png" });
    await receiver.getByRole("button", { name: "ภาษา", exact: true }).click();
    await receiver.getByRole("option", { name: "English", exact: true }).click();
    await expect(receiver.getByRole("link", { name: "Download ZIP again", exact: true })).toBeVisible();
    await expect(receiver.getByText("After extracting, save photos and videos to your gallery separately.", { exact: true })).toBeVisible();
    await receiver.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
    await receiver.locator(".zip-download").scrollIntoViewIfNeeded();
    await receiver.screenshot({ path: "test-results/zip-en-mobile-dark.png" });
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
      await receiver.setViewportSize(viewport);
      expect(await receiver.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await receiver.locator(".zip-download").scrollIntoViewIfNeeded();
    await receiver.screenshot({ path: "test-results/zip-en-desktop-dark.png" });
    await receiver.getByRole("button", { name: "Clear received files", exact: true }).click();
    await expect(receiver.locator(".zip-download")).toHaveCount(0);
    await expect(receiver.locator("a.download-button")).toHaveCount(0);
  } finally {
    await senderContext.close();
    await receiverContext.close();
  }
});
