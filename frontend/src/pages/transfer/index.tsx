import { Moon, Sun } from "lucide-react";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  File,
  FolderUp,
  Laptop,
  QrCode,
  Radio,
  Smartphone,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import type { Peer } from "../../../../shared/protocol";
import { Dialog } from "../../components/Dialog";
import { CompletionToast } from "../../components/CompletionToast";
import { DeviceIdentity } from "../../components/DeviceIdentity";
import { LanguageDropdown } from "../../components/LanguageDropdown";
import { PairDialog } from "../../components/PairDialog";
import { ReceiveDialog } from "../../components/ReceiveDialog";
import { SendDialog } from "../../components/SendDialog";
import { TransferHistory } from "../../components/TransferHistory";
import { useDropmine } from "../../hooks/useDropmine";
import { useCompletionNotification } from "../../hooks/useCompletionNotification";
import { formatBytes, isActive } from "../../utils/file";

export function TransferPage() {
  const { state, service } = useDropmine();
  const { t, theme, setTheme } = usePreferences();
  const { notice, dismiss } = useCompletionNotification(state.history);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingSend, setPendingSend] = useState<{
    peer: Peer;
    files: File[];
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Peer | null>(null);

  useEffect(() => {
    const element = input.current;
    const cancelSelection = () => {
      target.current = null;
    };
    element?.addEventListener("cancel", cancelSelection);
    return () => element?.removeEventListener("cancel", cancelSelection);
  }, []);

  const busy = isActive(state.transfer);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const incoming =
    state.transfer?.direction === "receive" &&
    state.transfer.stage === "waiting"
      ? state.transfer
      : null;

  useEffect(() => {
    if (incoming) {
      setPairOpen(false);
      setHelpOpen(false);
      setPendingSend(null);
    }
  }, [incoming?.id]);

  function receiveFiles(selected: File[]) {
    if (!selected.length) return;
    if (target.current) {
      setPendingSend({ peer: target.current, files: selected });
      target.current = null;
      setFiles(selected);
    } else setFiles(selected);
  }

  function choosePeer(peer: Peer) {
    if (files.length) {
      setPendingSend({ peer, files });
    } else {
      target.current = peer;
      input.current?.click();
    }
  }

  function chooseFiles() {
    target.current = null;
    input.current?.click();
  }

  return (
    <div
      className="app-shell"
      data-connection={state.connected ? "online" : "offline"}
    >
      <a className="skip-link" href="#main">
        {t("ข้ามไปเนื้อหา")}
      </a>
      <header className="header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label={t("Dropmine หน้าแรก")}>
            <img
              className="brand-symbol"
              src="/dropmine-logo.png"
              width={36}
              height={36}
              alt=""
              aria-hidden="true"
            />
            <span>
              dropmine<span className="brand-period">.</span>
            </span>
          </a>
          <DeviceIdentity
            name={state.name}
            visible={state.visible}
            onRename={service.rename}
            onVisibilityChange={(visible) =>
              service.profile(state.name, visible)
            }
          />
          <div className="header-actions">
            <LanguageDropdown />
            <button
              className="icon-button theme-button"
              aria-label={t(theme === "light" ? "ใช้ธีมมืด" : "ใช้ธีมสว่าง")}
              title={t(theme === "light" ? "ใช้ธีมมืด" : "ใช้ธีมสว่าง")}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? (
                <Moon size={18} aria-hidden="true" />
              ) : (
                <Sun size={18} aria-hidden="true" />
              )}
            </button>
            <button
              className="help-button"
              aria-label={t("วิธีใช้งาน")}
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={17} aria-hidden="true" />
              <span>{t("วิธีใช้งาน")}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="main-layout">
        <main id="main" className="workspace">
          <div className="workspace-inner">
            <div className="page-intro">
              <div>
                <h1>{t("ส่งไฟล์")}</h1>
                <p>
                  {t("เลือกไฟล์และอุปกรณ์ปลายทาง เพื่อส่งตรงระหว่างเครื่อง")}
                </p>
              </div>
            </div>
            {state.error && (
              <div className="error-banner" role="alert">
                <span>{t(state.error)}</span>
                <button
                  className="icon-button"
                  onClick={service.clearError}
                  aria-label={t("ปิดข้อความผิดพลาด")}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            )}
            <input
              ref={input}
              className="sr-only"
              type="file"
              multiple
              aria-label={t("เลือกไฟล์ที่จะส่ง")}
              onChange={(event) => {
                receiveFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />

            <div className="send-layout">
              <section className="files-panel" aria-labelledby="files-heading">
                <div className="panel-heading">
                  <div className="step-heading">
                    <Upload
                      className="panel-icon"
                      size={18}
                      aria-hidden="true"
                    />
                    <h2 id="files-heading">{t("เลือกไฟล์")}</h2>
                  </div>
                  <span className="panel-meta">{t("สูงสุด 200 MB")}</span>
                </div>
                <div
                  className={`dropzone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!busy && state.connected) setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    )
                      setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (!busy && state.connected) {
                      target.current = null;
                      receiveFiles(Array.from(event.dataTransfer.files));
                    }
                  }}
                  aria-label={t("พื้นที่เลือกไฟล์")}
                >
                  <FolderUp
                    size={38}
                    strokeWidth={1.15}
                    className="dropzone-icon"
                    aria-hidden="true"
                  />
                  <h3>
                    {files.length
                      ? t("เลือกแล้ว {count} ไฟล์", { count: files.length })
                      : t("ลากไฟล์มาวางที่นี่")}
                  </h3>
                  <p>
                    {files.length
                      ? t("{size} · พร้อมเลือกอุปกรณ์ปลายทาง", {
                          size: formatBytes(total),
                        })
                      : t("หรือเลือกไฟล์จากอุปกรณ์ของคุณ")}
                  </p>
                  <button
                    className="button primary"
                    disabled={busy || !state.connected}
                    onClick={chooseFiles}
                  >
                    <Upload size={16} aria-hidden="true" />
                    {t(files.length ? "เลือกไฟล์ใหม่" : "เลือกไฟล์")}
                  </button>
                  <span className="mobile-file-note">
                    {t("ไม่เกิน 50 ไฟล์ต่อครั้ง")}
                  </span>
                  <span className="dropzone-limit">
                    {t("ทุกประเภทไฟล์ · ไม่เกิน 50 ไฟล์ต่อครั้ง")}
                  </span>
                </div>
                {files.length > 0 && (
                  <div className="selected-files">
                    <div className="selection-heading">
                      <span>
                        {t("{count} ไฟล์", { count: files.length })} ·{" "}
                        {formatBytes(total)}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setFiles([])}
                        disabled={busy}
                      >
                        {t("ล้างรายการ")}
                      </button>
                    </div>
                    <ul>
                      {files.map((file, index) => (
                        <li key={index}>
                          <File size={16} aria-hidden="true" />
                          <span>{file.name}</span>
                          <small>{formatBytes(file.size)}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section
                className="devices-panel"
                aria-labelledby="devices-heading"
              >
                <div className="panel-heading">
                  <div className="step-heading">
                    <Laptop
                      className="panel-icon"
                      size={19}
                      aria-hidden="true"
                    />
                    <h2 id="devices-heading">{t("เลือกอุปกรณ์")}</h2>
                  </div>
                  <span
                    className="device-count"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <span aria-hidden="true">{state.peers.length}</span>
                    <span className="sr-only">
                      {t("พบ {count} อุปกรณ์", { count: state.peers.length })}
                    </span>
                  </span>
                </div>
                <div className="devices-body">
                  <div className="discovery-status">
                    <Radio size={14} aria-hidden="true" />
                    <span>
                      {t(
                        state.connected
                          ? "ค้นหาอุปกรณ์อัตโนมัติ"
                          : "กำลังเชื่อมต่อ",
                      )}
                    </span>
                  </div>
                  {state.peers.length ? (
                    <div className="device-list">
                      {state.peers.map((peer) => (
                        <button
                          key={peer.id}
                          className="peer-card"
                          disabled={busy || !state.connected}
                          onClick={() => choosePeer(peer)}
                        >
                          <span className="peer-icon">
                            {peer.kind === "mobile" ? (
                              <Smartphone
                                size={23}
                                strokeWidth={1.6}
                                aria-hidden="true"
                              />
                            ) : (
                              <Laptop
                                size={25}
                                strokeWidth={1.6}
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span className="peer-details">
                            <strong>{peer.name}</strong>
                            <span>
                              {t(
                                state.pairedIds.includes(peer.id)
                                  ? "จับคู่ด้วยลิงก์แล้ว"
                                  : peer.kind === "mobile"
                                    ? "มือถือ / แท็บเล็ต"
                                    : "คอมพิวเตอร์",
                              )}
                            </span>
                          </span>
                          <ArrowUpRight
                            className="peer-arrow"
                            size={18}
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-devices">
                      <span className="empty-device-icon">
                        <Wifi size={24} strokeWidth={1.4} aria-hidden="true" />
                      </span>
                      <h3>
                        {t(
                          state.connected
                            ? "ยังไม่พบอุปกรณ์"
                            : "กำลังเชื่อมต่อกับ Dropmine",
                        )}
                      </h3>
                      <p>
                        {t("เปิด Dropmine บนอีกเครื่องที่ใช้ Wi-Fi เดียวกัน")}
                      </p>
                    </div>
                  )}
                </div>
                <div className="devices-panel-footer">
                  <button
                    className="button secondary qr-button"
                    onClick={() => setPairOpen(true)}
                    disabled={!state.connected}
                  >
                    <QrCode size={16} aria-hidden="true" />
                    {t("เชื่อมต่อด้วย QR")}
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </section>
            </div>

            <section
              className="transfer-section"
              aria-labelledby="transfer-heading"
            >
              <div className="section-heading">
                <h2 id="transfer-heading">
                  {t("ประวัติการส่ง")}{" "}
                  <span className="history-count">{state.history.length}</span>
                </h2>
                <span className="section-caption">{t("ล่าสุดก่อน")}</span>
              </div>
              <p className="history-note">
                {t("เก็บเฉพาะแท็บนี้ รีเฟรชหรือปิดแท็บแล้วประวัติจะหาย")}
              </p>
              {state.history.length ? (
                <TransferHistory
                  history={state.history}
                  currentId={state.transfer?.id}
                  downloads={state.downloads}
                  cancel={service.cancel}
                  clearDownloads={service.clearDownloads}
                />
              ) : (
                <div className="empty-transfer">
                  <span className="empty-transfer-icon">
                    <ArrowUpRight size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{t("ยังไม่มีการส่งไฟล์")}</h3>
                    <p>{t("สถานะการส่งและไฟล์ที่รับจะแสดงที่นี่")}</p>
                  </div>
                </div>
              )}
            </section>
            <footer className="portfolio-footer">
              <span>
                {t("สร้างโดย")} <strong>Dalalight</strong>
              </span>
              <a
                href="https://dalalight.online/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("ดูผลงานอื่นของผม")}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </footer>
          </div>
        </main>
      </div>

      <CompletionToast notice={notice} onDismiss={dismiss} />
      {incoming && (
        <ReceiveDialog
          key={incoming.id}
          transfer={incoming}
          respond={service.respond}
        />
      )}
      {pendingSend && !incoming && (
        <SendDialog
          peer={pendingSend.peer}
          files={pendingSend.files}
          available={
            state.connected &&
            !busy &&
            state.peers.some((peer) => peer.id === pendingSend.peer.id)
          }
          onClose={() => setPendingSend(null)}
          onConfirm={() => {
            service.request(pendingSend.peer, pendingSend.files);
            setPendingSend(null);
            setFiles([]);
          }}
        />
      )}
      {pairOpen && !incoming && (
        <PairDialog
          state={state}
          service={service}
          onClose={() => setPairOpen(false)}
        />
      )}
      {helpOpen && !incoming && (
        <Dialog
          title={t("ส่งไฟล์ใน 3 ขั้นตอน")}
          onClose={() => setHelpOpen(false)}
        >
          <ol className="help-steps">
            <li>
              <strong>{t("เปิดเว็บทั้งสองเครื่อง")}</strong>
              <p>
                {t("ใช้ Wi-Fi เดียวกัน หากหาไม่เจอ ใช้ QR หรือลิงก์จับคู่แทน")}
              </p>
            </li>
            <li>
              <strong>{t("เลือกไฟล์และอุปกรณ์ผู้รับ")}</strong>
              <p>{t("ผู้รับต้องกดยอมรับก่อนเริ่มส่งทุกครั้ง")}</p>
            </li>
            <li>
              <strong>{t("รอรับครบ แล้วกดบันทึก")}</strong>
              <p>
                {t("เปิดหน้านี้และหน้าจอมือถือไว้จนเสร็จ หากหลุดให้ส่งใหม่")}
              </p>
            </li>
          </ol>
          <div className="notice">
            {t(
              "รับได้รวมไม่เกิน 200 MB ต่อครั้ง ไฟล์ที่รับจะอยู่ชั่วคราวในเบราว์เซอร์ กรุณาบันทึกก่อนปิดหน้าเว็บหรือเริ่มรายการใหม่",
            )}
          </div>
          <p className="help-detail">
            {t(
              "รายชื่อค้นหาจาก IP อินเทอร์เน็ตเดียวกัน ซึ่งอาจไม่ตรงกับวง Wi-Fi เสมอไป QR ช่วยจับคู่ แต่ไม่สามารถข้ามข้อจำกัดเครือข่ายที่บล็อกการเชื่อมต่อโดยตรงได้",
            )}
          </p>
        </Dialog>
      )}
    </div>
  );
}
