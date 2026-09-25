import { Request, Response, NextFunction } from 'express';
import { StaffService } from './staff.service.js';
import { sendSuccess } from '../../common/response.js';

export class StaffController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const list = await StaffService.listStaff();
      return sendSuccess(res, list, 'Staff list retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const updatedBy = (req as any).user?.username || 'A100';
      const created = await StaffService.createStaff({
        ...req.body,
        updatedBy,
      });
      return sendSuccess(res, created, 'Staff member created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updatedBy = (req as any).user?.username || 'A100';
      const updated = await StaffService.updateStaff(id, {
        ...req.body,
        updatedBy,
      });
      return sendSuccess(res, updated, 'Staff member updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async toggleActive(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updatedBy = (req as any).user?.username || 'A100';
      const updated = await StaffService.toggleActive(id, updatedBy);
      return sendSuccess(res, updated, 'Staff active status updated');
    } catch (err) {
      next(err);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      await StaffService.deleteStaff(id);
      return sendSuccess(res, { id }, 'Staff member deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  static async setLiveStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { isWorkingLive } = req.body;
      const updated = await StaffService.updateWorkingStatus(id, Boolean(isWorkingLive));
      return sendSuccess(res, updated, 'Staff live status updated');
    } catch (err) {
      next(err);
    }
  }

  static async heartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const user = (req as any).user;
      if (user) {
        await StaffService.heartbeat(user.userId, user.username, user.roleName);
      }
      return sendSuccess(res, { status: 'ok' }, 'Heartbeat recorded');
    } catch (err) {
      next(err);
    }
  }

  static async listAssets(req: Request, res: Response, next: NextFunction) {
    try {
      const assets = await StaffService.listAssets();
      return sendSuccess(res, assets, 'Staff assets retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async createAsset(req: Request, res: Response, next: NextFunction) {
    try {
      const updatedBy = (req as any).user?.username || 'A100';
      const created = await StaffService.createAsset({
        ...req.body,
        updatedBy,
      });
      return sendSuccess(res, created, 'Staff asset assigned successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async deleteAsset(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const deleted = await StaffService.deleteAsset(id);
      return sendSuccess(res, deleted, 'Staff asset deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  static async updateSalary(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updatedBy = (req as any).user?.username || 'A100';
      if (req.body.earnings !== undefined || req.body.deductions !== undefined) {
        const updated = await StaffService.updateSalaryStructure(id, req.body, updatedBy);
        return sendSuccess(res, updated, 'Staff salary structure updated successfully');
      }
      const { monthlySalary } = req.body;
      const updated = await StaffService.updateSalary(id, parseFloat(monthlySalary || '0'), updatedBy);
      return sendSuccess(res, updated, 'Staff salary updated successfully');
    } catch (err) {
      next(err);
    }
  }
}


