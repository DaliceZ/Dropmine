import type { FileMeta, Peer } from "../../../shared/protocol";

export type Download = { name: string; size: number; url: string; blob: Blob };
export type ZipDownload =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "ready"; name: string; url: string }
  | { status: "error" };
export type TransferView = {
  id: string;
  direction: "send" | "receive";
  peer: Peer;
  files: FileMeta[];
  stage:
    | "waiting"
    | "connecting"
    | "transferring"
    | "complete"
    | "declined"
    | "cancelled"
    | "failed";
  bytes: number;
  speed: number;
  detail: string;
  startedAt: number;
  finishedAt?: number;
};
export type Snapshot = {
  connected: boolean;
  name: string;
  visible: boolean;
  selfId: string;
  peers: Peer[];
  refreshingPeers: boolean;
  peerRefreshUntil: number;
  peersRefreshedAt: number;
  pairedIds: string[];
  token: string;
  expires: number;
  transfer: TransferView | null;
  history: TransferView[];
  downloads: Download[];
  zipDownload: ZipDownload;
  error: string;
};
