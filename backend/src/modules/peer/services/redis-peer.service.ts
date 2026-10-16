import type { ClientMessage } from '../../../../../shared/protocol.js';
import { AppError } from '../../../errors/app-error.js';
import { initRedisSessionRepo, type Delivery, type StoredState } from '../../../repos/redis-session.repo.js';
import { initSessionRepo, type ISessionRepo } from '../../../repos/session.repo.js';
import type { SendMessage } from '../peer.type.js';
import type { PeerService } from './peer-service.type.js';
import { initPeerService } from './peer.service.js';

export function initRedisPeerService(options: { url: string; namespace: string; send: SendMessage; unavailable: () => void; iceServers?: RTCIceServer[]; now?: () => number }): PeerService {
  const shared = initRedisSessionRepo(options);
  const now = options.now ?? Date.now;
  let lastMaintenance = 0;

  async function transact<Result>(operation: (service: ReturnType<typeof initPeerService>, repo: ISessionRepo, leases: Record<string, number>) => Result): Promise<Result> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const raw = await shared.read();
      const state: StoredState = raw ? JSON.parse(raw) : { version: 1, devices: [], transfers: [], leases: {} };
      if (state.version !== 1) throw new Error('Unsupported signaling state version');
      const repo = initSessionRepo();
      for (const device of state.devices) repo.saveDevice({ ...device, paired: new Set(device.paired) });
      for (const transfer of state.transfers) repo.saveTransfer(transfer);
      const deliveries: Delivery[] = [];
      const service = initPeerService(repo, (to, message) => deliveries.push({ to, message }), options.iceServers);
      for (const device of repo.listDevices()) {
        if ((state.leases[device.id] ?? 0) <= now()) {
          service.disconnect(device.id);
          delete state.leases[device.id];
        }
      }
      service.expire();
      const result = operation(service, repo, state.leases);
      const next: StoredState = {
        version: 1,
        devices: repo.listDevices().map(device => ({ ...device, paired: [...device.paired] })),
        transfers: repo.listTransfers(), leases: state.leases,
      };
      const peers = new Map<string, Delivery>();
      const events: Delivery[] = [];
      for (const delivery of deliveries) {
        if (delivery.message.type === 'peers') peers.set(delivery.to, delivery);
        else events.push(delivery);
      }
      if (await shared.commit(raw, next, [...events, ...peers.values()])) return result;
      await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 40));
    }
    throw new AppError('ระบบกำลังมีผู้ใช้จำนวนมาก กรุณาลองใหม่');
  }

  return {
    ready: shared.ready,
    close: shared.close,
    async connect(group) {
      if (!await shared.allowUpgrade(group)) throw new AppError('เชื่อมต่อบ่อยเกินไป กรุณารอสักครู่');
      return transact((service, repo, leases) => {
        if (repo.listDevices().length >= 200) throw new AppError('มีอุปกรณ์เชื่อมต่อมากเกินไป');
        const session = service.connect(group);
        leases[session.id] = now() + 90_000;
        return session;
      });
    },
    disconnect: deviceId => transact((service, repo, leases) => {
      if (repo.getDevice(deviceId)) service.disconnect(deviceId);
      delete leases[deviceId];
    }),
    handle: (deviceId: string, message: ClientMessage) => transact((service, _repo, leases) => {
      service.handle(deviceId, message);
      leases[deviceId] = now() + 90_000;
    }),
    async expire(localIds = []) {
      if (now() - lastMaintenance < 30_000) return;
      await transact((_service, repo, leases) => {
        for (const id of localIds) if (repo.getDevice(id)) leases[id] = now() + 90_000;
      });
      lastMaintenance = now();
    },
  };
}
