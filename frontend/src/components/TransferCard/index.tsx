import { usePreferences } from "../../contexts/PreferencesContext";
import { useEffect, useRef } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Download,
  File,
  LoaderCircle,
  X,
} from "lucide-react";
import type {
  Download as DownloadFile,
  TransferView,
} from "../../types/dropmine";
import {
  formatBytes,
  formatTransferTime,
  isActive,
  transferStatus,
} from "../../utils/file";

export function TransferCard({
  transfer,
  downloads,
  cancel,
  clearDownloads,
}: {
  transfer: TransferView;
  downloads: DownloadFile[];
  cancel: () => void;
  clearDownloads: () => void;
}) {
  const { t, language } = usePreferences();
  const card = useRef<HTMLElement>(null);
  const lastScroll = useRef("");
  const complete = transfer.stage === "complete";
  const receiving = transfer.direction === "receive";
  const incoming = receiving && transfer.stage === "waiting";
  const active = isActive(transfer);
  const total = transfer.files.reduce((sum, file) => sum + file.size, 0);
  const percentage = total
    ? Math.min(100, Math.round((transfer.bytes / total) * 100))
    : 0;

  useEffect(() => {
    if (
      transfer.direction !== "receive" ||
      !["connecting", "transferring", "complete"].includes(transfer.stage)
    )
      return;
    const milestone = `${transfer.id}:${transfer.stage === "complete" ? "complete" : "accepted"}`;
    if (lastScroll.current === milestone) return;
    const frame = requestAnimationFrame(() => {
      const element = card.current;
      if (!element) return;
      lastScroll.current = milestone;
      const focusTarget =
        element.querySelector<HTMLElement>("a.download-button") ?? element;
      focusTarget.focus({ preventScroll: true });
      element.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [transfer.id, transfer.direction, transfer.stage]);

  return (
    <article
      ref={card}
      tabIndex={-1}
      className={`transfer-card ${transfer.stage}`}
      aria-label={t("รายการส่งไฟล์")}
    >
      <div className="transfer-top">
        <span className="transfer-icon">
          {complete ? (
            <Check size={20} aria-hidden="true" />
          ) : receiving ? (
            <ArrowDownLeft size={21} aria-hidden="true" />
          ) : (
            <ArrowUpRight size={21} aria-hidden="true" />
          )}
        </span>
        <div className="transfer-title">
          <h3>
            {complete
              ? t(receiving ? "รับไฟล์สำเร็จ" : "ส่งไฟล์สำเร็จ")
              : incoming
                ? t("{name} ส่งไฟล์ถึงคุณ", { name: transfer.peer.name })
                : `${t(receiving ? "รับจาก" : "ส่งให้")} ${transfer.peer.name}`}
          </h3>
          <p>
            {complete &&
              `${t(receiving ? "รับจาก" : "ส่งให้")} ${transfer.peer.name} · `}
            {t("{count} ไฟล์", { count: transfer.files.length })} ·{" "}
            {formatBytes(total)}
          </p>
        </div>
        {active && (
          <button
            className="icon-button"
            onClick={cancel}
            aria-label={t("ยกเลิกการส่ง")}
          >
            <X size={19} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="transfer-context">
        <time dateTime={new Date(transfer.startedAt).toISOString()}>
          {formatTransferTime(transfer.startedAt, language)}
        </time>
        {!complete && (
          <span className={`status-badge ${transfer.stage}`}>
            {t(transferStatus(transfer))}
          </span>
        )}
      </div>

      {complete && downloads.length > 0 ? (
        <div className="downloads">
          <ul className="download-list" aria-label={t("ไฟล์พร้อมบันทึก")}>
            {downloads.map((file, index) => (
              <li key={index} className="download-row">
                <span className="download-file-icon">
                  <File size={19} aria-hidden="true" />
                </span>
                <div className="download-file-info">
                  <span>{file.name}</span>
                  <small>{formatBytes(file.size)}</small>
                </div>
                <a
                  className="download-button"
                  href={file.url}
                  download={file.name}
                  aria-label={t("บันทึก {name}", { name: file.name })}
                >
                  <Download size={16} aria-hidden="true" />
                  <span>{t("บันทึก")}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="download-footnote">
            <p>{t("บันทึกไฟล์ก่อนปิดหน้าเว็บหรือเริ่มรายการใหม่")}</p>
            <button className="text-button" onClick={clearDownloads}>
              {t("ล้างไฟล์ที่รับไว้")}
            </button>
          </div>
        </div>
      ) : (
        <ul className="transfer-files">
          {transfer.files.map((file, index) => (
            <li key={index}>
              <File size={15} aria-hidden="true" />
              <span>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
            </li>
          ))}
        </ul>
      )}

      {complete ? (
        (!receiving || downloads.length === 0) && (
          <p className="completion-receipt">
            {t(receiving ? "ล้างไฟล์ที่รับไว้จากหน้านี้แล้ว" : transfer.detail)}
          </p>
        )
      ) : (
        <>
          {!incoming && (
            <>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={t("ความคืบหน้าการส่งไฟล์")}
                aria-valuenow={percentage}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${percentage}%` }} />
              </div>
              <div className="progress-meta">
                <span>
                  {percentage}% · {formatBytes(transfer.bytes)} /{" "}
                  {formatBytes(total)}
                </span>
                {transfer.stage === "transferring" && (
                  <span>{formatBytes(transfer.speed)}/s</span>
                )}
              </div>
            </>
          )}
          <p className="transfer-status" role="status">
            {active && !incoming && (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            )}
            {t(transfer.detail)}
          </p>
        </>
      )}
    </article>
  );
}
