import { Router } from 'express';
import { DuplicateController } from './duplicate.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN', 'AUDITOR'));

router.get('/', DuplicateController.list);
router.post('/:id/resolve', DuplicateController.resolve);

export const duplicateRoutes = router;
