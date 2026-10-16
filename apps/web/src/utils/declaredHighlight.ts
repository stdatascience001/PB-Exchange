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

// The shift's declared number for the day on screen (null while that day is undeclared),
// by the same rule the Daily Report uses (/transactions/collection?declaredOnly=true).
export const useDeclaredNumber = (shiftId: string | number | null | undefined, date: string | null | undefined): string | null => {
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
  return declared;
};

// A grid cell's class, plus "hl-declared" (red, see index.css) when it is the declared number
// or one of its haruf
export const hlCls = (keys: Set<string>, key: string | number, base: string) =>
  keys.has(String(key)) ? `${base} hl-declared` : base;
