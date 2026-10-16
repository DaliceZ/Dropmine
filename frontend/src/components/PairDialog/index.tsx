import { usePreferences } from "../../contexts/PreferencesContext";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Link, RefreshCw } from "lucide-react";
import type { Dropmine } from "../../services/DropmineService";
import type { Snapshot } from "../../types/dropmine";
import { Dialog } from "../Dialog";

export function PairDialog({
  state,
  service,
  onClose,
}: {
  state: Snapshot;
  service: Dropmine;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copyError, setCopyError] = useState("");
  const url = `${location.origin}/#pair=${state.token}`;
  useEffect(() => {
    let live = true;
    setImage("");
    setCopied(false);
    if (state.token)
      void QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: "#121315", light: "#ffffff" },
      })
        .then((value) => {
          if (live) setImage(value);
        })
        .catch(() => {
          if (live) setCopyError("สร้าง QR ไม่สำเร็จ กรุณาใช้ลิงก์แทน");
        });
    return () => {
      live = false;
    };
  }, [url, state.token]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((state.expires - now) / 1000));
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกและคัดลอกลิงก์ด้านล่าง");
    }
  }
  return (
    <Dialog title={t("เชื่อมต่อด้วย QR")} onClose={onClose}>
      <p className="muted">
        {t("ให้อีกเครื่องสแกนด้วยกล้อง แล้วเปิดลิงก์เพื่อค้นพบกัน")}
      </p>
      <div className="qr-wrap">
        {image && seconds > 0 && state.connected ? (
          <img
            src={image}
            width={220}
            height={220}
            alt={t("QR Code สำหรับจับคู่กับอุปกรณ์นี้")}
          />
        ) : (
          <p>{t(state.connected ? "QR หมดอายุแล้ว" : "กำลังเชื่อมต่อ…")}</p>
        )}
      </div>
      <p className="qr-expiry">
        {seconds > 0
          ? t("ลิงก์หมดอายุใน {time} นาที", {
              time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
            })
          : t("กดสร้างใหม่เพื่อรับลิงก์ใหม่")}
      </p>
      <label className="field-label" htmlFor="own-link">
        {t("ลิงก์จับคู่ของคุณ")}
      </label>
      <input
        id="own-link"
        className="text-input link-input"
        readOnly
        value={state.token ? url : ""}
        onFocus={(event) => event.target.select()}
      />
      <div className="button-row">
        <button
          className="button primary"
          onClick={() => void copy()}
          disabled={!state.connected || !seconds}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
          {t(copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์")}
        </button>
        <button
          className="button secondary"
          onClick={service.rotatePair}
          disabled={!state.connected}
        >
          <RefreshCw size={17} />
          {t("สร้างใหม่")}
        </button>
      </div>
      {copyError && (
        <p className="notice" role="status">
          {t(copyError)}
        </p>
      )}
      <form
        className="pair-form"
        onSubmit={(event) => {
          event.preventDefault();
          service.pair(link);
        }}
      >
        <label className="field-label" htmlFor="pair-link">
          {t("มีลิงก์จากอีกเครื่องแล้ว?")}
        </label>
        <div className="input-row">
          <input
            id="pair-link"
            className="text-input"
            placeholder={t("วางลิงก์จับคู่ที่นี่")}
            value={link}
            onChange={(event) => setLink(event.target.value)}
            required
          />
          <button
            className="icon-button bordered"
            type="submit"
            aria-label={t("จับคู่จากลิงก์")}
            disabled={!state.connected || !link.trim()}
          >
            <Link size={19} />
          </button>
        </div>
      </form>
      {state.error && (
        <p className="notice error" role="alert">
          {t(state.error)}
        </p>
      )}
      {state.pairedIds.length > 0 && (
        <p className="success-text" role="status">
          {t("จับคู่แล้ว อุปกรณ์จะปรากฏในรายการ เลือกเพื่อส่งไฟล์ได้เลย")}
        </p>
      )}
    </Dialog>
  );
}
