import { usePreferences } from "../../contexts/PreferencesContext";
import { useState } from "react";
import { ArrowUpRight, File, Laptop, Send, Smartphone } from "lucide-react";
import { MAX_BYTES, MAX_FILES, type Peer } from "../../../../shared/protocol";
import { formatBytes } from "../../utils/file";
import { Dialog } from "../Dialog";

export function SendDialog({
  peer,
  files,
  available,
  onConfirm,
  onClose,
}: {
  peer: Peer;
  files: File[];
  available: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [submitted, setSubmitted] = useState(false);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const valid =
    files.length > 0 && files.length <= MAX_FILES && total <= MAX_BYTES;

  return (
    <Dialog title={t("ยืนยันการส่งไฟล์")} onClose={onClose}>
      <div className="receive-sender">
        <span className="receive-device-icon">
          {peer.kind === "mobile" ? (
            <Smartphone size={25} aria-hidden="true" />
          ) : (
            <Laptop size={27} aria-hidden="true" />
          )}
        </span>
        <div>
          <span className="receive-label">{t("ส่งให้")}</span>
          <h3>{peer.name}</h3>
        </div>
        <ArrowUpRight
          className="receive-direction"
          size={20}
          aria-hidden="true"
        />
      </div>
      <dl className="receive-summary">
        <div>
          <dt>{t("จำนวนไฟล์")}</dt>
          <dd>{t("{count} ไฟล์", { count: files.length })}</dd>
        </div>
        <div>
          <dt>{t("ขนาดรวม")}</dt>
          <dd>{formatBytes(total)}</dd>
        </div>
      </dl>
      <h3 className="receive-files-heading">{t("รายการไฟล์")}</h3>
      <ul className="receive-files" aria-label={t("รายการไฟล์ที่จะส่ง")}>
        {files.map((file, index) => (
          <li key={index}>
            <File size={17} aria-hidden="true" />
            <span>{file.name}</span>
            <small>{formatBytes(file.size)}</small>
          </li>
        ))}
      </ul>
      {!valid && (
        <p className="notice error" role="alert">
          {t("ส่งได้สูงสุด 50 ไฟล์ รวมไม่เกิน 200 MB กรุณากลับไปเลือกไฟล์ใหม่")}
        </p>
      )}
      {!available && (
        <p className="notice error" role="alert">
          {t("อุปกรณ์ไม่พร้อมรับไฟล์ กรุณากลับไปเลือกผู้รับใหม่")}
        </p>
      )}
      <div className="receive-actions">
        <button
          className="button secondary"
          autoFocus
          disabled={submitted}
          onClick={onClose}
        >
          {t("กลับไปแก้ไข")}
        </button>
        <button
          className="button primary"
          disabled={submitted || !valid || !available}
          onClick={() => {
            setSubmitted(true);
            onConfirm();
          }}
        >
          <Send size={16} aria-hidden="true" />
          {t("ยืนยันการส่ง")}
        </button>
      </div>
    </Dialog>
  );
}
