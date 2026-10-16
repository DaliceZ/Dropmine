import { WebSocket } from 'ws';
import type { SendMessage } from '../../modules/peer/peer.type.js';

export function initTransport() {
  const sockets = new Map<string, WebSocket>();
  const send: SendMessage = (id, message) => {
    const socket = sockets.get(id);
    if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) socket.send(JSON.stringify(message));
    else if (socket?.readyState === WebSocket.OPEN) socket.close(1008, 'Slow connection');
  };
  return { sockets, send };
}
