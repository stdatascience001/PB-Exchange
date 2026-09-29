import { Request, Response, NextFunction } from 'express';
import { extractClientIp } from '../../middleware/ip-block.middleware.js';
import { AuthService } from './auth.service.js';
import { sendSuccess } from '../../common/response.js';

export class AuthController {
  static getCaptcha(req: Request, res: Response, next: NextFunction) {
    try {
      const captcha = AuthService.generateCaptcha();
      return sendSuccess(res, captcha, 'Captcha generated');
    } catch (err) {
      next(err);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password, captchaId, captchaAnswer } = req.body;
      const result = await AuthService.login(username, password, captchaId, captchaAnswer, extractClientIp(req));
      return sendSuccess(res, result, 'Login successful');
    } catch (err) {
      next(err);
    }
  }

  // Public: reaching this at all means the IP gate let the request through; a blocked IP gets
  // the gate's 403 IP_BLOCKED instead. The web app calls it on start-up.
  static async accessCheck(req: Request, res: Response) {
    return sendSuccess(res, { ip: extractClientIp(req), blocked: false }, 'Access allowed');
  }

  static async me(req: Request, res: Response, next: NextFunction) {
    try {
      return sendSuccess(res, req.user, 'Current user profile');
    } catch (err) {
      next(err);
    }
  }

  static async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.userId;
      const { currentPassword, newPassword } = req.body;
      const result = await AuthService.changePassword(userId, currentPassword, newPassword);
      return sendSuccess(res, result, 'Password changed successfully');
    } catch (err) {
      next(err);
    }
  }
}
