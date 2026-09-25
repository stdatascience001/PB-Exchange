import { Router } from 'express';
import { AuditController } from './audit.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN', 'AUDITOR', 'MANAGER'));

router.get('/', AuditController.list);
router.post('/verify/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'AUDITOR'), AuditController.verify);

export const auditRoutes = router;
