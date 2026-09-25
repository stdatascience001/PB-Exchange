import { Router } from 'express';
import { StaffController } from './staff.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';

export const staffRoutes = Router();

staffRoutes.use(authenticate);

staffRoutes.get('/', StaffController.list);
staffRoutes.post('/', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.create);
staffRoutes.put('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.update);
staffRoutes.patch('/:id/active', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.toggleActive);
staffRoutes.delete('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.delete);
staffRoutes.patch('/:id/live-status', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.setLiveStatus);
staffRoutes.post('/heartbeat', StaffController.heartbeat);
staffRoutes.patch('/:id/salary', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.updateSalary);

staffRoutes.get('/assets', StaffController.listAssets);
staffRoutes.post('/assets', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.createAsset);
staffRoutes.delete('/assets/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), StaffController.deleteAsset);

