import { Request, Response, NextFunction } from 'express';
import { PayrollService } from './payroll.service.js';
import { sendSuccess } from '../../common/response.js';

export class PayrollController {
  static async staffAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const result = await PayrollService.getStaffAttendanceReport({ fromDate, toDate });
      return sendSuccess(res, result, 'Staff attendance report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async getAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const month = req.query.month as string;
      const result = await PayrollService.getPayrollAttendance({ month });
      return sendSuccess(res, result, 'Payroll attendance retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async createAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { month } = req.body as { month: string };
      const updatedBy = req.user!.username || 'A100';
      const result = await PayrollService.createAttendance({ month }, updatedBy);
      return sendSuccess(res, result, 'Attendance created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async updateAttendanceRow(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updatedBy = req.user!.username || 'A100';
      const updated = await PayrollService.updateAttendanceRow(id, req.body, updatedBy);
      return sendSuccess(res, updated, 'Attendance updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async createSalary(req: Request, res: Response, next: NextFunction) {
    try {
      const { month, staffIds } = req.body as { month: string; staffIds?: number[] };
      const updatedBy = req.user!.username || 'A100';
      const result = await PayrollService.createSalary({ month, staffIds }, updatedBy);
      return sendSuccess(res, result, 'Salary created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async salaryRegister(req: Request, res: Response, next: NextFunction) {
    try {
      const fromMonth = req.query.fromMonth as string;
      const toMonth = req.query.toMonth as string;
      const search = req.query.search as string | undefined;
      const result = await PayrollService.getSalaryRegister({ fromMonth, toMonth, search });
      return sendSuccess(res, result, 'Salary register retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async processSalaryPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body as { ids: number[] };
      const updatedBy = req.user!.username || 'A100';
      const result = await PayrollService.processSalaryPayment(ids, updatedBy);
      return sendSuccess(res, result, 'Salary payment processed successfully');
    } catch (err) {
      next(err);
    }
  }

  static async listLeaves(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const search = req.query.search as string | undefined;
      const result = await PayrollService.listLeaves({ fromDate, toDate, search });
      return sendSuccess(res, result, 'Leaves retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async createLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const updatedBy = req.user!.username || 'A100';
      const created = await PayrollService.createLeave(req.body, updatedBy);
      return sendSuccess(res, created, 'Leave created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async updateLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updatedBy = req.user!.username || 'A100';
      const updated = await PayrollService.updateLeave(id, req.body, updatedBy);
      return sendSuccess(res, updated, 'Leave updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async deleteLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const deleted = await PayrollService.deleteLeave(id);
      return sendSuccess(res, deleted, 'Leave deleted successfully');
    } catch (err) {
      next(err);
    }
  }
}
