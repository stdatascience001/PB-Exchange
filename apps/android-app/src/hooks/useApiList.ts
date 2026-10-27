import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, errorMessage } from '../api/client';

// Loads a list endpoint with loading / pull-to-refresh / error state. `path` null = don't load.
export function useApiList<T>(path: string | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    if (!path) return;
    const my = ++seq.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    try {
      const res = await apiRequest<T[]>(path);
      if (my !== seq.current) return; // a newer request replaced this one
      setData(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (err) {
      if (my === seq.current) setError(errorMessage(err, 'Failed to load'));
    } finally {
      if (my === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, refreshing, error, reload: load, refresh: () => load('refresh'), setData };
}
