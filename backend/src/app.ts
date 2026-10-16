import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { initTransport } from './infrastructures/websocket/transport.js';
import { securityHeaders } from './middlewares/security.js';
import { initPeerHandler } from './modules/peer/peer.handler.js';
import { createPeerRoute } from './modules/peer/peer.route.js';
import { initPeerService } from './modules/peer/services/peer.service.js';
import { initSessionRepo } from './repos/session.repo.js';
import { initRedisPeerService } from './modules/peer/services/redis-peer.service.js';

export function createApp(options: { publicOrigin?: string; trustProxyHops?: number; stunUrl?: string; staticDir?: string; redisUrl?: string; redisNamespace?: string; networkGroupSecret?: string } = {}) {
  const proxyHops = options.trustProxyHops ?? 0;
  if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error('Invalid TRUST_PROXY_HOPS');
  if (options.redisUrl && (!options.networkGroupSecret || options.networkGroupSecret.length < 32)) throw new Error('Redis signaling requires a shared NETWORK_GROUP_SECRET');
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get('/', (_request, response) => response.sendFile(resolve(options.staticDir!, 'index.html')));
  }
  const server = createServer(app);
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 1200;
  const transport = initTransport();
  const iceServers = options.stunUrl ? [{ urls: options.stunUrl }] : [];
  const service = options.redisUrl ? initRedisPeerService({
    url: options.redisUrl, namespace: options.redisNamespace ?? 'local', send: transport.send, iceServers,
    unavailable: () => { for (const socket of transport.sockets.values()) socket.terminate(); },
  }) : initPeerService(initSessionRepo(), transport.send, iceServers);
  app.get('/api/health', async (_request, response) => {
    try { if ('ready' in service) await service.ready?.(); response.json({ ok: true }); }
    catch { response.status(503).json({ ok: false }); }
  });
  const handler = initPeerHandler(service, transport.send);
  const closeSockets = createPeerRoute(server, handler, transport, { publicOrigin: options.publicOrigin, trustProxyHops: proxyHops, networkGroupSecret: options.networkGroupSecret });
  return {
    app, server,
    close: async () => {
      await closeSockets();
      if ('close' in service) await service.close?.();
      if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    },
  };
}
