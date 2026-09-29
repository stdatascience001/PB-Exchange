import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, JantriViewDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { toast } from 'react-toastify';

interface CompanyCalculationPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
  onSelectShift: (shift: ShiftDto) => void;
  onNavigate?: (page: string) => void;
}

// Today on the browser's own calendar (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const messageToast = (text: string, toastId?: string) =>
  toast.error(
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

// Cell keys used by every grid: numbers 1..100 ("100" is jantri number 00), then haruf
// B1..B9,B0 and A1..A9,A0.
const numKey = (n: number) => (n < 100 ? String(n).padStart(2, '0') : '00');
const HARUF_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
type CellKey = number | `A${number}` | `B${number}`;

const fmt = (v: number) => Math.round(v).toLocaleString('en-IN');

// One jantri panel in the Main tab — 10x10 numbers, column totals, B / A haruf rows and an
// M-Total row, same shape as the live page.
const JantriPanel: React.FC<{
  title: string;
  getValue: (key: CellKey) => number;
  editable?: boolean;
  onEdit?: (key: CellKey, val: number) => void;
  // Profit & Loss has no meaningful sums (each cell is "if this number wins"), so its totals
  // read 0 on the live page.
  noTotals?: boolean;
  signed?: boolean;
  headerAction?: React.ReactNode;
}> = ({ title, getValue, editable = false, onEdit, noTotals = false, signed = false, headerAction }) => {
  const sum = (keys: CellKey[]): number => (noTotals ? 0 : keys.reduce<number>((s, k) => s + getValue(k), 0));
  const rowKeys = (r: number) => Array.from({ length: 10 }, (_, c) => r * 10 + c + 1);
  const colKeys = (c: number) => Array.from({ length: 10 }, (_, r) => r * 10 + c);
  const bKeys = HARUF_DIGITS.map(d => `B${d}` as CellKey);
  const aKeys = HARUF_DIGITS.map(d => `A${d}` as CellKey);
  const numbersTotal = sum(Array.from({ length: 100 }, (_, i) => i + 1));
  const mTotal = numbersTotal + sum(bKeys) + sum(aKeys);

  const cell = (key: CellKey, label: string) => {
    const val = getValue(key);
    return (
      <td key={String(key)} className="relative h-[22px] border border-[#1f3558] bg-white text-right px-1 align-bottom">
        <span className="absolute top-0 left-0 text-[7px] font-bold px-[2px] bg-[#fef9c3] text-[#854d0e] leading-tight">{label}</span>
        {editable ? (
          <input
            type="number"
            min="0"
            value={val || ''}
            onChange={(e) => onEdit && onEdit(key, Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-full text-right bg-transparent outline-none font-bold text-slate-900 text-[10px] focus:bg-[#fde68a]"
          />
        ) : val !== 0 ? (
          <span className={`font-bold text-[10px] ${signed ? (val < 0 ? 'text-red-600' : 'text-emerald-700') : 'text-slate-900'}`}>{fmt(val)}</span>
        ) : null}
      </td>
    );
  };
  const totalCell = (v: number, k: string) => (
    <td key={k} className="bg-[#152847] text-white text-right px-1 font-bold text-[10px] border border-[#2b446f]">{fmt(v)}</td>
  );

  return (
    <div className="flex-1 min-w-0 bg-[#152847] p-1">
      <div className="text-white text-[10px] font-bold py-1.5 px-1.5 flex items-center justify-between">
        <span>{title}</span>
        {headerAction}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono select-none table-fixed">
          <thead>
            <tr className="text-white text-[9px]">
              {Array.from({ length: 10 }, (_, i) => (
                <th key={i} className="py-1 text-center border border-[#2b446f] w-[9.09%]">{i + 1}</th>
              ))}
              <th className="py-1 text-center border border-[#2b446f] w-[9.09%]">Total</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }, (_, r) => (
              <tr key={r}>
                {rowKeys(r).map(n => cell(n, String(n)))}
                {totalCell(sum(rowKeys(r)), `rt${r}`)}
              </tr>
            ))}
            <tr>
              {Array.from({ length: 10 }, (_, c) => totalCell(sum(colKeys(c + 1)), `ct${c}`))}
              {totalCell(numbersTotal, 'nt')}
            </tr>
            <tr>
              {bKeys.map(k => cell(k, String(k)))}
              {totalCell(sum(bKeys), 'bt')}
            </tr>
            <tr>
              {aKeys.map(k => cell(k, String(k)))}
              {totalCell(sum(aKeys), 'at')}
            </tr>
            <tr className="text-white text-[9px] font-bold">
              {Array.from({ length: 9 }, (_, i) => (
                <td key={i} className="text-right px-1 border border-[#2b446f]">-</td>
              ))}
              <td className="text-right px-1 border border-[#2b446f] whitespace-nowrap">M-Total</td>
              {totalCell(mTotal, 'mt')}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface NumberPnl {
  n: number;
  dahi: number;   // total number (dara) sale
  akh: number;    // total haruf sale
  sale: number;
  up: number;
  down: number;
  disc: number;
  net: number;
  oDahi: number;  // stake on this number
  oAkh: number;   // stake on its Andar + Bahar haruf
  credit: number; // payout if this number wins
  result: number;
}

export const CompanyCalculationPage: React.FC<CompanyCalculationPageProps> = ({ shifts, activeShift, onSelectShift, onNavigate }) => {
  const [data, setData] = useState<JantriViewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'main' | 'pnl'>('main');
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [amtLess, setAmtLess] = useState('');
  const [pctLess, setPctLess] = useState('');
  // AMT LESS / % LESS take effect on Search, like the shift and date.
  const [applied, setApplied] = useState<{ amt: number; pct: number }>({ amt: 0, pct: 0 });
  const [saleDesc, setSaleDesc] = useState(true);

  // Edit Mode is a client-side scratchpad only — never persisted server-side.
  const [editValues, setEditValues] = useState<Record<string, number>>({});

  // Only active shifts that aren't closed can be picked.
  const shiftOptions = useMemo(
    () => shifts.filter(s => s.isActive !== false && s.status !== 'CLOSED'),
    [shifts]
  );
  const selectedShift = shiftOptions.find(s => s.id === activeShift?.id) || shiftOptions[0] || null;

  // Fall back to the first active shift when the app-wide selection is an inactive one.
  useEffect(() => {
    if (selectedShift && selectedShift.id !== activeShift?.id) onSelectShift(selectedShift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShift?.id]);

  const fetchJantri = async (shiftId: number, date: string) => {
    setLoading(true);
    try {
      const res = await apiRequest<JantriViewDto>(`/jantri/${shiftId}?date=${encodeURIComponent(date)}`);
      setData(res.data || null);
      setEditValues({});
    } catch (err: any) {
      console.warn('Failed to load jantri data:', err);
      messageToast(err.message || 'Failed to load company calculation', 'comp-calc-load');
    } finally {
      setLoading(false);
    }
  };

  // Shift change (and first open) loads that shift's jantri for the chosen date.
  useEffect(() => {
    if (selectedShift) fetchJantri(selectedShift.id, fromDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShift?.id]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return messageToast('Please select Shift!', 'comp-calc-shift');
    if (!fromDate) return messageToast('Please select Date!', 'comp-calc-date');
    const amt = amtLess.trim() === '' ? 0 : parseFloat(amtLess);
    const pct = pctLess.trim() === '' ? 0 : parseFloat(pctLess);
    if (isNaN(amt) || amt < 0) return messageToast('AMT LESS must be 0 or more!', 'comp-calc-amt');
    if (isNaN(pct) || pct < 0 || pct > 100) return messageToast('% LESS must be between 0 and 100!', 'comp-calc-pct');
    setApplied({ amt, pct });
    fetchJantri(selectedShift.id, fromDate);
  };

  const gridByNumber = useMemo(() => {
    const map = new Map<string, number>();
    (data?.grid || []).forEach(c => map.set(c.number, c.totalAmount));
    return map;
  }, [data]);

  const harufByDigit = useMemo(() => {
    const map = new Map<string, { a: number; b: number }>();
    (data?.haruf || []).forEach(h => map.set(h.digit, { a: h.andarAmount, b: h.baharAmount }));
    return map;
  }, [data]);

  // DEFAULT: the shift's jantri exactly as booked for that date.
  const getDefault = (key: CellKey): number => {
    if (typeof key === 'number') return gridByNumber.get(numKey(key)) || 0;
    const h = harufByDigit.get(key.slice(1));
    return key[0] === 'A' ? h?.a || 0 : h?.b || 0;
  };

  // AMT LESS takes a flat amount off every cell that has a sale, % LESS then trims by percent.
  const lessAdjusted = (v: number) => {
    if (v <= 0) return 0;
    let out = Math.max(0, v - applied.amt);
    if (applied.pct > 0) out = out * (1 - applied.pct / 100);
    return Math.round(out * 100) / 100;
  };

  // EDIT MODE: Default after AMT/% LESS; a typed cell overrides it as-is.
  const getEdit = (key: CellKey): number => {
    const typed = editValues[String(key)];
    return typed !== undefined ? typed : lessAdjusted(getDefault(key));
  };

  const getDifference = (key: CellKey) => getEdit(key) - getDefault(key);

  // Company rates straight from the shift's Company Config tab (Shift Manage).
  const cfg = {
    dRate: Number(selectedShift?.companyDRate) || 0,
    aRate: Number(selectedShift?.companyARate) || 0,
    dComm: Number(selectedShift?.companyDComm) || 0,
    aComm: Number(selectedShift?.companyAComm) || 0,
    share: Number(selectedShift?.companyTax) || 0,
  };

  // Profit & Loss for every number, computed from the EDIT MODE jantri:
  //   SALE   = DAHI (numbers) + AKH (haruf)
  //   DOWN   = DAHI × D-Comm% + AKH × A-Comm%     DISC = −DOWN     NET = SALE − DOWN
  //   CREDIT = O-DAHI × D-Rate + O-AKH × A-Rate   (payout if this number wins; O-AKH is
  //            its Andar haruf on the first digit + Bahar haruf on the second)
  //   RESULT = (NET − CREDIT) × Tax% — the company's share; Tax 0 keeps the full amount
  //   UP     = sale taken off by AMT/% LESS and edits (Default − Edit M-Total)
  const pnl: NumberPnl[] = useMemo(() => {
    let dahi = 0;
    let akh = 0;
    let defaultTotal = 0;
    for (let n = 1; n <= 100; n++) {
      dahi += getEdit(n);
      defaultTotal += getDefault(n);
    }
    for (const d of HARUF_DIGITS) {
      akh += getEdit(`A${d}`) + getEdit(`B${d}`);
      defaultTotal += getDefault(`A${d}`) + getDefault(`B${d}`);
    }
    const sale = dahi + akh;
    const down = (dahi * cfg.dComm + akh * cfg.aComm) / 100;
    const net = sale - down;
    const up = defaultTotal - sale;
    const factor = cfg.share > 0 ? cfg.share / 100 : 1;

    return Array.from({ length: 100 }, (_, i) => {
      const n = i + 1;
      const key = numKey(n);
      const oDahi = getEdit(n);
      const oAkh = getEdit(`A${Number(key[0])}`) + getEdit(`B${Number(key[1])}`);
      const credit = oDahi * cfg.dRate + oAkh * cfg.aRate;
      return {
        n, dahi, akh, sale, up, down, disc: -down, net, oDahi, oAkh, credit,
        result: Math.round((net - credit) * factor),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, editValues, applied, cfg.dRate, cfg.aRate, cfg.dComm, cfg.aComm, cfg.share]);

  const getProfitLoss = (key: CellKey) => (typeof key === 'number' ? pnl[key - 1]?.result || 0 : 0);

  // SALE ASC: numbers that have a sale, with their P&L; the arrow flips the order.
  const saleRows = useMemo(() => {
    const rows = pnl.filter(p => p.oDahi > 0).map(p => ({ n: p.n, sale: p.oDahi, pl: p.result }));
    return rows.sort((a, b) => (saleDesc ? b.sale - a.sale : a.sale - b.sale) || a.n - b.n);
  }, [pnl, saleDesc]);

  const tabBtn = (key: 'main' | 'pnl', label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-4 py-1.5 text-xs font-semibold ${tab === key ? 'text-blue-700 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <form onSubmit={handleSearch} className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-3">Company Calculation</span>
        <select
          value={selectedShift?.id || ''}
          onChange={(e) => {
            const s = shiftOptions.find(sh => sh.id === parseInt(e.target.value, 10));
            if (s) onSelectShift(s);
          }}
          className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fde68a] cursor-pointer min-w-32 shadow-xs"
        >
          {shiftOptions.length === 0 && <option value="">NO ACTIVE SHIFT</option>}
          {shiftOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fde68a]" />
        <div className="flex items-center gap-1.5 ml-3">
          <span className="text-slate-600 font-semibold text-[10px]">AMT LESS</span>
          <input type="number" min="0" step="any" placeholder="AMT" value={amtLess} onChange={(e) => setAmtLess(e.target.value)} className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:bg-[#fde68a]" />
        </div>
        <div className="flex items-center gap-1.5 ml-3">
          <span className="text-slate-600 font-semibold text-[10px]">% LESS</span>
          <input type="number" min="0" max="100" step="any" placeholder="%" value={pctLess} onChange={(e) => setPctLess(e.target.value)} className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:bg-[#fde68a]" />
        </div>
        <button type="submit" className="px-8 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs">
          Search
        </button>
      </form>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="flex border-b border-slate-200 px-2">
          {tabBtn('main', 'Main')}
          {tabBtn('pnl', 'P&L')}
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400">Loading...</div>
        ) : tab === 'main' ? (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
              <div className="flex flex-col xl:flex-row gap-1.5">
                <JantriPanel
                  title="MAIN JANTRI - EDIT MODE"
                  getValue={getEdit}
                  editable
                  onEdit={(key, val) => setEditValues(prev => ({ ...prev, [String(key)]: val }))}
                  headerAction={
                    <button
                      type="button"
                      onClick={() => selectedShift && fetchJantri(selectedShift.id, fromDate)}
                      className="px-2.5 py-0.5 bg-[#ca8a04] hover:bg-[#b45309] text-white text-[9px] font-bold rounded-xs"
                      title="Reload the jantri and clear typed edits"
                    >
                      Re-Load
                    </button>
                  }
                />
                <JantriPanel title="MAIN JANTRI - PROFIT & LOSS" getValue={getProfitLoss} noTotals signed />
              </div>
              <div className="flex flex-col xl:flex-row gap-1.5">
                <JantriPanel title="MAIN JANTRI - DEFAULT" getValue={getDefault} />
                <JantriPanel title="MAIN JANTRI - DIFFRANCE" getValue={getDifference} signed />
              </div>
            </div>

            {/* SALE ASC */}
            <div className="w-48 border-l border-slate-300 flex flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => setSaleDesc(d => !d)}
                className="bg-[#152847] text-white text-[10px] font-bold py-1.5 px-2.5 flex items-center justify-center gap-1"
                title="Flip order"
              >
                SALE ASC <RotateCw className="w-3 h-3" />
              </button>
              <div className="grid grid-cols-[3rem_1fr] bg-[#152847] text-white text-[9px] font-bold border-t border-[#2b446f]">
                <div className="py-1 text-center border-r border-[#2b446f]">NO</div>
                <div className="py-1 text-center">SALE/PL</div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
                {saleRows.length === 0 ? (
                  <div className="py-6 text-center text-slate-400">No data</div>
                ) : (
                  saleRows.map(r => (
                    <div key={r.n} className="grid grid-cols-[3rem_1fr] text-[10px]">
                      <div className="py-1 text-center font-mono font-bold text-slate-800 border-r border-slate-200 self-center">{r.n}</div>
                      <div className="text-right px-1.5">
                        <div className="font-mono font-bold text-slate-900">{fmt(r.sale)}</div>
                        <div className={`font-mono text-[8px] ${r.pl < 0 ? 'text-red-600' : 'text-slate-500'}`}>{fmt(r.pl)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* P&L tab: one card per number */
          <div className="flex-1 overflow-y-auto bg-black p-1">
            <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-10 gap-1">
              {pnl.map(p => (
                <div key={p.n} className="bg-white text-[9px] font-semibold leading-tight">
                  <div className="grid grid-cols-[1fr_2fr]">
                    <div className="bg-[#dc2626] text-white font-bold text-center py-0.5">SALE</div>
                    <div className="bg-[#fde047] text-[#dc2626] font-black text-center text-sm">{p.n}</div>
                  </div>
                  <div className="grid grid-cols-3 text-center">
                    <div>UP</div><div>{fmt(p.up)}</div><div>{fmt(p.net)}</div>
                    <div>DOWN</div><div>{fmt(p.down)}</div><div>CREDIT</div>
                    <div>DISC</div><div>{fmt(p.disc)}</div><div>{fmt(p.credit)}</div>
                  </div>
                  <div className="grid grid-cols-3 text-center">
                    <div className="bg-[#7e22ce] text-white font-bold">DAHI</div>
                    <div className="bg-[#7e22ce] text-white font-bold">AKH</div>
                    <div className="row-span-2 flex items-center justify-center font-bold">{fmt(p.sale)}</div>
                    <div className="font-bold">{fmt(p.dahi)}</div>
                    <div className="font-bold">{fmt(p.akh)}</div>
                  </div>
                  <div className="grid grid-cols-3 text-center">
                    <div className="bg-[#991b1b] text-white font-bold">O-DAHI</div>
                    <div className="bg-[#991b1b] text-white font-bold">O-AKH</div>
                    <div className={`row-span-2 flex items-center justify-center font-bold text-white ${p.result < 0 ? 'bg-[#ef4444]' : 'bg-[#16a34a]'}`}>{fmt(p.result)}</div>
                    <div className="font-bold">{fmt(p.oDahi)}</div>
                    <div className="font-bold">{fmt(p.oAkh)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
