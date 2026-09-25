import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error.middleware.js';
import { checkIpBlocked } from './middleware/ip-block.middleware.js';

// Route imports
import { authRoutes } from './modules/auth/auth.routes.js';
import { accessRoutes } from './modules/access-control/access.routes.js';
import { shiftRoutes } from './modules/shifts/shift.routes.js';
import { ledgerRoutes } from './modules/ledgers/ledger.routes.js';
import { transactionRoutes } from './modules/transactions/transaction.routes.js';
import { declarationRoutes } from './modules/declarations/declaration.routes.js';
import { jantriRoutes } from './modules/jantri/jantri.routes.js';
import { duplicateRoutes } from './modules/duplicate/duplicate.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { staffRoutes } from './modules/staff/staff.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { agentRoutes } from './modules/agents/agent.routes.js';
import { voucherRoutes } from './modules/vouchers/voucher.routes.js';
import { messageRoutes } from './modules/messages/message.routes.js';
import { payrollRoutes } from './modules/payroll/payroll.routes.js';

export function createApp() {
  const app = express();

  // Trust proxy for real client IP extraction
  app.set('trust proxy', true);

  // Security & logging middleware
  app.use(helmet());
  app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }));
  app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));
  app.use(express.json({ limit: '2mb' }));

  // Global IP Blacklist Gate
  app.use(checkIpBlocked);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API v1 Routes
  const v1 = express.Router();
  v1.use('/auth', authRoutes);
  v1.use('/access', accessRoutes);
  v1.use('/shifts', shiftRoutes);
  v1.use('/ledgers', ledgerRoutes);
  v1.use('/transactions', transactionRoutes);
  v1.use('/declarations', declarationRoutes);
  v1.use('/jantri', jantriRoutes);
  v1.use('/duplicates', duplicateRoutes);
  v1.use('/audit', auditRoutes);
  v1.use('/staff', staffRoutes);
  v1.use('/dashboard', dashboardRoutes);
  v1.use('/agents', agentRoutes);
  v1.use('/vouchers', voucherRoutes);
  v1.use('/messages', messageRoutes);
  v1.use('/payroll', payrollRoutes);

  app.use(env.API_PREFIX, v1);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
