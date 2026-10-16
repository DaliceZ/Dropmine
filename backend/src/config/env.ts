import { resolve } from 'node:path';

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const production = source.NODE_ENV === 'production';
  const port = Number(source.PORT || 3001);
  const trustProxyHops = Number(source.TRUST_PROXY_HOPS || (source.VERCEL ? 1 : 0));
  const publicOrigin = source.PUBLIC_ORIGIN?.trim() || undefined;
  const stunUrl = source.STUN_URL?.trim() || undefined;
  const redisUrl = source.REDIS_URL?.trim() || undefined;
  const redisNamespace = source.REDIS_NAMESPACE?.trim() || undefined;
  const networkGroupSecret = source.NETWORK_GROUP_SECRET?.trim() || undefined;
  if (source.VERCEL && !redisUrl) throw new Error('REDIS_URL is required on Vercel; in-memory signaling is not supported across instances');
  if (redisUrl) {
    let url: URL;
    try { url = new URL(redisUrl); } catch { throw new Error('REDIS_URL must be a valid Redis connection URL'); }
    if (!['redis:', 'rediss:'].includes(url.protocol) || (production && url.protocol !== 'rediss:')) throw new Error('REDIS_URL requires rediss:// in production');
    if (!networkGroupSecret || networkGroupSecret.length < 32) throw new Error('NETWORK_GROUP_SECRET must contain at least 32 characters when Redis is enabled');
    if (!redisNamespace || !/^[a-zA-Z0-9_-]{1,64}$/.test(redisNamespace)) throw new Error('REDIS_NAMESPACE must be a unique environment name (letters, digits, underscore or hyphen)');
  }
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
    port, publicOrigin, trustProxyHops, stunUrl, redisUrl, redisNamespace, networkGroupSecret,
    staticDir: source.SERVE_FRONTEND === 'false' ? undefined : resolve(process.cwd(), '../frontend/dist'),
  };
}

export const env = readEnv();
