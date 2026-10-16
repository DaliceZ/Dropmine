import { randomBytes, randomUUID } from 'node:crypto';
import { PAIR_TTL, type ClientMessage, type Peer, type ServerMessage } from '../../../../../shared/protocol.js';
import { AppError } from '../../../errors/app-error.js';
import type { ISessionRepo } from '../../../repos/session.repo.js';
import type { Device, SendMessage, Transfer } from '../peer.type.js';
import { initRefreshCooldown } from './refresh-cooldown.js';

export function initPeerService(repo: ISessionRepo, send: SendMessage, iceServers: RTCIceServer[] = []) {
  const refreshCooldown = initRefreshCooldown();
  const peer = (device: Device): Peer => ({ id: device.id, name: device.name, kind: device.kind });
  const canSee = (device: Device, target: Device) => target.visible && target.group === device.group || device.paired.has(target.id);
  function peerViews(devices: Device[]) {
    const targets = repo.listDevices();
    return new Map(devices.map(device => [device.id, JSON.stringify(targets.filter(target => target.id !== device.id && canSee(device, target)).map(peer))]));
  }
  function broadcast(previous: Map<string, string>, forceId?: string) {
    const devices = [...previous.keys()].map(id => repo.getDevice(id)).filter((device): device is Device => Boolean(device));
    const current = peerViews(devices);
    for (const [id, view] of current) {
      if (id === forceId || previous.get(id) !== view) send(id, { type: 'peers', peers: JSON.parse(view) as Peer[] });
    }
  }
  function end(transfer: Transfer, reason: Extract<ServerMessage, { type: 'ended' }>['reason']) {
    repo.deleteTransfer(transfer.id);
    for (const id of [transfer.sender, transfer.receiver]) send(id, { type: 'ended', id: transfer.id, reason });
  }
  function rotate(device: Device) {
    device.token = randomBytes(24).toString('base64url');
    device.expires = Date.now() + PAIR_TTL;
    repo.saveDevice(device);
  }
  function requireTransfer(id: string, deviceId: string) {
    const transfer = repo.getTransfer(id);
    if (!transfer || ![transfer.sender, transfer.receiver].includes(deviceId)) throw new AppError('ไม่พบรายการส่งไฟล์');
    return transfer;
  }
  return {
    connect(group: string) {
      if (repo.listDevices().length >= 1000 || repo.listDevices().filter(device => device.group === group).length >= 30) throw new AppError('มีอุปกรณ์เชื่อมต่อมากเกินไป');
      const device: Device = { id: randomUUID(), name: 'New device', kind: 'desktop', group, visible: false, token: '', expires: 0, paired: new Set() };
      rotate(device);
      return { id: device.id, hello: { type: 'hello', self: peer(device), token: device.token, expires: device.expires, iceServers } satisfies ServerMessage };
    },
    disconnect(deviceId: string) {
      const device = repo.getDevice(deviceId);
      if (!device) return;
      const previous = peerViews(repo.listDevices().filter(target => target.id !== deviceId && canSee(target, device)));
      repo.deleteDevice(deviceId);
      for (const target of repo.listDevices()) if (target.paired.delete(deviceId)) repo.saveDevice(target);
      for (const transfer of repo.listTransfers()) if ([transfer.sender, transfer.receiver].includes(deviceId)) end(transfer, 'disconnected');
      broadcast(previous);
    },
    expire() { for (const transfer of repo.listTransfers()) if (transfer.expires < Date.now()) end(transfer, 'timeout'); },
    handle(deviceId: string, message: ClientMessage) {
      const device = repo.getDevice(deviceId);
      if (!device) throw new AppError('ไม่พบอุปกรณ์');
      if (message.type === 'refresh-peers') {
        refreshCooldown(deviceId);
        send(deviceId, { type: 'peers', peers: JSON.parse(peerViews([device]).get(deviceId)!) as Peer[], refreshed: true });
        return;
      }
      if (message.type === 'profile') {
        const previous = peerViews(repo.listDevices().filter(target => target.id === device.id || target.group === device.group || target.paired.has(device.id)));
        Object.assign(device, { name: message.name, visible: message.visible, kind: message.kind });
        repo.saveDevice(device);
        broadcast(previous, device.id);
        return;
      }
      if (message.type === 'rotate-pair') {
        rotate(device);
        send(device.id, { type: 'pair-token', token: device.token, expires: device.expires });
        return;
      }
      if (message.type === 'pair') {
        const target = repo.listDevices().find(value => value.token === message.token && value.expires > Date.now());
        if (!target || target.id === device.id) throw new AppError('ลิงก์จับคู่ไม่ถูกต้องหรือหมดอายุแล้ว');
        if ((!device.paired.has(target.id) && device.paired.size >= 30) || (!target.paired.has(device.id) && target.paired.size >= 30)) throw new AppError('จับคู่ได้สูงสุด 30 อุปกรณ์');
        const previous = peerViews([device, target]);
        device.paired.add(target.id);
        target.paired.add(device.id);
        repo.saveDevice(device);
        repo.saveDevice(target);
        send(device.id, { type: 'paired', peer: peer(target) });
        send(target.id, { type: 'paired', peer: peer(device) });
        broadcast(previous);
        return;
      }
      if (message.type === 'request') {
        const target = repo.getDevice(message.target);
        if (!target || target.id === device.id || !canSee(device, target)) throw new AppError('ไม่พบอุปกรณ์นี้ กรุณาลองจับคู่ด้วย QR');
        if (repo.getTransfer(message.id)) throw new AppError('รหัสการส่งซ้ำ กรุณาลองใหม่');
        if (repo.listTransfers().some(transfer => [transfer.sender, transfer.receiver].some(id => id === device.id || id === target.id))) throw new AppError('อุปกรณ์กำลังส่งหรือรับไฟล์อยู่ กรุณาลองอีกครั้ง');
        repo.saveTransfer({ id: message.id, sender: device.id, receiver: target.id, accepted: false, expires: Date.now() + 60_000 });
        send(target.id, { type: 'incoming', id: message.id, peer: peer(device), files: message.files });
        return;
      }
      const transfer = requireTransfer(message.id, device.id);
      if (message.type === 'respond') {
        if (transfer.receiver !== device.id || transfer.accepted) throw new AppError('ไม่สามารถตอบรับรายการนี้ได้');
        if (!message.accept) return end(transfer, 'declined');
        transfer.accepted = true;
        transfer.expires = Date.now() + 20 * 60_000;
        repo.saveTransfer(transfer);
        send(transfer.sender, { type: 'accepted', id: transfer.id, peer: peer(device), initiator: true });
        send(device.id, { type: 'accepted', id: transfer.id, peer: peer(repo.getDevice(transfer.sender)!), initiator: false });
      } else if (message.type === 'signal') {
        if (!transfer.accepted) throw new AppError('ยังไม่ได้รับอนุญาตให้เชื่อมต่อ');
        send(device.id === transfer.sender ? transfer.receiver : transfer.sender, { type: 'signal', id: transfer.id, signal: message.signal });
      } else if (message.type === 'cancel') end(transfer, 'cancelled');
      else if (message.type === 'complete' && transfer.accepted && transfer.receiver === device.id) end(transfer, 'complete');
      else throw new AppError('คำสั่งไม่ถูกต้อง');
    },
  };
}
export type IPeerService = ReturnType<typeof initPeerService>;
