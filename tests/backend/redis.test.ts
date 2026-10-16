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
    expect(await client.ttl(stateKey())).toBeLessThanOrEqual(180);
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

  it('removes crashed devices by lease and notifies the surviving peer', async () => {
    const first = instance('one');
    const second = instance('two');
    const sender = await first.connect('network');
    const receiver = await second.connect('network');
    await second.handle(receiver.id, { type: 'profile', name: 'Phone', kind: 'mobile', visible: true });
    await first.handle(sender.id, { type: 'request', id: 'crashed-transfer', target: receiver.id, files: [{ name: 'one', size: 1 }] });
    clock += 60_000;
    await second.expire([receiver.id]);
    clock += 31_000;
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
