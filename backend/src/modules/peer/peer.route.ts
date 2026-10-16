import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { initNetworkGroup } from '../../utils/network.js';
import { initUpgradeLimit } from '../../middlewares/upgrade-limit.js';
import type { initTransport } from '../../infrastructures/websocket/transport.js';
import type { initPeerHandler } from './peer.handler.js';

export function createPeerRoute(server: Server, handler: ReturnType<typeof initPeerHandler>, transport: ReturnType<typeof initTransport>, options: { publicOrigin?: string; trustProxyHops: number }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false });
  const networkGroup = initNetworkGroup(options.trustProxyHops);
  const upgradeLimit = initUpgradeLimit();
  server.on('upgrade', (request, socket, head) => {
    let validOrigin = false;
    try {
      const parsed = new URL(request.headers.origin ?? '');
      validOrigin = parsed.origin === request.headers.origin && (options.publicOrigin ? parsed.origin === options.publicOrigin : ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host);
    } catch { validOrigin = false; }
    const group = networkGroup(request);
    if (request.url !== '/ws' || !validOrigin || !group) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!upgradeLimit.allow(group)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, connection => {
      let session: ReturnType<typeof handler.connect>;
      try { session = handler.connect(group); }
      catch { connection.close(1013, 'Too many devices'); return; }
      transport.sockets.set(session.id, connection);
      transport.send(session.id, session.hello);
      let alive = true;
      let messages = 0;
      let rateSince = Date.now();
      connection.on('pong', () => { alive = true; });
      connection.on('error', () => connection.terminate());
      const heartbeat = setInterval(() => {
        if (!alive) connection.terminate();
        else { alive = false; connection.ping(); }
      }, 15_000);
      heartbeat.unref();
      connection.on('close', () => {
        clearInterval(heartbeat);
        transport.sockets.delete(session.id);
        handler.disconnect(session.id);
      });
      connection.on('message', (data, binary) => {
        if (Date.now() - rateSince > 10_000) { rateSince = Date.now(); messages = 0; }
        if (++messages > 180 || binary) { connection.close(1008, 'Invalid message or rate limit'); return; }
        handler.message(session.id, data.toString());
      });
    });
  });
  const expiry = setInterval(() => { handler.expire(); upgradeLimit.expire(); }, 5000);
  expiry.unref();
  return async () => {
    clearInterval(expiry);
    for (const connection of transport.sockets.values()) connection.terminate();
    await new Promise<void>(resolveClose => sockets.close(() => resolveClose()));
  };
}
