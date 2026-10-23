import type { Download } from "../../types/dropmine";

// A flat archive prevents paths from being interpreted as directories on extraction.
export function archiveNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = name.replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, "_")
      .replace(/[. ]+$/g, "").trim().normalize("NFC") || "file";
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const extension = dot > 0 ? base.slice(dot) : "";
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem} (${suffix++})${extension}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function createZipArchive(
  files: Pick<Download, "name" | "blob">[],
  signal: AbortSignal,
): Promise<Blob> {
  const { ZipWriter, BlobWriter, BlobReader } = await import("@zip.js/zip.js");
  signal.throwIfAborted();
  // STORE avoids recompressing photos/videos; no blob workers or CSP changes needed.
  const output = new BlobWriter("application/zip");
  const writer = new ZipWriter(output, {
    level: 0,
    useWebWorkers: false,
    bufferedWrite: false,
  });
  const names = archiveNames(files.map((file) => file.name));
  try {
    for (let index = 0; index < files.length; index++) {
      // Let loading feedback render and pending clear/new-transfer actions run.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal.throwIfAborted();
      await writer.add(names[index], new BlobReader(files[index].blob), { signal });
    }
    signal.throwIfAborted();
    return await writer.close();
  } catch (error) {
    try { await output.writable.abort(error); } catch { /* Already closed or aborted. */ }
    throw error;
  }
}
