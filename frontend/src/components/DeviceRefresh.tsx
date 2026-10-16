import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { usePreferences } from "../contexts/PreferencesContext";

type Props = {
  connected: boolean;
  refreshing: boolean;
  cooldownUntil: number;
  onRefresh: () => void;
};

export function DeviceRefresh({ connected, refreshing, cooldownUntil, onRefresh }: Props) {
  const { t } = usePreferences();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= cooldownUntil) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const seconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  return (
    <button
      className="device-refresh"
      type="button"
      disabled={!connected || refreshing || seconds > 0}
      onClick={onRefresh}
      aria-label={t("รีเฟรชอุปกรณ์")}
      aria-busy={refreshing}
      title={seconds > 0 ? t("รีเฟรชได้อีกใน {seconds} วินาที", { seconds }) : t("รีเฟรชอุปกรณ์")}
    >
      <RefreshCw size={15} aria-hidden="true" />
      <span>{refreshing ? t("กำลังรีเฟรช") : seconds > 0 ? t("รอ {seconds} วิ", { seconds }) : t("รีเฟรช")}</span>
    </button>
  );
}
