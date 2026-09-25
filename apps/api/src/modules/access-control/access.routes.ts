import { Router } from 'express';
import { AccessControlController } from './access.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { blockIpSchema } from '@pb/validation';

const router = Router();

router.use(authenticate);
router.use(requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'));

router.get('/', AccessControlController.list);
router.post('/', validate(blockIpSchema), AccessControlController.block);
router.delete('/:id', AccessControlController.unblock);

export const accessRoutes = router;
