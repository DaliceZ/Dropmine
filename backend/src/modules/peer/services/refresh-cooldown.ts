import { PEER_REFRESH_COOLDOWN_MS } from '../../../../../shared/protocol.js';
import { AppError } from '../../../errors/app-error.js';

export function initRefreshCooldown() {
  const deadlines = new Map<string, number>();
  return (deviceId: string, now = Date.now()) => {
    for (const [id, deadline] of deadlines) if (deadline <= now) deadlines.delete(id);
    if (deadlines.has(deviceId)) throw new AppError('กรุณารอ 10 วินาทีก่อนรีเฟรชอีกครั้ง');
    deadlines.set(deviceId, now + PEER_REFRESH_COOLDOWN_MS);
  };
}
