import { describe, expect, it } from 'vitest';
import { readEnv } from '../../backend/src/config/env';
import { resolveSignalingUrl } from '../../frontend/src/config/signaling';
import { initNetworkGroup } from '../../backend/src/utils/network';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { initUpgradeLimit } from '../../backend/src/middlewares/upgrade-limit';

describe('production configuration', () => {
  it('bounds handshake rate and limiter memory, then releases expired groups', () => {
    const limiter = initUpgradeLimit(2, 2);
    expect(limiter.allow('one', 0)).toBe(true);
    expect(limiter.allow('one', 0)).toBe(true);
    expect(limiter.allow('one', 0)).toBe(false);
    expect(limiter.allow('two', 0)).toBe(true);
    expect(limiter.allow('three', 0)).toBe(false);
    limiter.expire(60_000);
    expect(limiter.allow('one', 60_000)).toBe(true);
    expect(limiter.allow('three', 60_000)).toBe(true);
  });
  it('requires an exact HTTPS frontend origin in production', () => {
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow('PUBLIC_ORIGIN');
    for (const origin of ['http://drop.example', 'https://drop.example/', 'https://drop.example/path', '*']) {
      expect(() => readEnv({ NODE_ENV: 'production', PUBLIC_ORIGIN: origin })).toThrow();
    }
    expect(readEnv({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://drop.example', SERVE_FRONTEND: 'false' }).staticDir).toBeUndefined();
  });
  it('rejects invalid ports and proxy settings', () => {
    for (const port of ['abc', '-1', '65536', '1.5']) expect(() => readEnv({ PORT: port })).toThrow('PORT');
    for (const hops of ['abc', '-1', '1.5', '11']) expect(() => readEnv({ TRUST_PROXY_HOPS: hops })).toThrow('TRUST_PROXY_HOPS');
    expect(() => readEnv({ STUN_URL: 'https://bad.example' })).toThrow('STUN_URL');
    expect(() => readEnv({ SERVE_FRONTEND: 'yes' })).toThrow('SERVE_FRONTEND');
  });
  it('uses same-origin sockets locally and a separate secure backend in production', () => {
    expect(resolveSignalingUrl('', 'http://localhost:5173/', false)).toBe('ws://localhost:5173/ws');
    expect(resolveSignalingUrl('', 'https://drop.example/', true)).toBe('wss://drop.example/ws');
    expect(resolveSignalingUrl('wss://signal.example/ws', 'https://drop.example/', true)).toBe('wss://signal.example/ws');
    for (const url of ['ws://signal.example/ws', 'https://signal.example/ws', 'wss://user:password@signal.example/ws', 'wss://signal.example/ws?token=secret', 'wss://signal.example/other', 'wss://signal.example/ws#token']) {
      expect(() => resolveSignalingUrl(url, 'https://drop.example/', true)).toThrow();
    }
  });
  it('only trusts forwarded addresses when explicitly configured', () => {
    const request = (forwarded: string) => {
      const socket = new Socket();
      Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
      const message = new IncomingMessage(socket);
      message.headers['x-forwarded-for'] = forwarded;
      return message;
    };
    const direct = initNetworkGroup(0);
    expect(direct(request('192.0.2.1'))).toBe(direct(request('192.0.2.2')));
    const proxied = initNetworkGroup(1);
    expect(proxied(request('192.0.2.1'))).not.toBe(proxied(request('192.0.2.2')));
    expect(proxied(request('forged, 192.0.2.1'))).toBe(proxied(request('192.0.2.1')));
    expect(proxied(request('invalid'))).toBeNull();
  });
});
