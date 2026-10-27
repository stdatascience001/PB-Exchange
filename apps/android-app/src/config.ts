import { Platform } from 'react-native';

// Backend base URL — the same /api/v1 the web app calls (EXPO_PUBLIC_API_URL in .env).
// Web build: the dev server forwards /api to that API (metro.config.js), so the browser calls its
// own origin and the API's CORS setting doesn't block it.
const raw = process.env.EXPO_PUBLIC_API_URL || 'https://punjabking.supremetechnologiesindia.com/api/v1';

const apiPath = (() => {
  try { return new URL(raw).pathname.replace(/\/+$/, '') || '/api/v1'; } catch { return '/api/v1'; }
})();

export const API_URL = Platform.OS === 'web' ? apiPath : raw.replace(/\/+$/, '');

// Dashboard refresh when the live stream is not connected
export const DASHBOARD_POLL_MS = 10000;
