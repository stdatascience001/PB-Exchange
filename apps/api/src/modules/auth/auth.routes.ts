import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { loginSchema } from '@pb/validation';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.get('/captcha', AuthController.getCaptcha);
router.post('/login', validate(loginSchema), AuthController.login);
router.get('/me', authenticate, AuthController.me);
router.post('/change-password', authenticate, AuthController.changePassword);

export const authRoutes = router;
