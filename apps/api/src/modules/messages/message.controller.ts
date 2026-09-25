import { Request, Response, NextFunction } from 'express';
import { MessageService } from './message.service.js';
import { sendSuccess } from '../../common/response.js';

export class MessageController {
  static async listRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await MessageService.listRoles();
      return sendSuccess(res, data, 'Roles retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async mine(req: Request, res: Response, next: NextFunction) {
    try {
      const roleId = req.user!.roleId;
      const data = await MessageService.getMyMessage(roleId);
      return sendSuccess(res, data, 'My role message retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await MessageService.listRoleMessages();
      return sendSuccess(res, data, 'Role messages retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const roleId = parseInt(req.params.roleId as string, 10);
      const { field, value } = req.body as { field: 'message' | 'flashMessage'; value: string };
      const updatedBy = req.user?.username || 'A100';
      const updated = await MessageService.updateRoleMessage(roleId, field, value, updatedBy);
      return sendSuccess(res, updated, 'Message updated successfully');
    } catch (err) {
      next(err);
    }
  }
}
