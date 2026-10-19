import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

// The declared result's cells — "32" paints number 32, Andar A3 (tens) and Bahar B2 (units);
// "00" / "100" paints number 100, A0 and B0. Null (undeclared day) paints nothing.
export const declaredCellKeys = (declared?: string | null): Set<string> => {
  const keys = new Set<string>();
  const v = (declared || '').trim();
  if (!/^\d{1,3}$/.test(v)) return keys;
  const two = v === '100' ? '00' : v.padStart(2, '0').slice(-2);
  keys.add(two === '00' ? '100' : String(parseInt(two, 10)));
  keys.add(`A${two[0]}`);
  keys.add(`B${two[1]}`);
  return keys;
};

// ---- Declare Result highlight, per page (Super Admin → profile → Declare Highlight) ----------
// GET /settings/declare-highlight → { pages: { 'declare-jantri': true, … } }. Loaded once and
// shared; a Save broadcasts the new map so every open page follows at once. A page missing from
// the map (or before it loads) counts as ON — the behaviour every page had before this switch.
export type DeclareHighlightPage =
  | 'declare-transactions'
  | 'declare-trans-audit'
  | 'declare-prediction'
  | 'declare-jantri'
  | 'declare-collection'
  | 'company-calculation'
  | 'daily-report';

export const DECLARE_HIGHLIGHT_PAGE_LABELS: Array<{ menu: string; page: DeclareHighlightPage; label: string }> = [
  { menu: 'Transactions', page: 'declare-transactions', label: 'Declare Transactions' },
  { menu: 'Transactions', page: 'declare-trans-audit', label: 'Declare Trans-Audit' },
  { menu: 'Result', page: 'declare-prediction', label: 'Declare Prediction' },
  { menu: 'Result', page: 'declare-jantri', label: 'Declare Jantri' },
  { menu: 'Result', page: 'declare-collection', label: 'Declare Collection' },
  { menu: 'Result', page: 'company-calculation', label: 'Company Calculation' },
  { menu: 'Reports', page: 'daily-report', label: 'Daily Report' },
];

const HIGHLIGHT_EVENT = 'pb-declare-highlight-changed';
let highlightCache: Record<string, boolean> | null = null;
let highlightLoad: Promise<Record<string, boolean>> | null = null;

export const loadDeclareHighlight = (force = false): Promise<Record<string, boolean>> => {
  if (!force && highlightCache) return Promise.resolve(highlightCache);
  if (!force && highlightLoad) return highlightLoad;
  highlightLoad = apiRequest<{ pages: Record<string, boolean> }>('/settings/declare-highlight')
    .then(res => {
      highlightCache = res.data?.pages || {};
      return highlightCache;
    })
    .catch(() => {
      highlightLoad = null;
      return highlightCache || {};
    });
  return highlightLoad;
};

// After the Super Admin saves: keep the new map and tell every open page
export const publishDeclareHighlight = (pages: Record<string, boolean>) => {
  highlightCache = { ...pages };
  highlightLoad = Promise.resolve(highlightCache);
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail: highlightCache }));
};

// Is the declared result highlighted on this page? No page given → always (unchanged pages).
export const useDeclareHighlightEnabled = (page?: DeclareHighlightPage): boolean => {
  const [map, setMap] = useState<Record<string, boolean> | null>(highlightCache);
  useEffect(() => {
    if (!page) return;
    let alive = true;
    loadDeclareHighlight().then(m => { if (alive) setMap(m); });
    const onChange = (e: Event) => setMap({ ...((e as CustomEvent).detail || {}) });
    window.addEventListener(HIGHLIGHT_EVENT, onChange);
    return () => { alive = false; window.removeEventListener(HIGHLIGHT_EVENT, onChange); };
  }, [page]);
  if (!page) return true;
  return map?.[page] !== false;
};

// The shift's declared number for the day on screen (null while that day is undeclared),
// by the same rule the Daily Report uses (/transactions/collection?declaredOnly=true).
// page (optional): that page's Declare Highlight switch — OFF → null (nothing highlighted).
export const useDeclaredNumber = (shiftId: string | number | null | undefined, date: string | null | undefined, page?: DeclareHighlightPage): string | null => {
  const enabled = useDeclareHighlightEnabled(page);
  const [declared, setDeclared] = useState<string | null>(null);
  useEffect(() => {
    const id = shiftId ? String(shiftId) : '';
    if (!id || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setDeclared(null); return; }
    let alive = true;
    const params = new URLSearchParams({ shiftId: id, date, declaredOnly: 'true' });
    apiRequest<{ declaredNumber: string | null }>(`/transactions/collection?${params.toString()}`)
      .then(res => { if (alive) setDeclared(res.data?.declaredNumber ?? null); })
      .catch(() => { if (alive) setDeclared(null); });
    return () => { alive = false; };
  }, [shiftId, date]);
  return enabled ? declared : null;
};

// A grid cell's class, plus "hl-declared" (red, see index.css) when it is the declared number
// or one of its haruf
export const hlCls = (keys: Set<string>, key: string | number, base: string) =>
  keys.has(String(key)) ? `${base} hl-declared` : base;
