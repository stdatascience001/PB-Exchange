import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

// Jantri View → "Cut Consolidate Jantri" (live): the popup party's book consolidated (all its
// loaded slips), each amount net of the party's own Commission and Hissa
// (GET /transactions/cut-factors). Live AGARTALA EXPRESS (90/10-9/10, Hissa "50 | AGARTALA
// EXPRESS"): factor 0.45 -> 200 -> 90, 210 -> 94, 10 -> 4. CHHABRA APH 50/50 (50% comm,
// Hissa 50): 0.25 -> 230 -> 58, 152 -> 38.
// Until the factors arrive (or if the call fails) a party falls back to the old flat 90%.
export const CUT_FALLBACK_FACTOR = 0.9;

export const useCutFactors = (enabled: boolean, partyIds: number[]): Record<number, number> => {
  const [factors, setFactors] = useState<Record<number, number>>({});
  const key = Array.from(new Set(partyIds.filter(id => id > 0))).sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    apiRequest<Record<string, number>>(`/transactions/cut-factors?partyIds=${key}`)
      .then(res => {
        if (!alive || !res.data) return;
        const next: Record<number, number> = {};
        for (const [id, f] of Object.entries(res.data)) next[Number(id)] = Number(f);
        setFactors(prev => ({ ...prev, ...next }));
      })
      .catch(() => { /* keep the fallback */ });
    return () => { alive = false; };
  }, [enabled, key]);
  return factors;
};

export const cutFactorOf = (factors: Record<number, number>, partyId?: number) =>
  partyId !== undefined && factors[partyId] !== undefined ? factors[partyId] : CUT_FALLBACK_FACTOR;

// Whole rupees, an exact .5 going to the even rupee as live shows it: 94.5 -> 94, 4.5 -> 4
export const roundHalfEven = (v: number) => {
  const x = Math.round(v * 1e6) / 1e6; // drop float noise (210 x 0.45 = 94.50000000000001)
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};
