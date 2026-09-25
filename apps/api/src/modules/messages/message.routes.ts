import { Router } from 'express';
import { MessageController } from './message.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/roles', MessageController.listRoles);
router.get('/mine', MessageController.mine);
router.get('/', MessageController.list);
router.patch('/:roleId', MessageController.update);

export const messageRoutes = router;
