import { Request, Response, NextFunction } from 'express';
import { TransactionService } from './transaction.service.js';
import { ownDataUserId } from '../../common/roles.js';
import { TransactionCalculator } from './transaction.calculator.js';
import { sendSuccess } from '../../common/response.js';

export class TransactionController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TransactionService.createTransaction(req.body, req.user!);
      return sendSuccess(res, result, 'Transaction slip created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async dailyReport(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.query.shiftId as string, 10);
      const date = req.query.date as string | undefined;
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const result = await TransactionService.getDailyReport({ shiftId, date, agentId });
      return sendSuccess(res, result, 'Daily report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async shiftProfitLossReport(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const result = await TransactionService.getShiftProfitLossReport({ fromDate, toDate });
      return sendSuccess(res, result, 'Shift Profit & Loss report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async allShiftPartyReport(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const groupName = req.query.groupName as string | undefined;
      const partyId = req.query.partyId ? parseInt(req.query.partyId as string, 10) : undefined;
      const search = req.query.search as string | undefined;
      const searchMode = (req.query.searchMode as 'START_WITH' | 'CONTAINS' | undefined) || 'START_WITH';
      const result = await TransactionService.getAllShiftPartyReport({ fromDate, toDate, agentId, groupName, partyId, search, searchMode });
      return sendSuccess(res, result, 'All shift report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async settlingReport(req: Request, res: Response, next: NextFunction) {
    try {
      const partyId = parseInt(req.query.partyId as string, 10);
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const result = await TransactionService.getSettlingReport({ partyId, fromDate, toDate });
      return sendSuccess(res, result, 'Settling report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async hvsProcess(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const result = await TransactionService.getHvsProcessData({ fromDate, toDate, agentId });
      return sendSuccess(res, result, 'HVS process data retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async productivityReport(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const result = await TransactionService.getProductivityReport({ fromDate, toDate, shiftId });
      return sendSuccess(res, result, 'Productivity report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async productivityShift(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const result = await TransactionService.getProductivityShiftReport({ fromDate, toDate });
      return sendSuccess(res, result, 'Productivity shift report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async productivityAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const result = await TransactionService.getProductivityAudit({ fromDate, toDate, shiftId });
      return sendSuccess(res, result, 'Productivity audit retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async collectionView(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.query.shiftId as string, 10);
      const date = req.query.date as string;
      const commission = req.query.commission === 'true';
      const hissa = req.query.hissa === 'true';
      const dibba = req.query.dibba === 'true';
      const akhMix = req.query.akhMix === 'true';
      const amtLess = req.query.amtLess ? parseFloat(req.query.amtLess as string) : undefined;
      const lessPercent = req.query.lessPercent ? parseFloat(req.query.lessPercent as string) : undefined;
      // Repeatable ?partyIds=1&partyIds=2, or a single comma-separated value — both forms
      // collapse to the same list. Absent means "every party", as before.
      const rawPartyIds = req.query.partyIds;
      const partyIds = (Array.isArray(rawPartyIds) ? rawPartyIds : rawPartyIds ? [rawPartyIds] : [])
        .flatMap(v => String(v).split(','))
        .map(v => parseInt(v.trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0);
      const result = await TransactionService.getCollectionView({ shiftId, date, commission, hissa, dibba, akhMix, amtLess, lessPercent, partyIds });
      return sendSuccess(res, result, 'Collection view retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async findKwada(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const date = req.query.date as string | undefined;
      const amount = parseFloat(req.query.amount as string);
      const count = req.query.count !== undefined && req.query.count !== '' ? parseInt(req.query.count as string, 10) : undefined;
      const result = await TransactionService.findKwadaTransactions({ shiftId, date, amount, count });
      return sendSuccess(res, result, 'Kwada transactions retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async absentParties(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.query.shiftId as string, 10);
      const date = req.query.date as string;
      const result = await TransactionService.getAbsentParties({ shiftId, date });
      return sendSuccess(res, result, 'Absent parties retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async beforeAfterDeclare(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = parseInt(req.query.shiftId as string, 10);
      const date = req.query.date as string;
      const mode = (req.query.mode as 'BEFORE' | 'AFTER' | undefined) || 'BEFORE';
      const result = await TransactionService.getTransBeforeAfterDeclare({ shiftId, date, mode });
      return sendSuccess(res, result, 'Trans before/after declare retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async plBeforeAfterDeclare(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const result = await TransactionService.getPlBeforeAfterDeclare({ fromDate, toDate, shiftId });
      return sendSuccess(res, result, 'P&L before/after declare retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async afterTiming(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const result = await TransactionService.getTransAfterTiming({ fromDate, toDate });
      return sendSuccess(res, result, 'Trans after timing retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const partyId = req.query.partyId ? parseInt(req.query.partyId as string, 10) : undefined;
      const status = req.query.status as string;
      const auditStatus = req.query.auditStatus as string;
      const search = req.query.search as string;
      const date = req.query.date as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

      // DATA ENTRY OPERATOR only ever sees the slips they entered themselves; every other
      // role gets undefined here and the unrestricted list, exactly as before.
      const ownerUserId = ownDataUserId(req.user);

      const list = await TransactionService.listTransactions({ shiftId, partyId, status, auditStatus, search, date, page, limit, ownerUserId });
      return sendSuccess(res, list, 'Transactions retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        return sendSuccess(res, null, 'Invalid transaction ID');
      }
      const tx = await TransactionService.getTransactionById(id);
      return sendSuccess(res, tx, 'Transaction details retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async getEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const entries = await TransactionService.getTransactionEntries(id);
      return sendSuccess(res, entries, 'Transaction entries retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { totalAmount } = req.body;
      const updated = await TransactionService.updateTransaction(id, totalAmount, req.user!);
      return sendSuccess(res, updated, 'Transaction updated');
    } catch (err) {
      next(err);
    }
  }

  static async updateEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { entries } = req.body;
      const updated = await TransactionService.updateTransactionEntries(id, entries || [], req.user!);
      return sendSuccess(res, updated, 'Transaction entries updated');
    } catch (err) {
      next(err);
    }
  }

  static async updateAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { auditStatus } = req.body;
      const updated = await TransactionService.updateAuditStatus(id, auditStatus, req.user!);
      return sendSuccess(res, updated, 'Transaction audit status updated');
    } catch (err) {
      next(err);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const result = await TransactionService.deleteTransaction(id, req.user!);
      return sendSuccess(res, result, 'Transaction deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  static async listEntriesAsc(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const minAmount = req.query.minAmount ? parseFloat(req.query.minAmount as string) : undefined;
      const list = await TransactionService.listEntriesAsc({ shiftId, fromDate, toDate, minAmount });
      return sendSuccess(res, list, 'Transaction entries retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async partyCollectionTotals(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const list = await TransactionService.getPartyCollectionTotals({ shiftId, fromDate, toDate });
      return sendSuccess(res, list, 'Party collection totals retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async listDuplicates(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const date = req.query.date as string;
      const duplicates = await TransactionService.listDuplicates({ shiftId, date });
      return sendSuccess(res, duplicates, 'Duplicates retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async copyNextShift(req: Request, res: Response, next: NextFunction) {
    try {
      const transactionId = parseInt(req.params.id as string, 10);
      const { targetShiftId } = req.body;
      const copied = await TransactionService.copyToNextShift(transactionId, targetShiftId, req.user);
      return sendSuccess(res, copied, 'Transaction copied to next shift', 201);
    } catch (err) {
      next(err);
    }
  }

  static generateCross(req: Request, res: Response, next: NextFunction) {
    try {
      const { digits, withJoda, amount } = req.body;
      const items = TransactionCalculator.generateCross(digits, withJoda, amount);
      return sendSuccess(res, items, 'Cross generated');
    } catch (err) {
      next(err);
    }
  }

  static generateFromTo(req: Request, res: Response, next: NextFunction) {
    try {
      const { fromNumber, toNumber, withPalti, amount } = req.body;
      const items = TransactionCalculator.generateFromTo(fromNumber, toNumber, withPalti, amount);
      return sendSuccess(res, items, 'From-To generated');
    } catch (err) {
      next(err);
    }
  }

  static generateRandom(req: Request, res: Response, next: NextFunction) {
    try {
      const { count, amount } = req.body;
      const items = TransactionCalculator.generateRandom(count, amount);
      return sendSuccess(res, items, 'Random generated');
    } catch (err) {
      next(err);
    }
  }
}
