import { Request, Response, NextFunction } from 'express';
import { AuditService } from './audit.service.js';
import { sendSuccess } from '../../common/response.js';

export class AuditController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const entityType = req.query.entityType as string;
      const entityId = req.query.entityId as string;
      const actorId = req.query.actorId ? parseInt(req.query.actorId as string, 10) : undefined;
      const logs = await AuditService.listLogs({ entityType, entityId, actorId });
      return sendSuccess(res, logs, 'Audit logs retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const verified = await AuditService.verifyTransaction(id, req.user!);
      return sendSuccess(res, verified, 'Transaction verified by auditor');
    } catch (err) {
      next(err);
    }
  }
}
