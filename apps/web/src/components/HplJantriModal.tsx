import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { PartyPicker } from './PartyPicker.js';
import { declaredCellKeys } from '../utils/declaredHighlight.js';

interface CollectionGrid {
  grid: { number: string; totalAmount: number }[];
  haruf: { digit: string; andarAmount: number; baharAmount: number }[];
  // the day's declared result ("32"), null while undeclared
  declaredNumber?: string | null;
}

interface HplJantriModalProps {
  open: boolean;
  onClose: () => void;
  shiftId: string;
  shiftName: string;
  // YYYY-MM-DD
  date: string;
  parties: { id: number; partyName: string }[];
  // 'hpl' (default): HPL - JANTRI. 'main': MAIN JANTRI (Main Jantri F7) — the whole book with
  // Commission and every Hissa taken off and each cell rounded up to 50 (the Collection report
  // with both ticked): live HYDRABAD NIGHT 08-10 DK ROHIT 50% 100 -> 45 -> 50, DK ROHIT 20%
  // 1000 -> 720 -> 750, book 1,100. It loads straight away, has no Party box, and an Export.
  variant?: 'hpl' | 'main';
}

// HPL - JANTRI (live): the shift's jantri at each party's net — its Commission taken off, then
// its Hissa rows except the share paid to a SYSTEM account (HP A/C), cells left exact.
// Live HYDRABAD NIGHT 08-10: DK ROHIT 50% (10% comm, Hissa 50 -> HP A/C) 100 -> 90;
// DK ROHIT 20% (10% comm, Hissa 20 -> itself) 100 -> 72. Worked out server-side
// (/transactions/collection?hpl=true). Filters, applied on Submit:
//   Party        only that party's slips (blank = every party)
//   Amount Less  that much taken off every cell (a cell at 0 or below drops out)
//   Less %age    every remaining cell cut by that percentage
// It opens with an empty grid; Submit loads the shift's live slips for the day.
export const HplJantriModal: React.FC<HplJantriModalProps> = ({ open, onClose, shiftId, shiftName, date, parties, variant = 'hpl' }) => {
  const isMain = variant === 'main';
  const [party, setParty] = useState('');
  const [amountLess, setAmountLess] = useState('');
  const [lessPct, setLessPct] = useState('');
  const [result, setResult] = useState<CollectionGrid | null>(null);
  const [loading, setLoading] = useState(false);
  const partyRef = useRef<HTMLInputElement>(null);
  const backdropDownRef = useRef(false);
  const loadRef = useRef<(p: string, l: number, c: number) => void>(() => {});

  // Each open starts clean with the cursor in Amount Less (as live)
  useEffect(() => {
    if (!open) return;
    setParty('');
    setAmountLess('');
    setLessPct('');
    setResult(null);
    // Main Jantri opens already filled in (live); HPL waits for Submit
    if (isMain && shiftId) loadRef.current('', 0, 0);
    const id = requestAnimationFrame(() => document.getElementById('hpl-amount-less')?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const message = (text: string, id: string, focusId?: string) => {
    toast.error(
      <div>
        <div className="font-bold text-base">Message</div>
        <div className="text-sm mt-0.5">{text}</div>
      </div>,
      { toastId: id }
    );
    if (focusId) {
      const el = document.getElementById(focusId) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!shiftId) return message('Please choose a valid shift!', 'hpl-shift');
    const typedParty = party.trim();
    if (typedParty && !parties.some(p => p.partyName.toUpperCase() === typedParty.toUpperCase())) {
      return message('Please enter a valid party!', 'hpl-party', 'hpl-party');
    }
    const less = amountLess.trim() === '' ? 0 : parseFloat(amountLess);
    if (isNaN(less) || less < 0) return message('Please enter a valid amount!', 'hpl-less', 'hpl-amount-less');
    const pct = lessPct.trim() === '' ? 0 : parseFloat(lessPct);
    if (isNaN(pct) || pct < 0 || pct > 100) return message('Please enter a valid percentage!', 'hpl-pct', 'hpl-less-pct');

    await load(typedParty, less, pct);
  };

  const load = async (typedParty: string, less: number, pct: number) => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ shiftId, date });
      if (isMain) {
        params.append('commission', 'true');
        params.append('hissa', 'true');
        params.append('mainJantri', 'true');
      } else {
        params.append('hpl', 'true');
      }
      if (less > 0) params.append('amtLess', String(less));
      if (pct > 0) params.append('lessPercent', String(pct));
      if (typedParty) {
        const p = parties.find(pp => pp.partyName.toUpperCase() === typedParty.toUpperCase());
        if (p) params.append('partyIds', String(p.id));
      }
      const res = await apiRequest<CollectionGrid>(`/transactions/collection?${params.toString()}`);
      setResult(res.data || { grid: [], haruf: [] });
    } catch (err) {
      console.warn('Failed to load HPL jantri:', err);
      setResult({ grid: [], haruf: [] });
    } finally {
      setLoading(false);
    }
  };

  loadRef.current = load;

  // Export (Main Jantri): the grid as on screen, as a CSV
  const handleExport = () => {
    const lines: string[] = ['NUMBER,AMOUNT'];
    for (let n = 1; n <= 100; n++) lines.push(`${n},${cells.get(String(n)) || 0}`);
    for (let d = 1; d <= 10; d++) { const k = `B${d % 10}`; lines.push(`${k},${cells.get(k) || 0}`); }
    for (let d = 1; d <= 10; d++) { const k = `A${d % 10}`; lines.push(`${k},${cells.get(k) || 0}`); }
    const link = document.createElement('a');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n')));
    link.setAttribute('download', `main_jantri_${(shiftName || 'shift').replace(/\s+/g, '_')}_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Whole rupees with an exact .5 going to the even rupee, as live does: PUNJAB DAY 15-10
  // 13.5 -> 14, 33.5 -> 34 but 210.5 -> 210, 238.5 -> 238, 22.5 -> 22 (grand total 3,755).
  // Main Jantri cells are already whole 50s, so they are unchanged by this.
  const roundHalfEven = (v: number) => {
    const x = Math.round(v * 1e6) / 1e6; // drop float noise (15 x 0.9 = 13.500000000000002)
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  };

  // number "1".."100" / haruf "A0".."B9" -> the server's HPL amount (whole rupees)
  const cells = useMemo(() => {
    const map = new Map<string, number>();
    if (!result) return map;
    for (const g of result.grid) {
      const n = g.number === '00' ? 100 : parseInt(g.number, 10);
      const v = roundHalfEven(g.totalAmount || 0);
      if (n >= 1 && n <= 100 && v > 0) map.set(String(n), v);
    }
    for (const h of result.haruf) {
      const a = roundHalfEven(h.andarAmount || 0);
      const b = roundHalfEven(h.baharAmount || 0);
      if (a > 0) map.set(`A${h.digit}`, a);
      if (b > 0) map.set(`B${h.digit}`, b);
    }
    return map;
  }, [result]);

  if (!open) return null;

  const cell = (k: string) => cells.get(k) || 0;
  // declared number + its Andar / Bahar haruf, shown in green
  const declaredKeys = declaredCellKeys(result?.declaredNumber);
  const cellCls = (k: string) => declaredKeys.has(k) ? cellBox.replace('bg-white', 'bg-green-600') : cellBox;
  const amtCls = (k: string) => `font-bold text-[13px] font-mono ${declaredKeys.has(k) ? 'text-white' : 'text-slate-900'}`;
  const rowTotal = (r: number) => Array.from({ length: 10 }, (_, c) => cell(String(r * 10 + c + 1))).reduce((a, b) => a + b, 0);
  const colTotal = (c: number) => Array.from({ length: 10 }, (_, r) => cell(String(r * 10 + c))).reduce((a, b) => a + b, 0);
  const numbersTotal = Array.from({ length: 100 }, (_, i) => cell(String(i + 1))).reduce((a, b) => a + b, 0);
  const harufTotal = (side: 'A' | 'B') => Array.from({ length: 10 }, (_, d) => cell(`${side}${d}`)).reduce((a, b) => a + b, 0);
  const grandTotal = numbersTotal + harufTotal('A') + harufTotal('B');

  const [yy, mm, dd] = (date || '').split('-');
  const titleDate = dd ? `${dd} / ${mm} / ${yy}` : '';
  const head = 'bg-[#152847] text-white font-bold text-xs sm:text-sm border border-[#223b63]';
  const cellBox = 'relative h-8 bg-white border border-slate-300 text-right px-1.5 align-middle';
  const badge = 'absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fde68a] text-[#713f12] leading-tight select-none';
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };

  const harufRow = (side: 'A' | 'B') => (
    <tr>
      {Array.from({ length: 10 }, (_, c) => {
        const digit = c + 1 === 10 ? 0 : c + 1;
        const v = cell(`${side}${digit}`);
        return (
          <td key={digit} className={cellCls(`${side}${digit}`)}>
            <span className={badge}>{side}{digit}</span>
            {v > 0 ? <span className={amtCls(`${side}${digit}`)}>{v}</span> : null}
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
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl overflow-hidden border border-slate-300 max-h-[95vh] flex flex-col">
        <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-bold tracking-tight uppercase">
            {isMain ? 'MAIN JANTRI' : 'HPL - JANTRI'} | {shiftName || '-'} | {titleDate}
          </h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-200 p-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Party / Amount Less / Less %age / Submit — Enter: Party -> Amount Less -> Less %age -> Submit */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className="px-3 py-2 flex flex-wrap items-center gap-4 text-xs"
        >
          {!isMain && <span className="text-slate-600 font-semibold">Party</span>}
          {!isMain && <div className="w-60">
            <PartyPicker
              parties={parties as unknown as LedgerDto[]}
              value={party}
              onChange={setParty}
              onPick={(p) => { setParty(p.partyName); document.getElementById('hpl-amount-less')?.focus(); }}
              onInvalid={() => document.getElementById('hpl-amount-less')?.focus()}
              inputRef={partyRef}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:bg-[#fde68a] focus:border-amber-300"
            />
          </div>}
          <span className="text-slate-600 font-semibold">Amount Less</span>
          <input
            id="hpl-amount-less"
            type="number"
            value={amountLess}
            onChange={(e) => setAmountLess(e.target.value)}
            onKeyDown={enterTo('hpl-less-pct')}
            className="w-44 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-300"
          />
          <span className="text-slate-600 font-semibold">Less %age</span>
          <input
            id="hpl-less-pct"
            type="number"
            value={lessPct}
            onChange={(e) => setLessPct(e.target.value)}
            onKeyDown={enterTo('hpl-submit')}
            className="w-20 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-300"
          />
          <button
            id="hpl-submit"
            type="submit"
            disabled={loading}
            className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1662c6] inline-flex items-center gap-1.5"
          >
            Submit
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>
          {isMain && (
            <button
              type="button"
              onClick={handleExport}
              className="ml-auto px-8 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs"
            >
              Export
            </button>
          )}
        </form>

        <div className="overflow-auto px-1 pb-1">
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
                    const v = cell(String(n));
                    return (
                      <td key={n} className={cellCls(String(n))}>
                        <span className={badge}>{n}</span>
                        {v > 0 ? <span className={amtCls(String(n))}>{v}</span> : null}
                      </td>
                    );
                  })}
                  <td className={`${head} text-right px-2`}>{rowTotal(r)}</td>
                </tr>
              ))}
              <tr>
                {Array.from({ length: 10 }, (_, c) => (
                  <td key={c} className={`${head} text-right px-2 py-1`}>{colTotal(c + 1 === 10 ? 10 : c + 1)}</td>
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
                <td className={`${head} text-right px-2`}>{grandTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
