import { usePreferences } from "../../contexts/PreferencesContext";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, File } from "lucide-react";
import type { Download, TransferView } from "../../types/dropmine";
import {
  formatBytes,
  formatTransferTime,
  transferStatus,
} from "../../utils/file";
import { TransferCard } from "../TransferCard";

export function TransferHistory({
  history,
  currentId,
  downloads,
  cancel,
  clearDownloads,
}: {
  history: TransferView[];
  currentId?: string;
  downloads: Download[];
  cancel: () => void;
  clearDownloads: () => void;
}) {
  const { t, language } = usePreferences();
  return (
    <div className="history-list">
      {history.map((transfer) => (
        <div
          key={transfer.id}
          data-transfer-id={transfer.id}
          data-started-at={transfer.startedAt}
        >
          {transfer.id === currentId ? (
            <TransferCard
              transfer={transfer}
              downloads={downloads}
              cancel={cancel}
              clearDownloads={clearDownloads}
            />
          ) : (
            <details className="history-entry">
              <summary>
                <span className={`history-direction ${transfer.direction}`}>
                  {transfer.direction === "send" ? (
                    <ArrowUpRight size={19} aria-hidden="true" />
                  ) : (
                    <ArrowDownLeft size={19} aria-hidden="true" />
                  )}
                </span>
                <span className="history-info">
                  <strong>
                    {t(transfer.direction === "send" ? "ส่งให้" : "รับจาก")}{" "}
                    {transfer.peer.name}
                  </strong>
                  <span>
                    {t("{count} ไฟล์", { count: transfer.files.length })} ·{" "}
                    {formatBytes(
                      transfer.files.reduce((sum, file) => sum + file.size, 0),
                    )}
                  </span>
                  <time dateTime={new Date(transfer.startedAt).toISOString()}>
                    {formatTransferTime(transfer.startedAt, language)}
                  </time>
                </span>
                <span className={`status-badge ${transfer.stage}`}>
                  {t(transferStatus(transfer))}
                </span>
                <ChevronDown
                  className="history-chevron"
                  size={16}
                  aria-hidden="true"
                />
              </summary>
              <div className="history-detail">
                <ul className="transfer-files">
                  {transfer.files.map((file, index) => (
                    <li key={index}>
                      <File size={15} aria-hidden="true" />
                      <span>{file.name}</span>
                      <small>{formatBytes(file.size)}</small>
                    </li>
                  ))}
                </ul>
                {transfer.finishedAt && (
                  <p>
                    {t("สิ้นสุด")}{" "}
                    <time
                      dateTime={new Date(transfer.finishedAt).toISOString()}
                    >
                      {formatTransferTime(transfer.finishedAt, language)}
                    </time>
                  </p>
                )}
                <p>{t("บันทึกเฉพาะรายละเอียดการส่ง ไม่เก็บไฟล์ในประวัติ")}</p>
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
