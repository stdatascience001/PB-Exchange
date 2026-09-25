import { Request, Response, NextFunction } from 'express';
import { DuplicateService } from './duplicate.service.js';
import { sendSuccess } from '../../common/response.js';

export class DuplicateController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const list = await DuplicateService.listReviews();
      return sendSuccess(res, list, 'Duplicate reviews retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { status } = req.body;
      const updated = await DuplicateService.resolveReview(id, status, req.user!);
      return sendSuccess(res, updated, 'Review updated');
    } catch (err) {
      next(err);
    }
  }
}
