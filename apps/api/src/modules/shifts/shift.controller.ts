import { Request, Response, NextFunction } from 'express';
import { ShiftService } from './shift.service.js';
import { sendSuccess } from '../../common/response.js';
import { redisSubscriber } from '../../config/redisPubSub.js';
import { SHIFTS_UPDATES_CHANNEL } from './shift.events.js';

export class ShiftController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userRoleId = req.user?.roleId;
      const userRoleName = req.user?.roleName;
      const userId = req.user?.userId;
      const shifts = await ShiftService.listShifts(userRoleName, userRoleId, userId);
      return sendSuccess(res, shifts, 'Shift list retrieved');
    } catch (err) {
      next(err);
    }
  }

  // Additive real-time channel alongside GET / above (left completely untouched, still the
  // source of truth/fallback). Same Redis Pub/Sub -> SSE pattern as the dashboard stream.
  static async streamShifts(req: Request, res: Response, next: NextFunction) {
    try {
      const userRoleId = req.user?.roleId;
      const userRoleName = req.user?.roleName;
      const userId = req.user?.userId;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendSnapshot = async () => {
        try {
          const shifts = await ShiftService.listShifts(userRoleName, userRoleId, userId);
          res.write(`event: shifts\ndata: ${JSON.stringify(shifts)}\n\n`);
        } catch (err) {
          console.warn('[Shifts SSE] Failed to send snapshot:', err);
        }
      };

      await sendSnapshot();

      const onMessage = (channel: string) => {
        if (channel === SHIFTS_UPDATES_CHANNEL) {
          sendSnapshot();
        }
      };
      redisSubscriber.on('message', onMessage);
      redisSubscriber.subscribe(SHIFTS_UPDATES_CHANNEL).catch((err) => {
        console.warn('[Shifts SSE] Redis subscribe warning:', err.message);
      });

      req.on('close', () => {
        redisSubscriber.off('message', onMessage);
      });
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, openDate, isNextDay, roleConfigs } = req.body;
      const created = await ShiftService.createShift(name, openDate, isNextDay, roleConfigs, req.user?.username || 'A100');
      return sendSuccess(res, created, 'Shift created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  // Edit Shift popup's Time tab: the live Action button's `ajax_shift_timings` (ShiftId)
  static async timings(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const timings = await ShiftService.getShiftTimings(id);
      return sendSuccess(res, timings, 'Shift Timing list!');
    } catch (err) {
      next(err);
    }
  }

  static async toggleActive(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updated = await ShiftService.toggleActive(id);
      return sendSuccess(res, updated, 'Shift active status updated');
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const userIdentifier = req.user?.username || 'A100';
      const updated = await ShiftService.updateShift(id, req.body, userIdentifier);
      return sendSuccess(res, updated, 'Shift updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const userIdentifier = req.user?.username || 'A100';
      const shiftIds = Array.isArray(req.body?.shiftIds) ? req.body.shiftIds : [];
      const result = await ShiftService.reorderShifts(shiftIds, userIdentifier);
      return sendSuccess(res, result, 'Shift order updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = await ShiftService.deleteShift(id, req.user?.userId);
      return sendSuccess(res, result, 'Shift deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  static async listOperators(req: Request, res: Response, next: NextFunction) {
    try {
      const operators = await ShiftService.listOperators();
      return sendSuccess(res, operators, 'Operators retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async getOperatorPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = parseInt(req.params.userId as string, 10);
      const perms = await ShiftService.getOperatorPermissions(userId);
      return sendSuccess(res, perms, 'Permissions retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async saveOperatorPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = parseInt(req.params.userId as string, 10);
      const { permissions } = req.body;
      const result = await ShiftService.saveOperatorPermissions(userId, permissions || []);
      return sendSuccess(res, result, 'Permissions saved successfully');
    } catch (err) {
      next(err);
    }
  }
}

