import { Router } from 'express';
import { DashboardController } from './dashboard.controller.js';
import { authenticate, authenticateSSE } from '../../middleware/auth.middleware.js';

export const dashboardRoutes = Router();

// Allow authenticated users to fetch live dashboard metrics
dashboardRoutes.get('/metrics', authenticate, DashboardController.getMetrics);
dashboardRoutes.get('/', authenticate, DashboardController.getMetrics);

// Additive real-time push channel (Server-Sent Events) — GET /metrics above is untouched and
// remains the source of truth/fallback. authenticateSSE (not authenticate) since EventSource
// can't set an Authorization header, so it also accepts ?token=.
dashboardRoutes.get('/stream', authenticateSSE, DashboardController.streamMetrics);
