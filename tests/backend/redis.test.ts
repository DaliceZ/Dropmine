import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from 'redis';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../../backend/src/app';
import { initRedisPeerService } from '../../backend/src/modules/peer/services/redis-peer.service';
import type { PeerService } from '../../backend/src/modules/peer/services/peer-service.type';
import type { ServerMessage } from '../../shared/protocol';

describe.skipIf(!process.env.TEST_REDIS_URL)('distributed Redis signaling', () => {
  const url = process.env.TEST_REDIS_URL!;
  let client: ReturnType<typeof createClient>;
  let namespace: string;
  let services: PeerService[];
  let messages: Array<{ instance: string; to: string; message: ServerMessage }>;
  let clock: number;
  const stateKey = () => `dropmine:{${namespace}}:state:v1`;
  async function commandCounts() {
    const info = await client.info('commandstats');
    const counts = { get: 0, eval: 0, set: 0, publish: 0 };
    for (const match of info.matchAll(/cmdstat_(get|eval|set|publish):calls=(\d+)/g)) counts[match[1] as keyof typeof counts] = Number(match[2]);
    return counts;
  }
  async function measure(operation: () => Promise<void>) {
    const before = await commandCounts();
    await operation();
    const after = await commandCounts();
    return Object.fromEntries(Object.keys(before).map(command => [command, after[command as keyof typeof after] - before[command as keyof typeof before]]));
  }
  function instance(name: string, isolatedNamespace = namespace, unavailable = vi.fn()) {
    const service = initRedisPeerService({ url, namespace: isolatedNamespace, now: () => clock, unavailable, send: (to, message) => messages.push({ instance: name, to, message }) });
    services.push(service);
    return service;
  }
  beforeEach(async () => {
    namespace = `test-${randomUUID()}`;
    services = [];
    messages = [];
    clock = Date.now();
    client = createClient({ url });
    await client.connect();
  });
  afterEach(async () => {
    await Promise.all(services.map(service => service.close?.()));
    await client.del([stateKey(), `dropmine:{${namespace}-isolated}:state:v1`]);
    client.destroy();
  });

  it('discovers and transfers across instances without persisting filenames or SDP', async () => {
    const first = instance('one');
    const second = instance('two');
    const sender = await first.connect('network');
    const receiver = await second.connect('network');
    await Promise.all([
      first.handle(sender.id, { type: 'profile', name: 'Computer', kind: 'desktop', visible: true }),
      second.handle(receiver.id, { type: 'profile', name: 'Phone', kind: 'mobile', visible: true }),
    ]);
    await expect.poll(() => messages.some(delivery => delivery.instance === 'one' && delivery.to === sender.id && delivery.message.type === 'peers' && delivery.message.peers.some(peer => peer.id === receiver.id))).toBe(true);
    await first.handle(sender.id, { type: 'request', id: 'transfer-redis', target: receiver.id, files: [{ name: 'private-filename.txt', size: 12 }] });
    await expect.poll(() => messages.some(delivery => delivery.instance === 'two' && delivery.to === receiver.id && delivery.message.type === 'incoming')).toBe(true);
    await expect(first.handle(sender.id, { type: 'signal', id: 'transfer-redis', signal: { description: { type: 'offer', sdp: 'private-sdp' } } })).rejects.toThrow();
    await second.handle(receiver.id, { type: 'respond', id: 'transfer-redis', accept: true });
    await first.handle(sender.id, { type: 'signal', id: 'transfer-redis', signal: { description: { type: 'offer', sdp: 'private-sdp' } } });
    await expect.poll(() => messages.some(delivery => delivery.instance === 'two' && delivery.to === receiver.id && delivery.message.type === 'signal')).toBe(true);
    const stored = await client.get(stateKey());
    expect(stored).not.toContain('private-filename');
    expect(stored).not.toContain('private-sdp');
    expect(await client.ttl(stateKey())).toBeGreaterThan(0);
    expect(await client.ttl(stateKey())).toBeLessThanOrEqual(360);
    await second.handle(receiver.id, { type: 'complete', id: 'transfer-redis' });
    await expect.poll(() => messages.filter(delivery => delivery.instance === 'one' && delivery.to === sender.id && delivery.message.type === 'ended').length).toBe(1);
    expect(JSON.parse((await client.get(stateKey()))!).transfers).toHaveLength(0);
  });

  it('commits competing requests atomically and publishes only the winner', async () => {
    const first = instance('one');
    const second = instance('two');
    const [sender, receiver, other] = await Promise.all([first.connect('network'), second.connect('network'), second.connect('network')]);
    await Promise.all([sender, receiver, other].map(device => first.handle(device.id, { type: 'profile', name: 'Device', kind: 'desktop', visible: true })));
    const results = await Promise.allSettled([
      first.handle(sender.id, { type: 'request', id: 'competing-one', target: receiver.id, files: [{ name: 'one', size: 1 }] }),
      second.handle(sender.id, { type: 'request', id: 'competing-two', target: other.id, files: [{ name: 'two', size: 1 }] }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(JSON.parse((await client.get(stateKey()))!).transfers).toHaveLength(1);
    await expect.poll(() => messages.filter(delivery => delivery.instance === 'two' && delivery.message.type === 'incoming').length).toBe(1);
  });

  it('measures Redis operations for one accepted signal', async () => {
    const service = instance('one');
    const sender = await service.connect('network');
    const receiver = await service.connect('network');
    await service.handle(receiver.id, { type: 'profile', name: 'Phone', visible: true, kind: 'mobile' });
    await service.handle(sender.id, { type: 'request', id: 'measured-signal', target: receiver.id, files: [{ name: 'file', size: 1 }] });
    await service.handle(receiver.id, { type: 'respond', id: 'measured-signal', accept: true });
    const counts = await measure(async () => {
      await service.handle(sender.id, { type: 'signal', id: 'measured-signal', signal: { description: { type: 'offer', sdp: 'sdp' } } });
    });
    console.log('Redis operations per signal:', counts);
    expect(counts).toEqual({ get: 1, eval: 1, set: 0, publish: 1 });
  });

  it('measures idle presence operations over two minutes', async () => {
    const service = instance('one');
    const device = await service.connect('network');
    await service.expire([device.id]);
    const counts = await measure(async () => {
      for (let tick = 0; tick < 4; tick++) {
        clock += 30_000;
        await service.expire([device.id]);
      }
    });
    console.log('Redis idle operations over 120 seconds:', counts);
    expect(counts).toEqual({ get: 4, eval: 2, set: 2, publish: 0 });
  });

  it('refreshes from one read without writes or broadcasts and limits repeated requests', async () => {
    const first = instance('one');
    const second = instance('two');
    const sender = await first.connect('network');
    const receiver = await second.connect('network');
    const hidden = await second.connect('other');
    const expired = await second.connect('network');
    for (const device of [receiver, expired]) await second.handle(device.id, { type: 'profile', name: 'Phone', visible: true, kind: 'mobile' });
    await first.handle(sender.id, { type: 'pair', token: hidden.hello.token });
    const state = JSON.parse((await client.get(stateKey()))!);
    state.leases[expired.id] = clock;
    const before = JSON.stringify(state);
    await client.set(stateKey(), before, { EX: 100 });
    const counts = await measure(async () => {
      await first.handle(sender.id, { type: 'refresh-peers' });
      await expect(first.handle(sender.id, { type: 'refresh-peers' })).rejects.toThrow('10 วินาที');
    });
    expect(counts).toEqual({ get: 1, eval: 0, set: 0, publish: 0 });
    expect(messages.filter(delivery => delivery.message.type === 'peers' && delivery.message.refreshed)).toEqual([
      { instance: 'one', to: sender.id, message: { type: 'peers', refreshed: true, peers: [
        expect.objectContaining({ id: receiver.id }), expect.objectContaining({ id: hidden.id }),
      ] } },
    ]);
    expect(await client.get(stateKey())).toBe(before);
    expect(await client.ttl(stateKey())).toBeLessThanOrEqual(100);
    clock += 10_000;
    await expect(first.handle(sender.id, { type: 'refresh-peers' })).resolves.toBeUndefined();
    clock += 180_000;
    await expect(first.handle(sender.id, { type: 'refresh-peers' })).rejects.toThrow('ไม่พบอุปกรณ์');
  });

  it('relays in both directions without rewriting state, leases or TTL', async () => {
    const first = instance('one');
    const second = instance('two');
    const sender = await first.connect('network');
    const receiver = await second.connect('network');
    await second.handle(receiver.id, { type: 'profile', name: 'Phone', visible: true, kind: 'mobile' });
    await first.handle(sender.id, { type: 'request', id: 'read-only', target: receiver.id, files: [{ name: 'file', size: 1 }] });
    await second.handle(receiver.id, { type: 'respond', id: 'read-only', accept: true });
    const before = await client.get(stateKey());
    await client.expire(stateKey(), 100);
    await first.handle(sender.id, { type: 'signal', id: 'read-only', signal: { description: { type: 'offer', sdp: 'offer' } } });
    await second.handle(receiver.id, { type: 'signal', id: 'read-only', signal: { description: { type: 'answer', sdp: 'answer' } } });
    await expect.poll(() => messages.filter(delivery => delivery.message.type === 'signal').length).toBe(4);
    expect(await client.get(stateKey())).toBe(before);
    expect(await client.ttl(stateKey())).toBeGreaterThan(0);
    expect(await client.ttl(stateKey())).toBeLessThanOrEqual(100);
  });

  it('rejects unauthorized, expired and revoked signal relays without publishing', async () => {
    const service = instance('one');
    const sender = await service.connect('network');
    const receiver = await service.connect('network');
    const outsider = await service.connect('other');
    await service.handle(receiver.id, { type: 'profile', name: 'Phone', visible: true, kind: 'mobile' });
    await service.handle(sender.id, { type: 'request', id: 'secure-relay', target: receiver.id, files: [{ name: 'file', size: 1 }] });
    const signal = { type: 'signal' as const, id: 'secure-relay', signal: { description: { type: 'offer' as const, sdp: 'offer' } } };
    await expect(service.handle(sender.id, signal)).rejects.toThrow('ยังไม่ได้รับอนุญาต');
    await service.handle(receiver.id, { type: 'respond', id: signal.id, accept: true });
    const original = (await client.get(stateKey()))!;
    const counts = await measure(async () => {
      await expect(service.handle(outsider.id, signal)).rejects.toThrow('ไม่พบรายการ');
      await expect(service.handle('unknown', signal)).rejects.toThrow('ไม่พบอุปกรณ์');
      await expect(service.handle(sender.id, { ...signal, id: 'missing' })).rejects.toThrow('ไม่พบรายการ');
      for (const expired of ['transfer', 'sender', 'receiver']) {
        const state = JSON.parse(original);
        if (expired === 'transfer') state.transfers[0].expires = clock - 1;
        else state.leases[expired === 'sender' ? sender.id : receiver.id] = clock;
        await client.set(stateKey(), JSON.stringify(state), { EX: 360 });
        await expect(service.handle(sender.id, signal)).rejects.toThrow();
      }
    });
    expect(counts.publish).toBe(0);
    await client.set(stateKey(), original, { EX: 360 });
    await service.handle(receiver.id, { type: 'complete', id: signal.id });
    const revoked = await measure(async () => { await expect(service.handle(sender.id, signal)).rejects.toThrow('ไม่พบรายการ'); });
    expect(revoked.publish).toBe(0);
    await client.set(stateKey(), original, { EX: 360 });
    await service.handle(sender.id, { type: 'cancel', id: signal.id });
    await expect(service.handle(receiver.id, signal)).rejects.toThrow('ไม่พบรายการ');
    await client.set(stateKey(), JSON.stringify({ ...JSON.parse(original), version: 2 }), { EX: 360 });
    await expect(service.handle(sender.id, signal)).rejects.toThrow('Unsupported');
    await client.del(stateKey());
    await expect(service.handle(sender.id, signal)).rejects.toThrow('ไม่พบอุปกรณ์');
  });

  it('removes crashed devices by lease and notifies the surviving peer', async () => {
    const first = instance('one');
    const second = instance('two');
    const sender = await first.connect('network');
    const receiver = await second.connect('network');
    await second.handle(receiver.id, { type: 'profile', name: 'Phone', kind: 'mobile', visible: true });
    await first.handle(sender.id, { type: 'request', id: 'crashed-transfer', target: receiver.id, files: [{ name: 'one', size: 1 }] });
    clock += 120_000;
    await second.expire([receiver.id]);
    clock += 61_000;
    await second.expire([receiver.id]);
    const state = JSON.parse((await client.get(stateKey()))!);
    expect(state.devices.map((device: { id: string }) => device.id)).toEqual([receiver.id]);
    expect(state.transfers).toHaveLength(0);
    await expect.poll(() => messages.some(delivery => delivery.to === receiver.id && delivery.message.type === 'ended' && delivery.message.reason === 'disconnected')).toBe(true);
    await second.disconnect(receiver.id);
    expect(JSON.parse((await client.get(stateKey()))!).devices).toHaveLength(0);
    await client.expire(stateKey(), 1);
    await expect.poll(() => client.get(stateKey()), { timeout: 3000 }).toBeNull();
  });

  it('isolates preview state and pairing from production', async () => {
    const production = instance('production');
    const preview = instance('preview', `${namespace}-isolated`);
    const sender = await production.connect('network');
    const receiver = await preview.connect('network');
    await preview.handle(receiver.id, { type: 'profile', name: 'Preview', kind: 'desktop', visible: true });
    await expect(production.handle(sender.id, { type: 'pair', token: receiver.hello.token })).rejects.toThrow();
    expect(JSON.parse((await client.get(stateKey()))!).devices).toHaveLength(1);
  });

  it('invalidates local connections if the Redis subscription is lost', async () => {
    const unavailable = vi.fn();
    const service = instance('one', namespace, unavailable);
    await service.ready?.();
    await client.sendCommand(['CLIENT', 'KILL', 'TYPE', 'pubsub', 'SKIPME', 'yes']);
    await expect.poll(() => unavailable.mock.calls.length).toBeGreaterThan(0);
    await service.ready?.();
    const session = await service.connect('network');
    await service.handle(session.id, { type: 'profile', name: 'Recovered', visible: true, kind: 'desktop' });
    await expect.poll(() => messages.filter(delivery => delivery.to === session.id && delivery.message.type === 'peers').length).toBe(1);
  });

  it('shares the upgrade rate limit across instances without creating a session', async () => {
    const key = `dropmine:{${namespace}}:upgrade:limited`;
    await client.set(key, '120', { EX: 60 });
    const first = instance('one');
    const second = instance('two');
    await expect(first.connect('limited')).rejects.toThrow('เชื่อมต่อบ่อยเกินไป');
    await expect(second.connect('limited')).rejects.toThrow('เชื่อมต่อบ่อยเกินไป');
    expect(await client.get(key)).toBe('122');
    expect(await client.get(stateKey())).toBeNull();
    await client.del(key);
  });

  it('shares discovery between two real websocket servers with the same network secret', async () => {
    const options = { redisUrl: url, redisNamespace: namespace, networkGroupSecret: 'shared-test-secret-at-least-32-characters' };
    const first = createApp(options);
    const second = createApp(options);
    const connections: WebSocket[] = [];
    async function open(application: ReturnType<typeof createApp>) {
      await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve));
      const address = application.server.address();
      if (!address || typeof address === 'string') throw new Error('No server address');
      const host = `127.0.0.1:${address.port}`;
      const socket = new WebSocket(`ws://${host}/api/ws`, { origin: `http://${host}` });
      connections.push(socket);
      const events: ServerMessage[] = [];
      socket.on('message', payload => events.push(JSON.parse(payload.toString())));
      await expect.poll(() => events.find(event => event.type === 'hello')).toBeTruthy();
      return { socket, events, hello: events.find(event => event.type === 'hello')! as Extract<ServerMessage, { type: 'hello' }> };
    }
    try {
      const sender = await open(first);
      const receiver = await open(second);
      sender.socket.send(JSON.stringify({ type: 'profile', name: 'Computer', kind: 'desktop', visible: true }));
      receiver.socket.send(JSON.stringify({ type: 'profile', name: 'Phone', kind: 'mobile', visible: true }));
      await expect.poll(() => sender.events.some(event => event.type === 'peers' && event.peers.some(peer => peer.name === 'Phone'))).toBe(true);
      sender.socket.send(JSON.stringify({ type: 'request', id: 'websocket-redis', target: receiver.hello.self.id, files: [{ name: 'test.txt', size: 4 }] }));
      await expect.poll(() => receiver.events.some(event => event.type === 'incoming')).toBe(true);
      receiver.socket.send(JSON.stringify({ type: 'respond', id: 'websocket-redis', accept: false }));
      await expect.poll(() => sender.events.some(event => event.type === 'ended' && event.reason === 'declined')).toBe(true);
    } finally {
      for (const connection of connections) connection.terminate();
      await Promise.all([first.close(), second.close()]);
    }
  });
});
