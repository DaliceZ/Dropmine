import type { ClientMessage, ServerMessage } from '../../../../../shared/protocol.js';

export type PeerSession = { id: string; hello: Extract<ServerMessage, { type: 'hello' }> };
export type PeerService = {
  connect(group: string): PeerSession | Promise<PeerSession>;
  disconnect(deviceId: string): void | Promise<void>;
  handle(deviceId: string, message: ClientMessage): void | Promise<void>;
  expire(localIds?: string[]): void | Promise<void>;
  ready?(): Promise<void>;
  close?(): Promise<void>;
};
