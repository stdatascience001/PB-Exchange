import { redisPublisher } from '../../config/redisPubSub.js';

export const SHIFTS_UPDATES_CHANNEL = 'shifts:updates';

// Same fire-and-forget pattern as dashboard.events.ts's publishDashboardUpdate — never throws,
// a Redis hiccup here must not fail the real shift create/update/declare that triggered it.
export function publishShiftsUpdate() {
  redisPublisher.publish(SHIFTS_UPDATES_CHANNEL, JSON.stringify({ at: Date.now() })).catch((err) => {
    console.warn('[Shifts Events] Failed to publish update:', err.message);
  });
}
