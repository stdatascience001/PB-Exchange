import { Request, Response, NextFunction } from 'express';
import { JantriService } from './jantri.service.js';
import { sendSuccess } from '../../common/response.js';

export class JantriController {
  static async getShiftJantri(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const date = req.query.date as string | undefined;
      const data = await JantriService.getJantriView(shiftId, date);
      return sendSuccess(res, data, 'Jantri view data loaded');
    } catch (err) {
      next(err);
    }
  }

  static async getDistributorJantri(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const distributorId = parseInt(req.params.distributorId as string, 10);
      const date = req.query.date as string | undefined;
      const data = await JantriService.getDistributorJantriView(shiftId, distributorId, date);
      return sendSuccess(res, data, 'Distributor Jantri view data loaded');
    } catch (err) {
      next(err);
    }
  }

  static async getNetJantri(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const date = req.query.date as string | undefined;
      // Jantri page: closed until the shift's Main Jantri Time. Company Calculation reads the
      // same net figures with ?gate=none and stays open at any time, as it always was.
      if (req.query.gate !== 'none') {
        await JantriService.assertJantriOpen(shiftId, date, req.user?.roleName);
      }
      const data = await JantriService.getNetJantriView(shiftId, date);
      return sendSuccess(res, data, 'Net Jantri view data loaded');
    } catch (err) {
      next(err);
    }
  }

  static async getPrediction(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const focusNumber = req.query.number as string | undefined;
      const date = req.query.date as string | undefined;
      const data = await JantriService.getPredictionData(shiftId, focusNumber, date);
      return sendSuccess(res, data, 'Prediction data loaded');
    } catch (err) {
      next(err);
    }
  }
}
