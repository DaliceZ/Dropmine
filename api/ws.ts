import { createApp } from '../backend/src/app.js';
import { env } from '../backend/src/config/env.js';

if (!env.redisUrl) throw new Error('Configure REDIS_URL before deploying the signaling function');

const application = createApp({ ...env, staticDir: undefined });

export default application.server;
