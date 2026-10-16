import { resolve } from 'node:path';

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const production = source.NODE_ENV === 'production';
  const port = Number(source.PORT || 3001);
  const trustProxyHops = Number(source.TRUST_PROXY_HOPS || 0);
  const publicOrigin = source.PUBLIC_ORIGIN?.trim() || undefined;
  const stunUrl = source.STUN_URL?.trim() || undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  if (production && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== publicOrigin || (production && url.protocol !== 'https:')) {
      throw new Error('PUBLIC_ORIGIN must be an exact origin without a trailing slash; HTTPS is required in production');
    }
  }
  if (stunUrl && !/^stuns?:[^\s/?#@]+$/.test(stunUrl)) throw new Error('STUN_URL must be a stun: or stuns: endpoint');
  if (source.SERVE_FRONTEND && !['true', 'false'].includes(source.SERVE_FRONTEND)) throw new Error('SERVE_FRONTEND must be true or false');
  return {
    port, publicOrigin, trustProxyHops, stunUrl,
    staticDir: source.SERVE_FRONTEND === 'false' ? undefined : resolve(process.cwd(), '../frontend/dist'),
  };
}

export const env = readEnv();
