import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('connect', () => {
  console.log(`[Redis] Connected to ${env.REDIS_HOST}:${env.REDIS_PORT}`);
});

redis.on('error', (err) => {
  console.warn(`[Redis] Connection warning: ${err.message}`);
});
