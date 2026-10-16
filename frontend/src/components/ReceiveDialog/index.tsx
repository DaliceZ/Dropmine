import { usePreferences } from "../../contexts/PreferencesContext";
import { useState } from "react";
import {
  ArrowDownLeft,
  Download,
  File,
  Laptop,
  Smartphone,
} from "lucide-react";
import type { TransferView } from "../../types/dropmine";
import { formatBytes } from "../../utils/file";
import { Dialog } from "../Dialog";

export function ReceiveDialog({
  transfer,
  respond,
}: {
  transfer: TransferView;
  respond: (accept: boolean) => void;
}) {
  const { t } = usePreferences();
  const [submitted, setSubmitted] = useState(false);
  const total = transfer.files.reduce((sum, file) => sum + file.size, 0);

  function answer(accept: boolean) {
    if (submitted) return;
    setSubmitted(true);
    respond(accept);
  }

  return (
    <Dialog
      title={t("คำขอรับไฟล์")}
      dismissible={false}
      onClose={() => answer(false)}
    >
      <div className="receive-sender">
        <span className="receive-device-icon">
          {transfer.peer.kind === "mobile" ? (
            <Smartphone size={25} aria-hidden="true" />
          ) : (
            <Laptop size={27} aria-hidden="true" />
          )}
        </span>
        <div>
          <span className="receive-label">{t("ผู้ส่ง")}</span>
          <h3>{transfer.peer.name}</h3>
        </div>
        <ArrowDownLeft
          className="receive-direction"
          size={20}
          aria-hidden="true"
        />
      </div>
      <dl className="receive-summary">
        <div>
          <dt>{t("จำนวนไฟล์")}</dt>
          <dd>{t("{count} ไฟล์", { count: transfer.files.length })}</dd>
        </div>
        <div>
          <dt>{t("ขนาดรวม")}</dt>
          <dd>{formatBytes(total)}</dd>
        </div>
      </dl>
      <h3 className="receive-files-heading">{t("รายการไฟล์")}</h3>
      <ul className="receive-files" aria-label={t("รายการไฟล์ที่ขอส่ง")}>
        {transfer.files.map((file, index) => (
          <li key={index}>
            <File size={17} aria-hidden="true" />
            <span>{file.name}</span>
            <small>{formatBytes(file.size)}</small>
          </li>
        ))}
      </ul>
      <p className="receive-hint">
        {t("ไฟล์จะเริ่มส่งเมื่อคุณยอมรับ รับครบแล้วกดบันทึกลงเครื่องได้")}
      </p>
      <div className="receive-actions">
        <button
          className="button secondary"
          autoFocus
          disabled={submitted}
          onClick={() => answer(false)}
        >
          {t("ปฏิเสธ")}
        </button>
        <button
          className="button primary"
          disabled={submitted}
          onClick={() => answer(true)}
        >
          <Download size={16} aria-hidden="true" />
          {t("ยอมรับไฟล์")}
        </button>
      </div>
    </Dialog>
  );
}
