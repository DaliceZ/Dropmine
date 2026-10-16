export const MAX_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 50;
export const PAIR_TTL = 10 * 60 * 1000;
export const PEER_REFRESH_COOLDOWN_MS = 10_000;
export type DeviceKind = "desktop" | "mobile";
export type Peer = { id: string; name: string; kind: DeviceKind };
export type FileMeta = { name: string; size: number };
export type Signal =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };
export type ClientMessage =
  | { type: "profile"; name: string; visible: boolean; kind: DeviceKind }
  | { type: "pair"; token: string }
  | { type: "rotate-pair" }
  | { type: "refresh-peers" }
  | { type: "request"; target: string; id: string; files: FileMeta[] }
  | { type: "respond"; id: string; accept: boolean }
  | { type: "signal"; id: string; signal: Signal }
  | { type: "cancel"; id: string }
  | { type: "complete"; id: string };
export type ServerMessage =
  | {
      type: "hello";
      self: Peer;
      token: string;
      expires: number;
      iceServers: RTCIceServer[];
    }
  | { type: "pair-token"; token: string; expires: number }
  | { type: "peers"; peers: Peer[]; refreshed?: boolean }
  | { type: "paired"; peer: Peer }
  | { type: "incoming"; id: string; peer: Peer; files: FileMeta[] }
  | { type: "accepted"; id: string; peer: Peer; initiator: boolean }
  | { type: "signal"; id: string; signal: Signal }
  | {
      type: "ended";
      id: string;
      reason:
        | "complete"
        | "declined"
        | "cancelled"
        | "disconnected"
        | "timeout";
    }
  | { type: "error"; message: string; id?: string };
