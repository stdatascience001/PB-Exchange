import { Request, Response, NextFunction } from 'express';
import { LedgerService } from './ledger.service.js';
import { sendSuccess } from '../../common/response.js';

export class LedgerController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as string | undefined;
      const group = req.query.group as string | undefined;
      const list = await LedgerService.listLedgers(status, group);
      return sendSuccess(res, list, 'Ledger list retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const ledger = await LedgerService.getLedgerById(id);
      return sendSuccess(res, ledger, 'Ledger detail retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = (req.query.q as string) || '';
      const list = await LedgerService.searchParties(q);
      return sendSuccess(res, list, 'Parties searched');
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const created = await LedgerService.createLedger({
        ...req.body,
        updatedBy: req.user?.username || 'A100',
      });
      return sendSuccess(res, created, 'Ledger created', 201);
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const updated = await LedgerService.updateLedger(id, {
        ...req.body,
        updatedBy: req.user?.username || 'A100',
      });
      return sendSuccess(res, updated, 'Ledger updated');
    } catch (err) {
      next(err);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const deleted = await LedgerService.softDelete(id);
      return sendSuccess(res, deleted, 'Ledger soft-deleted');
    } catch (err) {
      next(err);
    }
  }

  static async restore(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const restored = await LedgerService.restoreLedger(id);
      return sendSuccess(res, restored, 'Ledger restored');
    } catch (err) {
      next(err);
    }
  }

  static async listThirdPartyLinks(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const linkType = req.query.linkType as string | undefined;
      const list = await LedgerService.listThirdPartyLinks(id, linkType);
      return sendSuccess(res, list, 'Links retrieved');
    } catch (err) {
      next(err);
    }
  }

  static async addThirdPartyLink(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const created = await LedgerService.addThirdPartyLink(id, req.body);
      return sendSuccess(res, created, 'Link added', 201);
    } catch (err) {
      next(err);
    }
  }

  static async deleteThirdPartyLink(req: Request, res: Response, next: NextFunction) {
    try {
      const linkId = parseInt(req.params.linkId as string, 10);
      const deleted = await LedgerService.deleteThirdPartyLink(linkId);
      return sendSuccess(res, deleted, 'Link removed');
    } catch (err) {
      next(err);
    }
  }

  static async getLinkedStats(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const stats = await LedgerService.getLinkedStats(id);
      return sendSuccess(res, stats, 'Linked stats retrieved');
    } catch (err) {
      next(err);
    }
  }
}
