import type { TransferView } from "../types/dropmine";

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
export function isActive(transfer: TransferView | null) {
  return (
    !!transfer &&
    ["waiting", "connecting", "transferring"].includes(transfer.stage)
  );
}

export function formatTransferTime(
  timestamp: number,
  language: "th" | "en" = "th",
) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function transferStatus(transfer: TransferView) {
  return {
    waiting: transfer.direction === "send" ? "รอผู้รับ" : "รอตอบรับ",
    connecting: "กำลังเชื่อมต่อ",
    transferring: transfer.direction === "send" ? "กำลังส่ง" : "กำลังรับ",
    complete: "สำเร็จ",
    declined: "ปฏิเสธแล้ว",
    cancelled: "ยกเลิกแล้ว",
    failed: "ไม่สำเร็จ",
  }[transfer.stage];
}
