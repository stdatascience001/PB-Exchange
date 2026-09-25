import { redis } from './redis.js';

// A subscriber connection can't run any other Redis command, so pub/sub needs its own
// dedicated connections separate from the shared `redis` client used everywhere else for
// caching (Jantri, etc.) — duplicating preserves the same host/port/password/retry config.
export const redisPublisher = redis.duplicate();
export const redisSubscriber = redis.duplicate();

redisPublisher.on('error', (err) => {
  console.warn(`[Redis Pub/Sub] Publisher connection warning: ${err.message}`);
});

redisSubscriber.on('error', (err) => {
  console.warn(`[Redis Pub/Sub] Subscriber connection warning: ${err.message}`);
});

export const DASHBOARD_UPDATES_CHANNEL = 'dashboard:updates';
