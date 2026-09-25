import { Request, Response, NextFunction } from 'express';
import { DeclarationService } from './declaration.service.js';
import { sendSuccess } from '../../common/response.js';

export class DeclarationController {
  static async declare(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const { winningNumber } = req.body;
      const result = await DeclarationService.declareResult(shiftId, winningNumber, req.user!);
      return sendSuccess(res, result, 'Shift result declared successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async reverse(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const declarationId = req.body?.declarationId ? parseInt(req.body.declarationId, 10) : undefined;
      const result = await DeclarationService.reverseDeclaration(shiftId, req.user!, declarationId);
      return sendSuccess(res, result, 'Declaration reversed');
    } catch (err) {
      next(err);
    }
  }

  static async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const result = await DeclarationService.verifyShift(shiftId, req.user!);
      return sendSuccess(res, result, 'Shift verified successfully');
    } catch (err) {
      next(err);
    }
  }

  static async summary(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const includeReversed = req.query.includeReversed === 'true';
      const list = await DeclarationService.listDeclarationsSummary({ fromDate, toDate, shiftId, includeReversed });
      return sendSuccess(res, list, 'Declaration summary retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async settlement(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.params.shiftId as string, 10);
      const result = await DeclarationService.getSettlementDetail(shiftId);
      return sendSuccess(res, result, 'Settlement detail retrieved');
    } catch (err) {
      next(err);
    }
  }
}
