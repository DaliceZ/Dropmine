import type { Peer, ServerMessage } from '../../../../shared/protocol.js';

export type Device = Peer & {
  group: string;
  visible: boolean;
  token: string;
  expires: number;
  paired: Set<string>;
};
export type Transfer = { id: string; sender: string; receiver: string; accepted: boolean; expires: number };
export type SendMessage = (id: string, message: ServerMessage) => void;
