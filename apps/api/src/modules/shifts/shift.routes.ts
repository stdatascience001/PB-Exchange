import { Router } from 'express';
import { ShiftController } from './shift.controller.js';
import { authenticate, authenticateSSE, requireRoles } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createShiftSchema } from '@pb/validation';

const router = Router();

// Registered before the router.use(authenticate) below since EventSource can't set an
// Authorization header — this route needs authenticateSSE's ?token= support instead, same
// pattern as the dashboard stream. GET / below (with the regular authenticate) is untouched.
router.get('/stream', authenticateSSE, ShiftController.streamShifts);

router.use(authenticate);

router.get('/', ShiftController.list);
router.post('/', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), validate(createShiftSchema), ShiftController.create);
router.get('/permissions/operators', ShiftController.listOperators);
router.get('/permissions/:userId', ShiftController.getOperatorPermissions);
router.post('/permissions/:userId', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), ShiftController.saveOperatorPermissions);
// Registered before '/:id' so "reorder" isn't read as a shift id.
router.patch('/reorder', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), ShiftController.reorder);
router.patch('/:id/toggle-active', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), ShiftController.toggleActive);
router.patch('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), ShiftController.update);
router.put('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), ShiftController.update);
// Hard delete — SUPER ADMIN only.
router.delete('/:id', requireRoles('SUPER ADMIN'), ShiftController.remove);

export const shiftRoutes = router;

