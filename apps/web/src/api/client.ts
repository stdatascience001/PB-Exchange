// In local dev, the Vite proxy (vite.config.ts) forwards the relative "/api/v1" path to the
// backend, so no env var is needed. In production the frontend and backend are deployed to
// separate domains (e.g. two Render services), so VITE_API_URL must be set at build time to
// the backend's full URL — otherwise "/api/v1" would resolve against the frontend's own
// static-site domain, which has no API, and every request would fail.
export const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data: T; message?: string; error?: any }> {
  const token = localStorage.getItem('pb_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const json = await res.json();
    if (!res.ok) {
      const error: any = new Error(json.error?.message || json.message || 'API request failed');
      error.code = json.error?.code;
      // Blocked IP (3 wrong logins / admin block): the site is sent to Google (below).
      // IP an inactive staff member signed in from: the whole site goes to Google (live).
      if (error.code === 'IP_REDIRECT' && typeof window !== 'undefined') {
        window.location.replace('https://www.google.com');
      }
      // This session was replaced by a newer login of the same account on the same IP:
      // the app signs this browser out.
      if (error.code === 'SESSION_REPLACED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pb-session-replaced', { detail: error.message }));
      }
      if (error.code === 'IP_BLOCKED' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pb-ip-blocked', { detail: error.message }));
        // A blocked IP (3 wrong logins / Access Block) doesn't get the site at all: like an
        // inactive staff member's IP it is sent to Google. The blocked screen above is only
        // what's left showing if the browser refuses to leave.
        window.location.replace('https://www.google.com');
      }
      throw error;
    }
    return json;
  } catch (err: any) {
    console.error(`[API Error] ${endpoint}:`, err);
    throw err;
  }
}
