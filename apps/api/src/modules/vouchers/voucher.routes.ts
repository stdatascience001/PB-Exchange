import { Router } from 'express';
import { VoucherController } from './voucher.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Static routes must come before the dynamic "/:id" routes below.
router.get('/', VoucherController.list);
router.get('/manual', VoucherController.listManual);
router.get('/duplicates', VoucherController.duplicates);
router.get('/ledger-balances', VoucherController.ledgerBalances);
router.get('/limit-balance', VoucherController.limitBalanceReport);
router.get('/cash-agent-ledgers', VoucherController.cashAgentLedgers);
router.get('/settlement-rows', VoucherController.settlementRows);
router.get('/agent-group-balances', VoucherController.agentGroupBalances);
router.post('/', VoucherController.create);
router.post('/settlement', VoucherController.createSettlement);
router.get('/kist-schedule', VoucherController.kistSchedule);
router.get('/kist-due', VoucherController.kistDue);
router.post('/kist-plans', VoucherController.createKistPlan);
router.post('/kist-auto', VoucherController.autoKist);

router.get('/:id/entries', VoucherController.getEntries);
router.patch('/:id/audit', VoucherController.updateAudit);
router.patch('/:id', VoucherController.update);
router.delete('/:id', VoucherController.remove);

export const voucherRoutes = router;
