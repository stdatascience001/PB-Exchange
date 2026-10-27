import { API_URL } from '../config';
import type { ApiEnvelope } from './types';

// Mirrors apps/web/src/api/client.ts: JSON in / out, Bearer token on every call, the API's
// { success, data, error: { code, message } } envelope, and the same special error codes.

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The signed-in token lives in the auth store (SecureStore-backed); the client only reads it
let tokenGetter: () => string | null = () => null;
export const setTokenGetter = (fn: () => string | null) => { tokenGetter = fn; };

// Called when the session is over: 401 (expired / invalid token) or SESSION_REPLACED (the same
// account logged in again on this IP), IP_BLOCKED / IP_REDIRECT (blocked device)
type SessionEndHandler = (reason: { code?: string; message: string }) => void;
let onSessionEnd: SessionEndHandler = () => undefined;
export const setSessionEndHandler = (fn: SessionEndHandler) => { onSessionEnd = fn; };

const SESSION_END_CODES = new Set(['SESSION_REPLACED', 'IP_BLOCKED', 'IP_REDIRECT']);

export async function apiRequest<T>(
  endpoint: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; auth?: boolean } = {},
): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = tokenGetter();
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Unable to reach the server. Check your internet connection.', 0, 'NETWORK');
  }

  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || (json && json.success === false)) {
    const message = json?.error?.message || json?.message || `Request failed (${res.status})`;
    const code = json?.error?.code;
    const error = new ApiError(message, res.status, code);
    // A signed-in call refused because the session is gone: sign out (not the login call itself)
    if (token && options.auth !== false && (res.status === 401 || (code && SESSION_END_CODES.has(code)))) {
      onSessionEnd({ code, message });
    }
    throw error;
  }
  return json || { success: true };
}

export const errorMessage = (err: unknown, fallback = 'Something went wrong'): string =>
  (err instanceof Error && err.message) ? err.message : fallback;
