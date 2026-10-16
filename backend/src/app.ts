import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { initTransport } from './infrastructures/websocket/transport.js';
import { securityHeaders } from './middlewares/security.js';
import { initPeerHandler } from './modules/peer/peer.handler.js';
import { createPeerRoute } from './modules/peer/peer.route.js';
import { initPeerService } from './modules/peer/services/peer.service.js';
import { initSessionRepo } from './repos/session.repo.js';

export function createApp(options: { publicOrigin?: string; trustProxyHops?: number; stunUrl?: string; staticDir?: string } = {}) {
  const proxyHops = options.trustProxyHops ?? 0;
  if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error('Invalid TRUST_PROXY_HOPS');
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
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
  const repo = initSessionRepo();
  const service = initPeerService(repo, transport.send, options.stunUrl ? [{ urls: options.stunUrl }] : []);
  const handler = initPeerHandler(service, transport.send);
  const closeSockets = createPeerRoute(server, handler, transport, { publicOrigin: options.publicOrigin, trustProxyHops: proxyHops });
  return {
    app, server,
    close: async () => {
      await closeSockets();
      if (server.listening) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    },
  };
}
