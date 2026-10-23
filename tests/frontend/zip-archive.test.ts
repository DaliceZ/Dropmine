import { describe, expect, it } from "vitest";
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { archiveNames, createZipArchive } from "../../frontend/src/services/ZipArchive";

describe("ZIP archives", () => {
  it("flattens unsafe names and preserves every duplicate without collisions", () => {
    const names = archiveNames([
      "../secret.txt", "a\\b.txt", ".", "..", "", "ทดสอบ.txt",
      "photo.jpg", "photo.jpg", "photo (2).jpg", "PHOTO.JPG", "a\u0000.txt",
    ]);
    expect(names).toEqual([
      ".._secret.txt", "a_b.txt", "file", "file (2)", "file (3)", "ทดสอบ.txt",
      "photo.jpg", "photo (2).jpg", "photo (2) (2).jpg", "PHOTO (3).JPG", "a_.txt",
    ]);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names.every((name) => !/[\\/\u0000]/.test(name))).toBe(true);
  });

  it("round-trips Thai names, duplicate names, binary bytes and empty files without compression", async () => {
    const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, index) => index % 251);
    const files = [
      { name: "ทดสอบ.bin", blob: new Blob([bytes]) },
      { name: "ทดสอบ.bin", blob: new Blob(["different content"]) },
      { name: "empty.txt", blob: new Blob([]) },
    ];
    const blob = await createZipArchive(files, new AbortController().signal);
    expect(blob.type).toBe("application/zip");
    const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
    try {
      const entries = await reader.getEntries();
      expect(entries.map((entry) => entry.filename)).toEqual(["ทดสอบ.bin", "ทดสอบ (2).bin", "empty.txt"]);
      for (const [index, entry] of entries.entries()) {
        if (entry.directory) throw new Error("Unexpected directory");
        expect(entry.compressionMethod).toBe(0);
        expect(await entry.getData!(new Uint8ArrayWriter(), { checkSignature: true })).toEqual(
          new Uint8Array(await files[index].blob.arrayBuffer()),
        );
      }
    } finally { await reader.close(); }
  });

  it("stops when aborted before or during creation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createZipArchive([], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const mid = new AbortController();
    const work = createZipArchive([{ name: "big.bin", blob: new Blob([new Uint8Array(8 * 1024 * 1024)]) }], mid.signal);
    setTimeout(() => mid.abort(), 0);
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
  });
});
