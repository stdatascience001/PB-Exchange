import { create } from 'zustand';
import { apiRequest, setSessionEndHandler, setTokenGetter } from '../api/client';
import type { LoginResult, UserSession } from '../api/types';
import { storage } from '../utils/storage';

// Signed-in session, kept in the device's secure storage (Keychain / Keystore; localStorage on the
// web build) so the app opens signed in until logout, an expired token or a newer login of the
// same account.
const TOKEN_KEY = 'pb_token';
const USER_KEY = 'pb_user';

interface AuthState {
  ready: boolean; // secure storage has been read
  token: string | null;
  user: UserSession | null;
  // why the last session ended (shown once on the login screen)
  endedReason: string | null;
  hydrate: () => Promise<void>;
  login: (input: { username: string; password: string; captchaId: string; captchaAnswer: string }) => Promise<void>;
  logout: (reason?: string | null) => Promise<void>;
  clearEndedReason: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  token: null,
  user: null,
  endedReason: null,

  hydrate: async () => {
    try {
      const [token, userJson] = await Promise.all([
        storage.get(TOKEN_KEY),
        storage.get(USER_KEY),
      ]);
      const user = userJson ? (JSON.parse(userJson) as UserSession) : null;
      set({ token: token && user ? token : null, user: token && user ? user : null, ready: true });
    } catch {
      set({ token: null, user: null, ready: true });
    }
  },

  login: async ({ username, password, captchaId, captchaAnswer }) => {
    const res = await apiRequest<LoginResult>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { username: username.trim(), password, captchaId, captchaAnswer: captchaAnswer.trim() },
    });
    const data = res.data;
    if (!data?.token || !data.user) throw new Error(res.message || 'Login failed');
    await storage.set(TOKEN_KEY, data.token);
    await storage.set(USER_KEY, JSON.stringify(data.user));
    set({ token: data.token, user: data.user, endedReason: null });
  },

  logout: async (reason = null) => {
    if (!get().token && !reason) return;
    await Promise.all([
      storage.remove(TOKEN_KEY).catch(() => undefined),
      storage.remove(USER_KEY).catch(() => undefined),
    ]);
    set({ token: null, user: null, endedReason: reason });
  },

  clearEndedReason: () => set({ endedReason: null }),
}));

// Wire the API client to this store: token for every call, sign-out when the API ends the session
setTokenGetter(() => useAuth.getState().token);
setSessionEndHandler(({ code, message }) => {
  if (!useAuth.getState().token) return;
  const reason = code === 'SESSION_REPLACED' || code === 'IP_BLOCKED' || code === 'IP_REDIRECT'
    ? message
    : 'Your session has expired. Please log in again.';
  void useAuth.getState().logout(reason);
});

export const isSuperUser = (role?: string | null) => {
  const r = String(role || '').toUpperCase().replace(/_/g, ' ');
  return r === 'SUPER ADMIN' || r === 'DEVELOPER';
};
