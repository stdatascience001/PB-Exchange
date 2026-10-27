import { AppState, AppStateStatus } from 'react-native';
import EventSource from 'react-native-sse';
import { create } from 'zustand';
import { apiRequest } from '../api/client';
import type { DashboardMetrics } from '../api/types';
import { API_URL, DASHBOARD_POLL_MS } from '../config';
import { useAuth } from './auth';

// Live dashboard data (shift cards + Staff Working), shared by every screen that shows it.
// Source: the existing SSE feed GET /dashboard/stream?token=… (event "metrics", the same payload
// as GET /dashboard/metrics). While the stream is down, /dashboard/metrics is polled instead, so
// the screen keeps updating either way. Stops in the background, resumes in the foreground.

interface DashboardState {
  metrics: DashboardMetrics | null;
  loading: boolean;
  live: boolean; // stream connected
  error: string | null;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

export const useDashboard = create<DashboardState>((set) => ({
  metrics: null,
  loading: false,
  live: false,
  error: null,
  updatedAt: null,
  refresh: async () => {
    set({ loading: true });
    try {
      const res = await apiRequest<DashboardMetrics>('/dashboard/metrics');
      if (res.data) set({ metrics: res.data, error: null, updatedAt: Date.now() });
    } catch (err: any) {
      set({ error: err?.message || 'Failed to load dashboard' });
    } finally {
      set({ loading: false });
    }
  },
}));

let users = 0;
let es: EventSource<'metrics'> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

const stopStream = () => {
  es?.removeAllEventListeners();
  es?.close();
  es = null;
  useDashboard.setState({ live: false });
};

const startPolling = () => {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!useDashboard.getState().live) void useDashboard.getState().refresh();
  }, DASHBOARD_POLL_MS);
};

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const startStream = () => {
  const token = useAuth.getState().token;
  if (!token || es) return;
  es = new EventSource<'metrics'>(`${API_URL}/dashboard/stream?token=${encodeURIComponent(token)}`, {
    pollingInterval: 5000, // reconnect delay after a drop
  });
  es.addEventListener('open', () => useDashboard.setState({ live: true }));
  es.addEventListener('metrics', (event) => {
    if (!event.data) return;
    try {
      useDashboard.setState({ metrics: JSON.parse(event.data) as DashboardMetrics, error: null, updatedAt: Date.now(), live: true });
    } catch {
      // ignore a malformed frame; the next one replaces it
    }
  });
  es.addEventListener('error', () => useDashboard.setState({ live: false }));
};

const start = () => {
  void useDashboard.getState().refresh();
  startStream();
  startPolling();
};

const stop = () => {
  stopStream();
  stopPolling();
};

// Screens showing the dashboard call this on mount and the returned function on unmount
export const subscribeDashboard = (): (() => void) => {
  users += 1;
  if (users === 1) {
    start();
    appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') start();
      else stop();
    });
  }
  return () => {
    users -= 1;
    if (users <= 0) {
      users = 0;
      stop();
      appStateSub?.remove();
      appStateSub = null;
    }
  };
};

// Signed out: drop the stream and the cached data
useAuth.subscribe((s, prev) => {
  if (prev.token && !s.token) {
    stop();
    useDashboard.setState({ metrics: null, updatedAt: null });
  }
});
