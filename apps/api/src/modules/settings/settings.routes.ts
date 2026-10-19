import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRoles } from '../../middleware/auth.middleware.js';
import { sendSuccess } from '../../common/response.js';
import { SettingsService } from './settings.service.js';

const router = Router();

router.use(authenticate);

// Which pages show the declared result highlighted — read by every page (any signed-in user)
router.get('/declare-highlight', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pages = await SettingsService.getDeclareHighlight();
    return sendSuccess(res, { pages }, 'Declare highlight settings retrieved');
  } catch (err) {
    next(err);
  }
});

// Saved from the Super Admin's profile menu
router.put('/declare-highlight', requireRoles('DEVELOPER', 'SUPER ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pages = await SettingsService.setDeclareHighlight(req.body?.pages || {}, req.user?.username || 'SYSTEM');
    return sendSuccess(res, { pages }, 'Declare highlight settings saved');
  } catch (err) {
    next(err);
  }
});

export const settingsRoutes = router;
