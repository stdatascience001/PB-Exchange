// Slip entries carry an entryType; haruf is stored as its single digit (see the API's
// normalizeNumberValue). These helpers show and match them the way the live panels do.

export interface EntryLike {
  numberValue: string;
  entryType?: string | null;
}

const lastDigit = (v: string) => {
  const m = (v || '').trim().match(/(\d)\s*$/);
  return m ? m[1] : null;
};

// Haruf digit of an entry ("5" for Andar 5), or null for a number (Dara) entry. Entries
// without an entryType fall back to the older "A5" / "B5" spelling.
export function harufOf(e: EntryLike): { side: 'A' | 'B'; digit: string } | null {
  if (e.entryType === 'HARUF_ANDAR' || e.entryType === 'HARUF_BAHAR') {
    const d = lastDigit(e.numberValue);
    return d ? { side: e.entryType === 'HARUF_ANDAR' ? 'A' : 'B', digit: d } : null;
  }
  const v = (e.numberValue || '').trim();
  // Four / three of the same digit is Andar / Bahar haruf even when it was saved as a number
  // (the API now stores it as haruf; this covers slips saved before that).
  if (!e.entryType || e.entryType === 'DARA') {
    if (/^(\d)\1{3}$/.test(v)) return { side: 'A', digit: v[0] };
    if (/^(\d)\1{2}$/.test(v)) return { side: 'B', digit: v[0] };
  }
  if (!e.entryType) {
    const m = v.toUpperCase().match(/^([AB])H?-?0?(\d)$/);
    if (m) return { side: m[1] as 'A' | 'B', digit: m[2] };
  }
  return null;
}

// Number shown on the live Party panel: Andar d → "dddd" (5555), Bahar d → "ddd" (111),
// numbers as stored.
export function displayNumber(e: EntryLike): string {
  const h = harufOf(e);
  if (!h) return e.numberValue;
  return h.side === 'A' ? h.digit.repeat(4) : h.digit.repeat(3);
}

// Is this a plain number (Dara) entry?
export const isNumberEntry = (e: EntryLike) => !harufOf(e);
