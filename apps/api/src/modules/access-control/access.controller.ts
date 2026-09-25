import { Request, Response, NextFunction } from 'express';
import { AccessControlService } from './access.service.js';
import { sendSuccess } from '../../common/response.js';

export class AccessControlController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const list = await AccessControlService.listBlockedIps();
      return sendSuccess(res, list, 'Blocked IP list retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async block(req: Request, res: Response, next: NextFunction) {
    try {
      const { ipAddress, reason } = req.body;
      const blocked = await AccessControlService.blockIp(ipAddress, reason, req.user!.userId);
      return sendSuccess(res, blocked, 'IP address successfully blocked', 201);
    } catch (err) {
      next(err);
    }
  }

  static async unblock(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const unblocked = await AccessControlService.unblockIp(id);
      return sendSuccess(res, unblocked, 'IP address successfully unblocked');
    } catch (err) {
      next(err);
    }
  }
}
