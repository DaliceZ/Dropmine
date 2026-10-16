import { createClient } from 'redis';
import type { ClientMessage, ServerMessage } from '../../../shared/protocol.js';
import { PRESENCE_STATE_TTL_SECONDS } from '../config/presence.js';
import type { Device, SendMessage, Transfer } from '../modules/peer/peer.type.js';

export type StoredState = {
  version: 1;
  devices: Array<Omit<Device, 'paired'> & { paired: string[] }>;
  transfers: Transfer[];
  leases: Record<string, number>;
};
export type Delivery = { to: string; message: ServerMessage };

const commitScript = `
local current = redis.call('GET', KEYS[1]) or ''
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ${PRESENCE_STATE_TTL_SECONDS})
if ARGV[3] ~= '[]' then redis.call('PUBLISH', KEYS[2], ARGV[3]) end
return 1
`;
const upgradeScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return count
`;
const relayScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'device' end
local state = cjson.decode(raw)
if state.version ~= 1 then return 'version' end
local timestamp = tonumber(ARGV[3])
local sender = nil
for _, device in ipairs(state.devices) do
  if device.id == ARGV[1] and (state.leases[device.id] or 0) > timestamp then sender = device end
end
if not sender then return 'device' end
for _, transfer in ipairs(state.transfers) do
  if transfer.id == ARGV[2] and (transfer.sender == sender.id or transfer.receiver == sender.id) and transfer.expires >= timestamp then
    if not transfer.accepted then return 'permission' end
    local target = transfer.sender
    if sender.id == transfer.sender then target = transfer.receiver end
    for _, device in ipairs(state.devices) do
      if device.id == target and (state.leases[target] or 0) > timestamp then
        redis.call('PUBLISH', KEYS[2], '[{"to":' .. cjson.encode(target) .. ',"message":' .. ARGV[4] .. '}]')
        return 'ok'
      end
    end
    return 'transfer'
  end
end
return 'transfer'
`;

export function initRedisSessionRepo(options: { url: string; namespace: string; send: SendMessage; unavailable: () => void }) {
  const client = createClient({ url: options.url, disableOfflineQueue: true, commandsQueueMaxLength: 1000, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  const subscriber = client.duplicate();
  const stateKey = `dropmine:{${options.namespace}}:state:v1`;
  const channel = `dropmine:{${options.namespace}}:events:v1`;
  let readyPromise: Promise<void> | undefined;
  let subscribed = false;
  let closed = false;
  const unavailable = () => {
    subscribed = false;
    if (!closed) options.unavailable();
  };
  client.on('error', unavailable);
  subscriber.on('error', unavailable);
  subscriber.on('end', unavailable);
  const deliver = (payload: string) => {
    try {
      for (const delivery of JSON.parse(payload) as Delivery[]) options.send(delivery.to, delivery.message);
    } catch { unavailable(); }
  };

  async function ready() {
    if (closed) throw new Error('Signaling service is closed');
    if (client.isReady && subscriber.isReady && subscribed) return;
    if (!readyPromise) {
      readyPromise = (async () => {
        if (!client.isOpen) await client.connect();
        if (!subscriber.isOpen) await subscriber.connect();
        await subscriber.subscribe(channel, deliver);
        subscribed = true;
      })().catch(error => {
        if (client.isOpen) client.destroy();
        if (subscriber.isOpen) subscriber.destroy();
        throw error;
      }).finally(() => { readyPromise = undefined; });
    }
    await readyPromise;
  }

  return {
    ready,
    async read() {
      await ready();
      return client.withCommandOptions({ timeout: 5000 }).get(stateKey);
    },
    async commit(previous: string | null, state: StoredState, deliveries: Delivery[]) {
      return await client.withCommandOptions({ timeout: 5000 }).eval(commitScript, {
        keys: [stateKey, channel], arguments: [previous ?? '', JSON.stringify(state), JSON.stringify(deliveries)],
      }) === 1;
    },
    async allowUpgrade(group: string) {
      await ready();
      const attempts = await client.withCommandOptions({ timeout: 5000 }).eval(upgradeScript, { keys: [`dropmine:{${options.namespace}}:upgrade:${group}`], arguments: [] });
      return Number(attempts) <= 120;
    },
    async relay(deviceId: string, message: Extract<ClientMessage, { type: 'signal' }>, timestamp: number) {
      await ready();
      return client.withCommandOptions({ timeout: 5000 }).eval(relayScript, {
        keys: [stateKey, channel],
        arguments: [deviceId, message.id, String(timestamp), JSON.stringify({ type: 'signal', id: message.id, signal: message.signal })],
      });
    },
    async close() {
      closed = true;
      await readyPromise?.catch(() => {});
      if (subscriber.isOpen) subscriber.destroy();
      if (client.isOpen) client.destroy();
    },
  };
}
