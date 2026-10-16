import { AppError } from '../../errors/app-error.js';
import { peerMessageSchema } from './peer.schema.js';
import type { SendMessage } from './peer.type.js';
import type { IPeerService } from './services/peer.service.js';

export function initPeerHandler(service: IPeerService, send: SendMessage) {
  return {
    connect: service.connect,
    disconnect: service.disconnect,
    expire: service.expire,
    message(deviceId: string, payload: string) {
      let requestId: string | undefined;
      try {
        const raw: unknown = JSON.parse(payload);
        if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string') requestId = raw.id.slice(0, 64);
        const result = peerMessageSchema.safeParse(raw);
        if (!result.success) throw new AppError('ข้อมูลไม่ถูกต้อง: สูงสุด 50 ไฟล์ รวมไม่เกิน 200 MB');
        service.handle(deviceId, result.data);
      } catch (error) {
        send(deviceId, { type: 'error', id: requestId, message: error instanceof AppError ? error.message : 'ไม่สามารถประมวลผลคำขอได้' });
      }
    },
  };
}
