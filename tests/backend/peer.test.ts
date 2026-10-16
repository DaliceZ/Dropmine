import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../../backend/src/app';
import { initPeerService } from '../../backend/src/modules/peer/services/peer.service';
import { initPeerHandler } from '../../backend/src/modules/peer/peer.handler';
import { initSessionRepo } from '../../backend/src/repos/session.repo';
import { MAX_BYTES, type ServerMessage } from '../../shared/protocol';

function setup() {
  const repo = initSessionRepo();
  const messages: { to: string; message: ServerMessage }[] = [];
  const send = (to: string, message: ServerMessage) => { messages.push({ to, message }); };
  const service = initPeerService(repo, send);
  const handler = initPeerHandler(service, send);
  const sender = service.connect('network-a');
  const receiver = service.connect('network-a');
  const outsider = service.connect('network-b');
  for (const device of [sender, receiver, outsider]) service.handle(device.id, { type: 'profile', name: device.id, visible: true, kind: 'desktop' });
  messages.length = 0;
  const request = () => service.handle(sender.id, { type: 'request', target: receiver.id, id: 'transfer-123', files: [{ name: 'sample.txt', size: 4 }] });
  return { repo, messages, service, handler, sender, receiver, outsider, request };
}

afterEach(() => vi.useRealTimers());

describe('peer service permissions and lifecycle', () => {
  it('notifies only changed peer views and always initializes the profiling device', () => {
    const { service, sender, receiver, outsider, messages } = setup();
    service.handle(receiver.id, { type: 'profile', name: 'Renamed', visible: true, kind: 'mobile' });
    expect(messages.filter(item => item.message.type === 'peers').map(item => item.to).sort()).toEqual([sender.id, receiver.id].sort());
    expect(messages.some(item => item.to === outsider.id)).toBe(false);
    messages.length = 0;
    service.handle(receiver.id, { type: 'profile', name: 'Renamed', visible: true, kind: 'mobile' });
    expect(messages.map(item => item.to)).toEqual([receiver.id]);
    const hidden = service.connect('network-a');
    messages.length = 0;
    service.handle(hidden.id, { type: 'profile', name: 'New device', visible: false, kind: 'desktop' });
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatchObject({ type: 'peers', peers: expect.arrayContaining([expect.objectContaining({ id: sender.id })]) });
    messages.length = 0;
    service.disconnect(hidden.id);
    expect(messages).toHaveLength(0);
  });
  it('updates hidden cross-network pairs without notifying unrelated devices', () => {
    const { service, sender, receiver, outsider, messages } = setup();
    service.handle(outsider.id, { type: 'profile', name: 'Hidden', visible: false, kind: 'mobile' });
    messages.length = 0;
    service.handle(sender.id, { type: 'pair', token: outsider.hello.token });
    expect(messages.filter(item => item.message.type === 'peers').map(item => item.to).sort()).toEqual([sender.id, outsider.id].sort());
    messages.length = 0;
    service.handle(sender.id, { type: 'pair', token: outsider.hello.token });
    expect(messages.every(item => item.message.type === 'paired')).toBe(true);
    messages.length = 0;
    service.handle(outsider.id, { type: 'profile', name: 'Renamed hidden', visible: false, kind: 'mobile' });
    expect(messages.some(item => item.to === sender.id && item.message.type === 'peers' && item.message.peers.some(peer => peer.name === 'Renamed hidden'))).toBe(true);
    expect(messages.some(item => item.to === receiver.id)).toBe(false);
    messages.length = 0;
    service.disconnect(outsider.id);
    expect(messages.map(item => item.to)).toEqual([sender.id]);
    expect(messages[0].message).toEqual({ type: 'peers', peers: [expect.objectContaining({ id: receiver.id })] });
  });
  it('discovers only visible devices in the same group', () => {
    const { service, sender, receiver, outsider, messages } = setup();
    service.handle(receiver.id, { type: 'profile', name: 'Phone', visible: false, kind: 'mobile' });
    const peers = messages.filter(item => item.to === sender.id && item.message.type === 'peers').at(-1)!.message;
    expect(peers).toEqual({ type: 'peers', peers: [] });
    expect(() => service.handle(sender.id, { type: 'request', id: 'transfer-456', target: outsider.id, files: [{ name: 'a', size: 1 }] })).toThrow();
  });
  it('pairs hidden devices across networks using an expiring token', () => {
    const { service, sender, outsider, messages } = setup();
    service.handle(outsider.id, { type: 'profile', name: 'Phone', visible: false, kind: 'mobile' });
    service.handle(sender.id, { type: 'pair', token: outsider.hello.token });
    expect(messages.some(item => item.to === sender.id && item.message.type === 'paired' && item.message.peer.id === outsider.id)).toBe(true);
    service.handle(outsider.id, { type: 'rotate-pair' });
    expect(() => service.handle(sender.id, { type: 'pair', token: outsider.hello.token })).toThrow();
  });
  it('rejects expired pairing links', () => {
    vi.useFakeTimers();
    const { service, sender, outsider } = setup();
    vi.advanceTimersByTime(11 * 60_000);
    expect(() => service.handle(sender.id, { type: 'pair', token: outsider.hello.token })).toThrow();
  });
  it('requires receiver acceptance before relaying signals and completion', () => {
    const { service, sender, receiver, outsider, request, messages, repo } = setup();
    request();
    const signal = { description: { type: 'offer' as const, sdp: 'sdp' } };
    expect(() => service.handle(sender.id, { type: 'signal', id: 'transfer-123', signal })).toThrow();
    expect(() => service.handle(outsider.id, { type: 'respond', id: 'transfer-123', accept: true })).toThrow();
    service.handle(receiver.id, { type: 'respond', id: 'transfer-123', accept: true });
    service.handle(sender.id, { type: 'signal', id: 'transfer-123', signal });
    expect(messages.some(item => item.to === receiver.id && item.message.type === 'signal')).toBe(true);
    expect(() => service.handle(sender.id, { type: 'complete', id: 'transfer-123' })).toThrow();
    service.handle(receiver.id, { type: 'complete', id: 'transfer-123' });
    expect(repo.listTransfers()).toHaveLength(0);
    expect(messages.filter(item => item.message.type === 'ended' && item.message.reason === 'complete')).toHaveLength(2);
  });
  it('releases both devices after decline, cancellation, timeout and disconnect', () => {
    vi.useFakeTimers();
    const { service, sender, receiver, request, repo } = setup();
    request();
    service.handle(receiver.id, { type: 'respond', id: 'transfer-123', accept: false });
    expect(repo.listTransfers()).toHaveLength(0);
    request();
    service.handle(sender.id, { type: 'cancel', id: 'transfer-123' });
    expect(repo.listTransfers()).toHaveLength(0);
    request();
    vi.advanceTimersByTime(61_000);
    service.expire();
    expect(repo.listTransfers()).toHaveLength(0);
    request();
    service.disconnect(receiver.id);
    expect(repo.listTransfers()).toHaveLength(0);
    expect(repo.getDevice(receiver.id)).toBeUndefined();
  });
  it('validates size, file counts and unsafe filenames at the handler boundary', () => {
    const { handler, sender, receiver, repo } = setup();
    const payload = { type: 'request', target: receiver.id, id: 'transfer-123', files: [{ name: 'a', size: MAX_BYTES + 1 }] };
    handler.message(sender.id, JSON.stringify(payload));
    expect(repo.listTransfers()).toHaveLength(0);
    payload.files = Array.from({ length: 51 }, () => ({ name: 'a', size: 1 }));
    handler.message(sender.id, JSON.stringify(payload));
    expect(repo.listTransfers()).toHaveLength(0);
    payload.files = [{ name: '../unsafe\u0000.txt', size: 1 }];
    handler.message(sender.id, JSON.stringify(payload));
    expect(repo.listTransfers()).toHaveLength(1);
  });
});

describe('websocket boundary', () => {
  it('accepts only the configured frontend origin on a separate backend domain', async () => {
    const application = createApp({ publicOrigin: 'https://drop.example', trustProxyHops: 1 });
    await new Promise<void>(resolveListen => application.server.listen(0, '127.0.0.1', resolveListen));
    const address = application.server.address();
    if (!address || typeof address === 'string') throw new Error('No server port');
    const host = `127.0.0.1:${address.port}`;
    try {
      const health = await fetch(`http://${host}/api/health`);
      expect(await health.json()).toEqual({ ok: true });
      expect(health.headers.get('cache-control')).toBe('no-store');
      expect(health.headers.get('x-content-type-options')).toBe('nosniff');
      expect(health.headers.get('x-powered-by')).toBeNull();
      for (const origin of [`http://${host}`, 'https://preview.example', 'https://drop.example/path', 'https://drop.example.evil']) {
        const rejected = new WebSocket(`ws://${host}/ws`, { origin, headers: { 'X-Forwarded-For': '192.0.2.1' } });
        await new Promise<void>(resolveError => rejected.once('error', error => { expect(error.message).toContain('403'); resolveError(); }));
      }
      const socket = new WebSocket(`ws://${host}/ws`, { origin: 'https://drop.example', headers: { 'X-Forwarded-For': '192.0.2.1' } });
      const hello = await new Promise<ServerMessage>(resolveMessage => socket.once('message', data => resolveMessage(JSON.parse(data.toString()))));
      expect(hello.type).toBe('hello');
      socket.close();
    } finally { await application.close(); }
  });
  it('rejects foreign origins and accepts a same-origin handshake', async () => {
    const application = createApp();
    await new Promise<void>(resolveListen => application.server.listen(0, '127.0.0.1', resolveListen));
    const address = application.server.address();
    if (!address || typeof address === 'string') throw new Error('No server port');
    const host = `127.0.0.1:${address.port}`;
    try {
      const rejected = new WebSocket(`ws://${host}/ws`, { origin: 'https://foreign.example' });
      await new Promise<void>(resolveError => rejected.once('error', () => resolveError()));
      const socket = new WebSocket(`ws://${host}/ws`, { origin: `http://${host}` });
      const hello = await new Promise<ServerMessage>(resolveMessage => socket.once('message', data => resolveMessage(JSON.parse(data.toString()))));
      expect(hello.type).toBe('hello');
      socket.close();
    } finally { await application.close(); }
  });
});
