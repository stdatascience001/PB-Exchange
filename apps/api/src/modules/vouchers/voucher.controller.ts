import { Request, Response, NextFunction } from 'express';
import { VoucherService } from './voucher.service.js';
import { sendSuccess } from '../../common/response.js';
import { KistService } from './kist.service.js';

export class VoucherController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.query.shiftId ? parseInt(req.query.shiftId as string, 10) : undefined;
      const voucherType = req.query.voucherType as string | undefined;
      const auditStatus = req.query.auditStatus as string | undefined;
      const list = await VoucherService.listVouchers({ shiftId, voucherType, auditStatus });
      return sendSuccess(res, list, 'Vouchers retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async listManual(req: Request, res: Response, next: NextFunction) {
    try {
      const voucherType = req.query.voucherType as string | undefined;
      const auditStatus = req.query.auditStatus as string | undefined;
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const search = req.query.search as string | undefined;
      const manualOnly = req.query.manualOnly === '1' || req.query.manualOnly === 'true';
      const list = await VoucherService.listManualVouchers({ voucherType, manualOnly, auditStatus, fromDate, toDate, search });
      return sendSuccess(res, list, 'Vouchers retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async getEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const entries = await VoucherService.getVoucherEntries(id);
      return sendSuccess(res, entries, 'Voucher entries retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const created = await VoucherService.createManualVoucher(req.body, req.user!);
      return sendSuccess(res, created, 'Voucher created successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  // Kist Voucher page: "Create Kist Voucher" popup → plan + PENDING installment schedule
  static async createKistPlan(req: Request, res: Response, next: NextFunction) {
    try {
      const created = await KistService.createPlan(req.body, req.user!);
      return sendSuccess(res, created, 'Kist Voucher has been created successfully!', 201);
    } catch (err) {
      next(err);
    }
  }

  // Kist Voucher page's right-hand Party panel
  static async kistSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const partyLedgerId = parseInt(req.query.partyLedgerId as string, 10);
      const list = Number.isFinite(partyLedgerId) ? await KistService.listSchedule(partyLedgerId) : [];
      return sendSuccess(res, list, 'Kist schedule retrieved');
    } catch (err) {
      next(err);
    }
  }

  // Auto Kist Voucher popup's Search: PENDING kists due on ?date=YYYY-MM-DD
  static async kistDue(req: Request, res: Response, next: NextFunction) {
    try {
      const list = await KistService.listDue(String(req.query.date || ''));
      return sendSuccess(res, list, 'Due kists retrieved');
    } catch (err) {
      next(err);
    }
  }

  // Process Voucher: post the ticked kists (body.scheduleIds), or every due one if none sent
  static async autoKist(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await KistService.runAutoKist(req.user!, req.body?.scheduleIds);
      return sendSuccess(res, result, 'Auto Kist completed');
    } catch (err) {
      next(err);
    }
  }

  static async createSettlement(req: Request, res: Response, next: NextFunction) {
    try {
      const created = await VoucherService.createSettlementEntry(req.body, req.user!);
      return sendSuccess(res, created, 'Settlement entry saved successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updated = await VoucherService.updateManualVoucher(id, req.body, req.user!);
      return sendSuccess(res, updated, 'Voucher updated successfully');
    } catch (err) {
      next(err);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const deleted = await VoucherService.deleteVoucher(id);
      return sendSuccess(res, deleted, 'Voucher deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  static async updateAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const { auditStatus } = req.body;
      const updated = await VoucherService.updateVoucherAuditStatus(id, auditStatus, req.user!);
      return sendSuccess(res, updated, 'Voucher audit status updated');
    } catch (err) {
      next(err);
    }
  }

  static async duplicates(req: Request, res: Response, next: NextFunction) {
    try {
      const voucherType = req.query.voucherType as string;
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const list = await VoucherService.getVoucherDuplicateCounts({ voucherType, fromDate, toDate });
      return sendSuccess(res, list, 'Duplicate vouchers retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async limitBalanceReport(req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await VoucherService.getLimitBalanceReport();
      return sendSuccess(res, rows, 'Limit & balance report retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async ledgerBalances(req: Request, res: Response, next: NextFunction) {
    try {
      const voucherType = req.query.voucherType as string | undefined;
      const voucherTypes = req.query.voucherTypes
        ? (req.query.voucherTypes as string).split(',').map(t => t.trim()).filter(Boolean)
        : undefined;
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const list = await VoucherService.getLedgerBalances({ voucherType, voucherTypes, fromDate, toDate, agentId });
      return sendSuccess(res, list, 'Ledger balances retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async cashAgentLedgers(req: Request, res: Response, next: NextFunction) {
    try {
      const list = await VoucherService.listCashAgentLedgers();
      return sendSuccess(res, list, 'Cash agent ledgers retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async settlementRows(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string;
      const toDate = req.query.toDate as string;
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const search = req.query.search as string | undefined;
      const list = await VoucherService.getPartySettlementRows({ fromDate, toDate, agentId, search });
      return sendSuccess(res, list, 'Settlement rows retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async agentGroupBalances(req: Request, res: Response, next: NextFunction) {
    try {
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const list = await VoucherService.getAgentGroupBalances({ fromDate, toDate, agentId });
      return sendSuccess(res, list, 'Agent group balances retrieved');
    } catch (err) {
      next(err);
    }
  }
}
