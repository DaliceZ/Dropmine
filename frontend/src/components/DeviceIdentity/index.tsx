import { usePreferences } from "../../contexts/PreferencesContext";
import { Check, CircleCheck, Monitor, Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeDeviceName } from "../../services/DeviceNameStore";

export function DeviceIdentity({
  name,
  visible,
  onRename,
  onVisibilityChange,
}: {
  name: string;
  visible: boolean;
  onRename: (name: string) => boolean;
  onVisibilityChange: (visible: boolean) => void;
}) {
  const { t } = usePreferences();
  const hintId = useId();
  const feedbackId = useId();
  const input = useRef<HTMLInputElement>(null);
  const lastName = useRef(name);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<
    "saved" | "temporary" | "empty" | null
  >(null);
  useEffect(() => {
    lastName.current = name;
    if (input.current && document.activeElement !== input.current)
      input.current.value = name;
  }, [name]);
  useEffect(() => {
    if (!feedback || feedback === "empty") return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  function save() {
    if (!input.current) return;
    const nextName = normalizeDeviceName(input.current.value);
    if (!nextName) {
      input.current.value = lastName.current;
      setDirty(false);
      setFeedback("empty");
      return;
    }
    input.current.value = nextName;
    setDirty(false);
    if (nextName === lastName.current) return;
    const saved = onRename(nextName);
    lastName.current = nextName;
    setFeedback(saved ? "saved" : "temporary");
  }
  const hint = t(
    visible
      ? "อุปกรณ์อื่นค้นพบคุณได้"
      : "ซ่อนจากรายการ เชื่อมต่อผ่าน QR หรือลิงก์ได้",
  );
  return (
    <section className="self-card" aria-label={t("อุปกรณ์ของคุณ")}>
      <div className="self-heading">
        <Monitor size={14} aria-hidden="true" />
        <label htmlFor="device-name">{t("อุปกรณ์ของคุณ")}</label>
      </div>
      <div className="device-name-field">
        <input
          ref={input}
          id="device-name"
          className="name-input"
          aria-label={t("ชื่ออุปกรณ์")}
          aria-describedby={feedbackId}
          maxLength={40}
          defaultValue={name}
          onChange={(event) => {
            setDirty(
              normalizeDeviceName(event.target.value) !== lastName.current,
            );
            setFeedback(null);
          }}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.currentTarget.value = lastName.current;
              setDirty(false);
              setFeedback(null);
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className={`name-action ${dirty ? "ready" : ""}`}
          aria-label={t(dirty ? "บันทึกชื่อ" : "แก้ไขชื่ออุปกรณ์")}
          title={t(dirty ? "บันทึกชื่อ" : "แก้ไขชื่ออุปกรณ์")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (dirty) save();
            else {
              input.current?.focus();
              input.current?.select();
            }
          }}
        >
          {dirty ? (
            <Check size={17} aria-hidden="true" />
          ) : (
            <Pencil size={15} aria-hidden="true" />
          )}
        </button>
      </div>
      <div
        id={feedbackId}
        className={`name-feedback ${feedback === "saved" ? "saved" : "warning"}`}
        role="status"
        aria-live="polite"
      >
        {feedback && (
          <>
            {feedback === "saved" && (
              <CircleCheck size={13} aria-hidden="true" />
            )}
            <span>
              {t(
                feedback === "saved"
                  ? "บันทึกชื่อแล้ว"
                  : feedback === "temporary"
                    ? "ใช้ชื่อนี้ชั่วคราว จำชื่อในเครื่องไม่ได้"
                    : "กรุณาใส่ชื่ออุปกรณ์",
              )}
            </span>
          </>
        )}
      </div>
      <div className="visibility-row">
        <button
          type="button"
          className="visibility-control"
          role="switch"
          aria-checked={visible}
          aria-label={t("ให้เครื่องอื่นมองเห็น")}
          aria-describedby={hintId}
          title={hint}
          onClick={() => onVisibilityChange(!visible)}
        >
          <span className="visibility-track" aria-hidden="true">
            <span className="visibility-thumb" />
          </span>
          <span className="visibility-state">
            {t(visible ? "ค้นพบได้" : "ซ่อนอยู่")}
          </span>
        </button>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </div>
    </section>
  );
}
