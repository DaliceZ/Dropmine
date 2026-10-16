import { z } from 'zod';
import { MAX_BYTES, MAX_FILES } from '../../../../shared/protocol.js';

const transferId = z.string().regex(/^[a-zA-Z0-9-]{8,64}$/);
const fileSchema = z.object({
  name: z.string().trim().min(1).max(255).transform(name => name.replace(/[\\/\x00-\x1f\x7f]/g, '_')),
  size: z.number().int().nonnegative().max(MAX_BYTES),
});
const signalSchema = z.union([
  z.object({ description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(64 * 1024) }) }),
  z.object({ candidate: z.object({ candidate: z.string().max(4096), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().nullable().optional(), usernameFragment: z.string().nullable().optional() }) }),
]);
export const peerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profile'), name: z.string().trim().min(1).max(40).transform(name => name.replace(/[\x00-\x1f\x7f]/g, '').trim()).pipe(z.string().min(1)), visible: z.boolean(), kind: z.enum(['mobile', 'desktop']) }),
  z.object({ type: z.literal('pair'), token: z.string().regex(/^[\w-]{32}$/) }),
  z.object({ type: z.literal('rotate-pair') }),
  z.object({ type: z.literal('refresh-peers') }),
  z.object({ type: z.literal('request'), target: z.string().uuid(), id: transferId, files: z.array(fileSchema).min(1).max(MAX_FILES).refine(files => files.reduce((total, file) => total + file.size, 0) <= MAX_BYTES) }),
  z.object({ type: z.literal('respond'), id: transferId, accept: z.boolean() }),
  z.object({ type: z.literal('signal'), id: transferId, signal: signalSchema }),
  z.object({ type: z.literal('cancel'), id: transferId }),
  z.object({ type: z.literal('complete'), id: transferId }),
]);
