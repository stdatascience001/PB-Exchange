import { Request, Response, NextFunction } from 'express';
import { DashboardService } from './dashboard.service.js';
import { redisSubscriber, DASHBOARD_UPDATES_CHANNEL } from '../../config/redisPubSub.js';

export class DashboardController {
  static async getMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;
      const data = await DashboardService.getDashboardMetrics(user?.roleName, user?.roleId, user?.userId);
      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }

  // Additive real-time channel alongside GET /metrics above (which is left completely
  // untouched, and stays the source of truth / fallback for anything not yet using this
  // stream). Pushes a fresh snapshot on connect, then again whenever a write anywhere
  // publishes to the dashboard:updates Redis channel — no polling needed by the client.
  static async streamMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendSnapshot = async () => {
        try {
          const data = await DashboardService.getDashboardMetrics(user?.roleName, user?.roleId, user?.userId);
          res.write(`event: metrics\ndata: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
          console.warn('[Dashboard SSE] Failed to send snapshot:', err);
        }
      };

      // Initial snapshot immediately, same data GET /metrics would return right now.
      await sendSnapshot();

      const onMessage = (channel: string) => {
        if (channel === DASHBOARD_UPDATES_CHANNEL) {
          sendSnapshot();
        }
      };
      // Every connected SSE client adds its own 'message' listener on the one shared
      // subscriber connection; re-issuing SUBSCRIBE for an already-subscribed channel is a
      // harmless no-op in Redis, so no need to track whether this is the first client.
      redisSubscriber.on('message', onMessage);
      redisSubscriber.subscribe(DASHBOARD_UPDATES_CHANNEL).catch((err) => {
        console.warn('[Dashboard SSE] Redis subscribe warning:', err.message);
      });

      req.on('close', () => {
        redisSubscriber.off('message', onMessage);
      });
    } catch (err) {
      next(err);
    }
  }
}
