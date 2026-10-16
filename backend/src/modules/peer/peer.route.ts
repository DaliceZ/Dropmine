import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { initNetworkGroup } from '../../utils/network.js';
import { initUpgradeLimit } from '../../middlewares/upgrade-limit.js';
import type { initTransport } from '../../infrastructures/websocket/transport.js';
import type { initPeerHandler } from './peer.handler.js';

export function createPeerRoute(server: Server, handler: ReturnType<typeof initPeerHandler>, transport: ReturnType<typeof initTransport>, options: { publicOrigin?: string; trustProxyHops: number; networkGroupSecret?: string }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 96 * 1024, perMessageDeflate: false });
  const networkGroup = initNetworkGroup(options.trustProxyHops, options.networkGroupSecret);
  const upgradeLimit = initUpgradeLimit();
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  let maintenance: Promise<void> | undefined;
  server.on('upgrade', (request, socket, head) => {
    let validOrigin = false;
    try {
      const parsed = new URL(request.headers.origin ?? '');
      validOrigin = parsed.origin === request.headers.origin && (options.publicOrigin ? parsed.origin === options.publicOrigin : ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host);
    } catch { validOrigin = false; }
    const group = networkGroup(request);
    if (closing || !['/ws', '/api/ws'].includes(request.url ?? '') || !validOrigin || !group) {
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
      let session: Awaited<ReturnType<typeof handler.connect>> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let disconnected = false;
      let alive = true;
      let messages = 0;
      let queuedMessages = 0;
      let rateSince = Date.now();
      let queue = Promise.resolve();
      connection.on('pong', () => { alive = true; });
      connection.on('error', () => connection.terminate());
      connection.on('close', () => {
        disconnected = true;
        clearInterval(heartbeat);
        if (!session) return;
        const id = session.id;
        transport.sockets.delete(id);
        const task = queue.then(() => handler.disconnect(id)).catch(() => {});
        pending.add(task);
        void task.finally(() => pending.delete(task));
      });
      connection.on('message', (data, binary) => {
        if (Date.now() - rateSince > 10_000) { rateSince = Date.now(); messages = 0; }
        if (++messages > 180 || queuedMessages >= 32 || binary) { connection.close(1008, 'Invalid message or rate limit'); return; }
        if (!session) { connection.close(1008, 'Session not ready'); return; }
        const id = session.id;
        queuedMessages++;
        queue = queue.then(() => disconnected ? undefined : handler.message(id, data.toString())).catch(() => connection.terminate()).finally(() => { queuedMessages--; });
      });
      connection.pause();
      const task = (async () => {
        try {
          session = await handler.connect(group);
          if (disconnected || closing) { await handler.disconnect(session.id); connection.terminate(); return; }
          transport.sockets.set(session.id, connection);
          transport.send(session.id, session.hello);
          heartbeat = setInterval(() => {
            if (!alive) connection.terminate();
            else { alive = false; connection.ping(); }
          }, 15_000);
          heartbeat.unref();
          connection.resume();
        } catch { connection.terminate(); }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
  });
  const expiry = setInterval(() => {
    upgradeLimit.expire();
    if (closing || maintenance || !transport.sockets.size) return;
    maintenance = Promise.resolve(handler.expire([...transport.sockets.keys()])).catch(() => {
      for (const connection of transport.sockets.values()) connection.terminate();
    }).finally(() => { maintenance = undefined; });
  }, 15_000);
  expiry.unref();
  return async () => {
    closing = true;
    clearInterval(expiry);
    for (const connection of sockets.clients) connection.terminate();
    await new Promise<void>(resolveClose => sockets.close(() => resolveClose()));
    await maintenance;
    await Promise.all([...pending]);
  };
}
