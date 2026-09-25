import { redisPublisher, DASHBOARD_UPDATES_CHANNEL } from '../../config/redisPubSub.js';
import { DashboardService } from './dashboard.service.js';

// Fire-and-forget notification that dashboard metrics may have changed — consumed by the
// /dashboard/stream SSE endpoint to push a fresh snapshot to connected clients (the SSE
// endpoint itself isn't currently used by the frontend, but is left wired up). Also clears
// the short-TTL metrics cache so the next poll reflects this write immediately instead of
// waiting out the TTL. Never throws: a Redis hiccup here must not fail the real write
// (transaction/declare) that triggered it.
export function publishDashboardUpdate(shiftId?: number) {
  redisPublisher.publish(DASHBOARD_UPDATES_CHANNEL, JSON.stringify({ shiftId, at: Date.now() })).catch((err) => {
    console.warn('[Dashboard Events] Failed to publish update:', err.message);
  });
  DashboardService.invalidateMetricsCache();
}
