import { Router } from 'express';
import { DeclarationController } from './declaration.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { declareShiftSchema } from '@pb/validation';

const router = Router();

router.use(authenticate);

router.get('/summary', DeclarationController.summary);
router.get('/:shiftId/settlement', DeclarationController.settlement);

router.post(
  '/:shiftId',
  requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'),
  validate(declareShiftSchema),
  DeclarationController.declare
);

router.post(
  '/:shiftId/reverse',
  requireRoles('DEVELOPER', 'SUPER ADMIN'),
  DeclarationController.reverse
);

router.post(
  '/:shiftId/verify',
  requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'),
  DeclarationController.verify
);

export const declarationRoutes = router;
