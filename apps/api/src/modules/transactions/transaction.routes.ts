import { Router } from 'express';
import { TransactionController } from './transaction.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  createTransactionSchema,
  crossGenerateSchema,
  fromToGenerateSchema,
  randomGenerateSchema,
} from '@pb/validation';

const router = Router();

router.use(authenticate);

// Generator endpoints
router.post('/generate/cross', validate(crossGenerateSchema), TransactionController.generateCross);
router.post('/generate/from-to', validate(fromToGenerateSchema), TransactionController.generateFromTo);
router.post('/generate/random', validate(randomGenerateSchema), TransactionController.generateRandom);

// Core CRUD
router.get('/', TransactionController.list);
router.get('/duplicates', TransactionController.listDuplicates);
router.get('/kwada', TransactionController.findKwada);
router.get('/collection', TransactionController.collectionView);
router.get('/absent-parties', TransactionController.absentParties);
router.get('/entries/asc', TransactionController.listEntriesAsc);
router.get('/party-collection-totals', TransactionController.partyCollectionTotals);
router.get('/tpc-report', TransactionController.tpcReport);
router.get('/admin-cash', TransactionController.adminCash);
router.get('/trial-balance', TransactionController.trialBalance);
router.get('/outstanding', TransactionController.outstandingReport);
router.get('/vapsi-summary', TransactionController.vapsiSummary);
router.get('/hawa-patti-summary', TransactionController.hawaPattiSummary);
router.post('/hawa-patti-process', TransactionController.hawaPattiProcess);
router.get('/hawa-patti-report', TransactionController.hawaPattiReport);
router.get('/vapsi-report', TransactionController.vapsiReport);
router.get('/cash-agent-report', TransactionController.cashAgentReport);
router.get('/settlement-agent-rows', TransactionController.settlementAgentRows);
router.get('/outstanding-agent-group', TransactionController.outstandingAgentGroup);
router.post('/vapsi-process', TransactionController.vapsiProcess);
router.get('/daily-report', TransactionController.dailyReport);
router.get('/shift-profit-loss', TransactionController.shiftProfitLossReport);
router.get('/all-shift-report', TransactionController.allShiftPartyReport);
router.get('/settling-report', TransactionController.settlingReport);
router.get('/hvs-process', TransactionController.hvsProcess);
router.post('/hvs-process', TransactionController.hvsGoProcess);
router.get('/productivity-report', TransactionController.productivityReport);
router.get('/productivity-detail', TransactionController.productivityDetail);
router.get('/productivity-shift', TransactionController.productivityShift);
router.get('/productivity-audit', TransactionController.productivityAudit);
router.get('/productivity-audit/detail', TransactionController.productivityAuditDetail);
router.get('/before-after-declare', TransactionController.beforeAfterDeclare);
router.get('/pl-before-after-declare', TransactionController.plBeforeAfterDeclare);
router.get('/after-timing', TransactionController.afterTiming);
router.get('/:id/entries', TransactionController.getEntries);
router.get('/:id', TransactionController.getById);
router.post('/', validate(createTransactionSchema), TransactionController.create);
// Declare Transactions → Add (Super Admin): a slip into a shift's cycle of ?date=, declared or not
router.post('/declare', requireRoles('DEVELOPER', 'SUPER ADMIN'), validate(createTransactionSchema), TransactionController.createDeclared);
router.patch('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), TransactionController.update);
router.patch('/:id/entries', TransactionController.updateEntries);
router.patch('/:id/declare-entries', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), TransactionController.updateDeclaredEntries);
router.patch('/:id/audit', TransactionController.updateAudit);
router.delete('/:id', TransactionController.delete);
router.post('/:id/copy-next-shift', TransactionController.copyNextShift);

export const transactionRoutes = router;
