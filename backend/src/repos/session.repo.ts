import type { Device, Transfer } from '../modules/peer/peer.type.js';

export function initSessionRepo() {
  const devices = new Map<string, Device>();
  const transfers = new Map<string, Transfer>();
  return {
    listDevices: () => [...devices.values()],
    getDevice: (id: string) => devices.get(id),
    saveDevice: (device: Device) => { devices.set(device.id, device); },
    deleteDevice: (id: string) => { devices.delete(id); },
    listTransfers: () => [...transfers.values()],
    getTransfer: (id: string) => transfers.get(id),
    saveTransfer: (transfer: Transfer) => { transfers.set(transfer.id, transfer); },
    deleteTransfer: (id: string) => { transfers.delete(id); },
  };
}
export type ISessionRepo = ReturnType<typeof initSessionRepo>;
