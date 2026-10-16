import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from 'redis';
import { env } from '../backend/src/config/env.js';

export default async function health(_request: IncomingMessage, response: ServerResponse) {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!env.redisUrl) { response.writeHead(503).end(JSON.stringify({ ok: false })); return; }
  const client = createClient({ url: env.redisUrl, disableOfflineQueue: true, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.withCommandOptions({ timeout: 3000 }).ping();
    response.writeHead(200).end(JSON.stringify({ ok: true }));
  } catch { response.writeHead(503).end(JSON.stringify({ ok: false })); }
  finally { if (client.isOpen) client.destroy(); }
}
