import express from 'express';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createApp } from '../backend/src/app.js';

if (!process.env.TEST_REDIS_URL) throw new Error('TEST_REDIS_URL must point to a dedicated test Redis');
const frontend = express();
frontend.use(express.static(resolve('frontend/dist')));
const gateway = createServer(frontend);
const gatewaySockets = new Set<Socket>();
gateway.on('connection', socket => {
  gatewaySockets.add(socket);
  socket.on('close', () => gatewaySockets.delete(socket));
});
async function listen(server: Server) {
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return address.port;
}
const port = await listen(gateway);
const origin = `http://127.0.0.1:${port}`;
const options = { redisUrl: process.env.TEST_REDIS_URL, redisNamespace: `e2e-${randomUUID()}`, networkGroupSecret: randomUUID(), publicOrigin: origin };
const backends = [createApp(options), createApp(options)];
let target = 0;
try {
  const ports = await Promise.all(backends.map(backend => listen(backend.server)));
  gateway.on('upgrade', (request, socket, head) => {
    const upstream = connect(ports[target++ % ports.length], '127.0.0.1', () => {
      const headers = request.rawHeaders.reduce<string[]>((lines, header, index) => {
        if (index % 2 === 0) lines.push(`${header}: ${request.rawHeaders[index + 1]}`);
        return lines;
      }, []);
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  });
  const tests = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], { stdio: 'inherit', env: { ...process.env, TEST_APP_URL: origin } });
  const [exitCode] = await once(tests, 'exit');
  process.exitCode = exitCode ?? 1;
} finally {
  for (const socket of gatewaySockets) socket.destroy();
  await new Promise<void>(resolveClose => gateway.close(() => resolveClose()));
  await Promise.all(backends.map(backend => backend.close()));
}
