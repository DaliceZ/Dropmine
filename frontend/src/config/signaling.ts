export function resolveSignalingUrl(value: string | undefined, pageUrl: string, production: boolean) {
  const page = new URL(pageUrl);
  const url = value?.trim() ? new URL(value.trim()) : new URL('/ws', page);
  if (!value?.trim()) url.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/ws') {
    throw new Error('VITE_SIGNALING_URL must be a WebSocket URL ending in /ws without credentials, query or fragment');
  }
  if ((production || page.protocol === 'https:') && url.protocol !== 'wss:') {
    throw new Error('Production signaling requires wss://');
  }
  return url.href;
}
