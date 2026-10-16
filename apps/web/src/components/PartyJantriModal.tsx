import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { declaredCellKeys, hlCls } from '../utils/declaredHighlight.js';

interface CollectionGrid {
  grid: { number: string; totalAmount: number }[];
  haruf: { digit: string; andarAmount: number; baharAmount: number }[];
  // the day's declared result ("32"), null while undeclared
  declaredNumber?: string | null;
}

interface PartyJantriModalProps {
  open: boolean;
  onClose: () => void;
  shiftId: string;
  // YYYY-MM-DD
  date: string;
  partyId: number;
  partyName: string;
  // Optional header text in place of the party name (Admin Cash: "JIMMY CHD | 14-10-2026 | GHAZIABAD")
  title?: string;
  // Each cell rounded up to whole 50s (Daily Report, the default). Admin Cash passes false:
  // the party's exact amounts, Grand Total = its sale for that shift + day.
  round50?: boolean;
}

// Daily Report → click a Party name (live): that party's own jantri for the shift and day —
// each number / haruf at the amount the party played (no Commission / Hissa off), rounded up
// to whole 50s. Live JAI LUXMI 12-10: ANKUSH KUMAR 15/85 every number it played shows 50, the
// six it didn't (37, 39, 59, 73, 93, 95) stay blank, Grand Total 4,700; GANGA NAGAR 20,400;
// HANUMANGARH B9 117 -> 150. Server: /transactions/collection?round50=true, one party.
export const PartyJantriModal: React.FC<PartyJantriModalProps> = ({ open, onClose, shiftId, date, partyId, partyName, title, round50 = true }) => {
  const [result, setResult] = useState<CollectionGrid | null>(null);
  const [loading, setLoading] = useState(false);
  const backdropDownRef = useRef(false);

  useEffect(() => {
    if (!open || !shiftId || !partyId) return;
    let cancelled = false;
    setResult(null);
    setLoading(true);
    const params = new URLSearchParams({ shiftId, date, partyIds: String(partyId) });
    if (round50) params.append('round50', 'true');
    apiRequest<CollectionGrid>(`/transactions/collection?${params.toString()}`)
      .then(res => { if (!cancelled) setResult(res.data || { grid: [], haruf: [] }); })
      .catch(err => {
        console.warn('Failed to load party jantri:', err);
        if (!cancelled) setResult({ grid: [], haruf: [] });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, shiftId, date, partyId, round50]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // number "1".."100" / haruf "A0".."B9" -> amount (whole rupees)
  const cells = useMemo(() => {
    const map = new Map<string, number>();
    if (!result) return map;
    for (const g of result.grid) {
      const n = g.number === '00' ? 100 : parseInt(g.number, 10);
      const v = Math.round(g.totalAmount || 0);
      if (n >= 1 && n <= 100 && v > 0) map.set(String(n), v);
    }
    for (const h of result.haruf) {
      const a = Math.round(h.andarAmount || 0);
      const b = Math.round(h.baharAmount || 0);
      if (a > 0) map.set(`A${h.digit}`, a);
      if (b > 0) map.set(`B${h.digit}`, b);
    }
    return map;
  }, [result]);

  if (!open) return null;

  const cell = (k: string) => cells.get(k) || 0;
  const rowTotal = (r: number) => Array.from({ length: 10 }, (_, c) => cell(String(r * 10 + c + 1))).reduce((a, b) => a + b, 0);
  const colTotal = (c: number) => Array.from({ length: 10 }, (_, r) => cell(String(r * 10 + c))).reduce((a, b) => a + b, 0);
  const numbersTotal = Array.from({ length: 100 }, (_, i) => cell(String(i + 1))).reduce((a, b) => a + b, 0);
  const harufTotal = (side: 'A' | 'B') => Array.from({ length: 10 }, (_, d) => cell(`${side}${d}`)).reduce((a, b) => a + b, 0);
  const grandTotal = numbersTotal + harufTotal('A') + harufTotal('B');

  const head = 'bg-[#152847] text-white font-bold text-xs sm:text-sm border border-[#223b63]';
  const cellBox = 'relative h-8 bg-white border border-slate-300 text-right px-1.5 align-middle';
  const badge = 'absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fde68a] text-[#713f12] leading-tight select-none';
  const amt = (v: number) => (v > 0 ? <span className="font-bold text-[13px] text-slate-900 font-mono">{v}</span> : null);

  // declared number + its Andar / Bahar haruf shown in green (32 -> 32, A3, B2)
  const declaredKeys = declaredCellKeys(result?.declaredNumber);

  const harufRow = (side: 'A' | 'B') => (
    <tr>
      {Array.from({ length: 10 }, (_, c) => {
        const digit = c + 1 === 10 ? 0 : c + 1;
        return (
          <td key={digit} className={hlCls(declaredKeys, `${side}${digit}`, cellBox)}>
            <span className={badge}>{side}{digit}</span>
            {amt(cell(`${side}${digit}`))}
          </td>
        );
      })}
      <td className={`${head} text-right px-2`}>{harufTotal(side)}</td>
    </tr>
  );

  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-300 max-h-[95vh] flex flex-col">
        <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-bold tracking-tight uppercase inline-flex items-center gap-2">
            {title || partyName}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-200 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto px-1 pb-1 pt-1">
          <table className="w-full border-collapse table-fixed">
            <thead>
              <tr>
                {Array.from({ length: 10 }, (_, c) => (
                  <th key={c} className={`${head} py-1.5`}>{c + 1}</th>
                ))}
                <th className={`${head} py-1.5 w-28`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: 10 }, (_, c) => {
                    const n = r * 10 + c + 1;
                    return (
                      <td key={n} className={hlCls(declaredKeys, n, cellBox)}>
                        <span className={badge}>{n}</span>
                        {amt(cell(String(n)))}
                      </td>
                    );
                  })}
                  <td className={`${head} text-right px-2`}>{rowTotal(r)}</td>
                </tr>
              ))}
              <tr>
                {Array.from({ length: 10 }, (_, c) => (
                  <td key={c} className={`${head} text-right px-2 py-1`}>{colTotal(c + 1)}</td>
                ))}
                <td className={`${head} text-right px-2`}>{numbersTotal}</td>
              </tr>
              {harufRow('B')}
              {harufRow('A')}
              <tr>
                {Array.from({ length: 9 }, (_, c) => (
                  <td key={c} className={`${head} text-right px-2 py-1`}>-</td>
                ))}
                <td className={`${head} text-right px-2`}>Grand Total</td>
                <td className={`${head} text-right px-2`}>{grandTotal.toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
