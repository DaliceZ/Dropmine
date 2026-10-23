// Local-only audit evidence for 2026-10-23. No deployed application is contacted.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, connect as tcpConnect } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../../backend/src/app.ts';
import { initPeerService } from '../../backend/src/modules/peer/services/peer.service.ts';
import { initSessionRepo } from '../../backend/src/repos/session.repo.ts';
import { Dropmine } from '../../frontend/src/services/DropmineService/index.ts';

const results = [];
const record = (id, evidence) => { results.push({ id, ...evidence }); console.log(JSON.stringify(results.at(-1))); };
globalThis.location = { hash: '' };
const peer = { id: randomUUID(), name: 'Audit sender', kind: 'desktop' };
function completedReceiver() {
  const client = new Dropmine();
  const blob = new Blob(['private unsaved contents']);
  const url = URL.createObjectURL(blob);
  Object.assign(client.getSnapshot(), {
    downloads: [{ name: 'unsaved.txt', size: blob.size, blob, url }],
    transfer: { id: 'previous-transfer', direction: 'receive', peer, files: [{ name: 'unsaved.txt', size: blob.size }], stage: 'complete', bytes: blob.size, speed: 1, detail: '', startedAt: Date.now() },
  });
  return { client, url };
}
{
  const { client, url } = completedReceiver();
  client.handle({ type: 'incoming', id: 'unsolicited-request', peer, files: [{ name: 'new.txt', size: 1 }] });
  assert.equal(client.getSnapshot().downloads.length, 0);
  let revoked = false;
  try { await fetch(url); } catch { revoked = true; }
  assert.equal(revoked, true);
  assert.equal(client.getSnapshot().transfer.stage, 'waiting');
  record('F1', { unsolicited_request_removes_unsaved_download: true, receiver_accepted_new_request: false, previous_blob_url_revoked: revoked });
  client.stop();
}
{
  const client = new Dropmine();
  for (let index = 0; index < 1000; index++) {
    const id = `audit-history-${index}`;
    client.handle({ type: 'incoming', id, peer, files: Array.from({ length: 50 }, (_, i) => ({ name: `${i}-${'x'.repeat(240)}.txt`, size: 0 })) });
    client.handle({ type: 'ended', id, reason: 'cancelled' });
  }
  assert.equal(client.getSnapshot().history.length, 1000);
  record('F2', { requests: 1000, receiver_acceptances: 0, retained_history_entries: client.getSnapshot().history.length, retained_file_metadata_entries: client.getSnapshot().history.reduce((sum, item) => sum + item.files.length, 0) });
  client.stop();
}
{
  const { client } = completedReceiver();
  client.clearDownloads();
  Object.assign(client.getSnapshot(), { transfer: { ...client.getSnapshot().transfer, stage: 'transferring', files: [{ name: 'empty.bin', size: 0 }] } });
  client.receive(JSON.stringify({ type: 'file-start', index: 0 }));
  for (let index = 0; index < 50000; index++) client.receive(new ArrayBuffer(0));
  assert.equal(client.receiveBytes, 0);
  assert.equal(client.chunks.length, 50000);
  record('F3', { accepted_transfer: true, advertised_file_bytes: 0, received_file_bytes: client.receiveBytes, retained_chunk_objects: client.chunks.length, rejected: false });
  client.stop();
}
{
  const repo = initSessionRepo();
  const service = initPeerService(repo, () => {});
  const sender = service.connect('audit-network');
  const receiver = service.connect('audit-network');
  const outsider = service.connect('other-network');
  service.handle(receiver.id, { type: 'profile', name: 'Receiver', visible: true, kind: 'desktop' });
  service.handle(sender.id, { type: 'request', target: receiver.id, id: 'audit-expired', files: [{ name: 'file', size: 1 }] });
  let unauthorizedBlocked = 0;
  for (const message of [
    { type: 'respond', id: 'audit-expired', accept: true },
    { type: 'cancel', id: 'audit-expired' },
    { type: 'complete', id: 'audit-expired' },
    { type: 'signal', id: 'audit-expired', signal: { description: { type: 'offer', sdp: 'sdp' } } },
  ]) {
    assert.throws(() => service.handle(outsider.id, message)); unauthorizedBlocked++;
  }
  record('CONTROL-IDOR', { unauthorized_actions_tested: unauthorizedBlocked, all_blocked: true });
  repo.getTransfer('audit-expired').expires = Date.now() - 1;
  service.handle(receiver.id, { type: 'respond', id: 'audit-expired', accept: true });
  assert.equal(repo.getTransfer('audit-expired').accepted, true);
  record('F5', { backend: 'RAM', expired_pending_request_accepted_before_maintenance: true });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
const app = createApp({ publicOrigin: 'https://audit.example' });
const port = await listen(app.server);
const sockets = [];
async function open(options = {}, path = '/ws') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin: 'https://audit.example', ...options });
  sockets.push(ws);
  return ws;
}
try {
  for (const [origin, path] of [['https://evil.example', '/ws'], ['null', '/ws'], ['https://audit.example.evil', '/ws'], ['https://audit.example', '/invalid']]) {
    const ws = await open({ origin }, path);
    const [error] = await once(ws, 'error');
    assert.match(error.message, /403/);
  }
  const noOrigin = await open({ origin: undefined });
  const [error] = await once(noOrigin, 'error');
  assert.match(error.message, /403/);
  record('CONTROL-ORIGIN', { invalid_origin_or_route_cases: 5, all_rejected_with_403: true });
  const binary = await open();
  await once(binary, 'message');
  const binaryClosed = once(binary, 'close');
  binary.send(Buffer.from([1, 2, 3]));
  assert.equal((await binaryClosed)[0], 1008);
  const oversized = await open();
  await once(oversized, 'message');
  const oversizedClosed = once(oversized, 'close');
  oversized.send('x'.repeat(96 * 1024 + 1));
  assert.equal((await oversizedClosed)[0], 1009);
  const flood = await open();
  await once(flood, 'message');
  const floodClosed = once(flood, 'close');
  for (let index = 0; index < 181; index++) flood.send(JSON.stringify({ type: 'rotate-pair' }));
  assert.equal((await floodClosed)[0], 1008);
  record('CONTROL-WS-LIMITS', { binary_rejected: true, oversized_payload_rejected: true, message_flood_closed: true });
} finally {
  for (const ws of sockets) ws.terminate();
  await app.close();
}

// Observe health-check TCP connections using a loopback-only proxy to disposable Redis.
if (process.env.REDIS_SERVER_BIN) {
  const reservation = createServer();
  const redisPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'dropmine-audit-redis-'));
  const redis = spawn(process.env.REDIS_SERVER_BIN, ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Redis readiness timed out')), 10000);
    redis.once('error', error => { clearTimeout(timeout); reject(error); });
    redis.stdout.on('data', data => {
      output += data;
      if (output.includes('Ready to accept connections')) { clearTimeout(timeout); resolve(); }
    });
  });
  let connections = 0;
  const proxySockets = new Set();
  const proxy = createServer(socket => {
    connections++;
    const upstream = tcpConnect(redisPort, '127.0.0.1');
    proxySockets.add(socket); proxySockets.add(upstream);
    socket.pipe(upstream); upstream.pipe(socket);
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    socket.on('close', () => { upstream.destroy(); proxySockets.delete(socket); });
    upstream.on('close', () => { socket.destroy(); proxySockets.delete(upstream); });
  });
  const proxyPort = await listen(proxy);
  try {
    process.env.NODE_ENV = 'development';
    process.env.REDIS_URL = `redis://127.0.0.1:${proxyPort}`;
    process.env.REDIS_NAMESPACE = 'local-security-audit';
    process.env.NETWORK_GROUP_SECRET = randomUUID();
    const { default: health } = await import('../../api/health.ts');
    let ok = 0;
    await Promise.all(Array.from({ length: 20 }, () => health({}, {
      setHeader() {}, writeHead(code) { if (code === 200) ok++; return this; }, end() {},
    })));
    assert.equal(ok, 20);
    assert.equal(connections, 20);
    record('F4', { concurrent_health_invocations: 20, redis_tcp_connections_created: connections, successful_responses: ok, shared_cache_or_connection_reuse: false });
  } finally {
    for (const socket of proxySockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
    const stopped = once(redis, 'exit'); redis.kill('SIGTERM'); await stopped;
  }
}
console.log(JSON.stringify({ audit_probes_completed: true, results: results.length }));
