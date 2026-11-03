import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { loginSchema } from '@pb/validation';
import { authenticate } from '../../middleware/auth.middleware.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';

const router = Router();

// Per-IP limits (a busy office shares one IP, so they are well above normal use)
const captchaLimit = rateLimit('captcha', 60, 60 * 1000);
const loginLimit = rateLimit('login', 30, 60 * 1000);

router.get('/captcha', captchaLimit, AuthController.getCaptcha);
router.get('/access-check', AuthController.accessCheck);
router.post('/login', loginLimit, validate(loginSchema), AuthController.login);
router.get('/me', authenticate, AuthController.me);
router.post('/change-password', authenticate, AuthController.changePassword);

export const authRoutes = router;
