import { useEffect, useRef, useState } from "react";
import { CompletionSound } from "../services/CompletionSound";
import type { TransferView } from "../types/dropmine";

export type CompletionNotice = {
  id: string;
  direction: "send" | "receive";
  peerName: string;
  count: number;
  total: number;
};

export function useCompletionNotification(history: TransferView[]) {
  const [notice, setNotice] = useState<CompletionNotice | null>(null);
  const [sound] = useState(() => new CompletionSound());
  const announced = useRef(new Set<string>());

  useEffect(() => {
    sound.start();
    return () => sound.stop();
  }, [sound]);

  useEffect(() => {
    const completed = history.filter(
      (transfer) =>
        transfer.stage === "complete" && !announced.current.has(transfer.id),
    );
    if (!completed.length) return;
    for (const transfer of completed) announced.current.add(transfer.id);
    const latest = completed[0];
    const total = latest.files.reduce((sum, file) => sum + file.size, 0);
    setNotice({
      id: latest.id,
      direction: latest.direction,
      peerName: latest.peer.name,
      count: latest.files.length,
      total,
    });
    sound.play();
  }, [history, sound]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  return { notice, dismiss: () => setNotice(null) };
}
