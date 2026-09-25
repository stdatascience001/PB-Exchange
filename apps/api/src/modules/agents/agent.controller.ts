import { Request, Response, NextFunction } from 'express';
import { AgentService } from './agent.service.js';
import { sendSuccess } from '../../common/response.js';

export class AgentController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AgentService.listAgents();
      return sendSuccess(res, data, 'Agent list retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;
      const created = await AgentService.createAgent({
        ...req.body,
        userId: user?.userId || req.body.userId,
        updatedBy: user?.username || req.body.updatedBy || 'A100',
      });
      return sendSuccess(res, created, 'Agent created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const user = (req as any).user;
      const updated = await AgentService.updateAgent(id, {
        ...req.body,
        updatedBy: user?.username || req.body.updatedBy || 'A100',
      });
      return sendSuccess(res, updated, 'Agent updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const deleted = await AgentService.deleteAgent(id);
      return sendSuccess(res, deleted, 'Agent deleted successfully');
    } catch (err) {
      next(err);
    }
  }
}


