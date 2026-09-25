import { Router } from 'express';
import { AgentController } from './agent.controller.js';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';

export const agentRoutes = Router();

agentRoutes.use(authenticate);

agentRoutes.get('/', AgentController.list);
agentRoutes.post('/', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), AgentController.create);
agentRoutes.put('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), AgentController.update);
agentRoutes.delete('/:id', requireRoles('DEVELOPER', 'SUPER ADMIN', 'ADMIN'), AgentController.delete);

