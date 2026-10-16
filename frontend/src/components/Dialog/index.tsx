import { usePreferences } from "../../contexts/PreferencesContext";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Dialog({
  title,
  children,
  onClose,
  dismissible = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const { t } = usePreferences();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (dismissible) onClose();
        else event.preventDefault();
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="section-heading">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button
              className="icon-button"
              aria-label={t("ปิดหน้าต่าง")}
              onClick={onClose}
            >
              <X size={20} aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </div>
    </dialog>
  );
}
