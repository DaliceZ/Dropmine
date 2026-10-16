import { readEnv } from '../backend/src/config/env.js';

const configuration = readEnv({ ...process.env, NODE_ENV: 'production', VERCEL: '1' });
if (!configuration.redisUrl) throw new Error('REDIS_URL is required for a Vercel deployment');
console.log('Vercel signaling configuration validated');
