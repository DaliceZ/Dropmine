import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dropmine } from "../../frontend/src/services/DropmineService";
import { createZipArchive } from "../../frontend/src/services/ZipArchive";
import type { Download, TransferView } from "../../frontend/src/types/dropmine";

vi.mock("../../frontend/src/services/ZipArchive", () => ({ createZipArchive: vi.fn() }));
const buildZip = vi.mocked(createZipArchive);
const click = vi.fn();
const revoke = vi.fn();

function readyService() {
  const service = new Dropmine();
  const files: Download[] = ["a.txt", "b.txt"].map((name) => ({ name, size: 1, blob: new Blob(["x"]), url: `blob:${name}` }));
  const transfer: TransferView = {
    id: "test-transfer", direction: "receive", stage: "complete",
    peer: { id: "peer", name: "Sender", kind: "desktop" }, files, bytes: 2, speed: 1, detail: "", startedAt: 1,
  };
  Object.assign(service.getSnapshot(), { transfer, downloads: files });
  return service;
}

beforeEach(() => {
  vi.stubGlobal("location", { hash: "" });
  vi.stubGlobal("document", { createElement: () => ({ click, remove: vi.fn() }), body: { append: vi.fn() } });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:archive");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  buildZip.mockReset();
  click.mockClear();
  revoke.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ZIP download lifecycle", () => {
  it("blocks repeated requests, caches the result and revokes URLs on clear", async () => {
    let finish!: (blob: Blob) => void;
    buildZip.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const service = readyService();
    const work = service.prepareZip();
    await service.prepareZip();
    expect(service.getSnapshot().zipDownload.status).toBe("preparing");
    expect(buildZip).toHaveBeenCalledTimes(1);
    finish(new Blob(["zip"]));
    await work;
    expect(service.getSnapshot().zipDownload).toEqual({ status: "ready", name: "dropmine-test-transfer.zip", url: "blob:archive" });
    expect(click).toHaveBeenCalledTimes(1);
    await service.prepareZip();
    expect(buildZip).toHaveBeenCalledTimes(1);
    service.clearDownloads();
    expect(revoke.mock.calls.flat()).toEqual(["blob:archive", "blob:a.txt", "blob:b.txt"]);
    expect(service.getSnapshot().zipDownload.status).toBe("idle");
  });

  it("allows retry after failure without removing individual downloads", async () => {
    buildZip.mockRejectedValueOnce(new Error("out of memory")).mockResolvedValueOnce(new Blob(["zip"]));
    const service = readyService();
    await service.prepareZip();
    expect(service.getSnapshot().zipDownload.status).toBe("error");
    expect(service.getSnapshot().downloads).toHaveLength(2);
    await service.prepareZip();
    expect(service.getSnapshot().zipDownload.status).toBe("ready");
  });

  it("keeps the ready link when the automatic download is blocked", async () => {
    buildZip.mockResolvedValueOnce(new Blob(["zip"]));
    click.mockImplementationOnce(() => { throw new Error("blocked"); });
    const service = readyService();
    await service.prepareZip();
    expect(service.getSnapshot().zipDownload.status).toBe("ready");
    service.clearDownloads();
    expect(revoke).toHaveBeenCalledWith("blob:archive");
  });

  it.each(["clear", "replace", "stop"])("discards an old result after %s", async (action) => {
    let finish!: (blob: Blob) => void;
    buildZip.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const service = readyService();
    const work = service.prepareZip();
    const signal = buildZip.mock.calls[0][1];
    if (action === "stop") service.stop();
    else {
      service.clearDownloads();
      if (action === "replace") Object.assign(service.getSnapshot(), { transfer: { ...service.getSnapshot().transfer, id: "next" } });
    }
    expect(signal.aborted).toBe(true);
    finish(new Blob(["stale zip"]));
    await work;
    expect(service.getSnapshot().zipDownload.status).toBe("idle");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("does not package single, incomplete or outgoing transfers", async () => {
    for (const patch of [{ direction: "send" }, { stage: "transferring" }]) {
      const service = readyService();
      Object.assign(service.getSnapshot().transfer!, patch);
      await service.prepareZip();
    }
    const single = readyService();
    single.getSnapshot().downloads.pop();
    await single.prepareZip();
    expect(buildZip).not.toHaveBeenCalled();
  });
});
