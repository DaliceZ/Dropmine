import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export function initNetworkGroup(proxyHops: number) {
  const secret = randomBytes(32);
  return (request: IncomingMessage) => {
    const forwarded = proxyHops ? String(request.headers['x-forwarded-for'] ?? '').split(',').map(value => value.trim()).filter(Boolean) : [];
    const chain = [...forwarded, request.socket.remoteAddress ?? ''];
    const address = chain[Math.max(0, chain.length - 1 - proxyHops)].replace(/^::ffff:/, '');
    if (!isIP(address)) return null;
    return createHmac('sha256', secret).update(address).digest('hex');
  };
}
