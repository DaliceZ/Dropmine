import { usePreferences } from "../../contexts/PreferencesContext";
import { formatBytes } from "../../utils/file";
import { CircleCheck, X } from "lucide-react";
import type { CompletionNotice } from "../../hooks/useCompletionNotification";

export function CompletionToast({
  notice,
  onDismiss,
}: {
  notice: CompletionNotice | null;
  onDismiss: () => void;
}) {
  const { t } = usePreferences();
  return (
    <div
      className="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {notice && (
        <div className="completion-toast" key={notice.id}>
          <CircleCheck size={19} aria-hidden="true" />
          <div>
            <strong>
              {t(
                notice.direction === "send" ? "ส่งไฟล์สำเร็จ" : "รับไฟล์สำเร็จ",
              )}
            </strong>
            <p>
              {t(notice.direction === "send" ? "ส่งให้" : "รับจาก")}{" "}
              {notice.peerName} · {t("{count} ไฟล์", { count: notice.count })} ·{" "}
              {formatBytes(notice.total)}
            </p>
          </div>
          <button
            className="icon-button"
            aria-label={t("ปิดการแจ้งเตือน")}
            onClick={onDismiss}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
