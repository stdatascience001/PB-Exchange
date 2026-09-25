import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, JantriViewDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';

interface CompanyCalculationPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
  onSelectShift: (shift: ShiftDto) => void;
  onNavigate?: (page: string) => void;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

// Mini 10x10 grid renderer shared by the four calculation panels below.
const MiniGrid: React.FC<{
  title: string;
  getValue: (num: number) => number;
  editable?: boolean;
  onEdit?: (num: number, val: number) => void;
}> = ({ title, getValue, editable = false, onEdit }) => {
  const getRowTotal = (r: number) => {
    let sum = 0;
    for (let c = 1; c <= 10; c++) sum += getValue(r * 10 + c);
    return sum;
  };
  const getColTotal = (col: number) => {
    let sum = 0;
    for (let r = 0; r < 10; r++) sum += getValue(r * 10 + col);
    return sum;
  };
  const mTotal = useMemo(() => {
    let sum = 0;
    for (let i = 1; i <= 100; i++) sum += getValue(i);
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getValue]);

  return (
    <div className="flex-1 min-w-0">
      <div className="bg-[#152847] text-white text-xs font-bold py-1.5 px-2.5 flex items-center justify-between">
        <span>{title}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px] font-mono select-none table-fixed">
          <thead>
            <tr>
              {Array.from({ length: 10 }, (_, i) => (
                <th key={i + 1} className="py-1 text-center border border-slate-300 bg-slate-50 w-[9.09%]">{i + 1}</th>
              ))}
              <th className="py-1 text-center border border-slate-300 bg-slate-50 w-[9.09%]">Total</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: 10 }, (_, c) => {
                  const num = r * 10 + (c + 1);
                  const val = getValue(num);
                  return (
                    <td key={num} className="relative h-7 border border-slate-200 text-right px-1 align-middle bg-white">
                      <span className="absolute top-0 left-0.5 text-[8px] text-slate-400">{num}</span>
                      {editable ? (
                        <input
                          type="number"
                          value={val || ''}
                          onChange={(e) => onEdit && onEdit(num, parseFloat(e.target.value) || 0)}
                          className="w-full h-full text-right bg-transparent outline-none font-bold text-slate-900 text-[10px]"
                        />
                      ) : (
                        <span className="font-bold text-slate-900">{val > 0 ? val.toLocaleString('en-IN') : ''}</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-center font-bold border border-slate-300 bg-slate-50">{getRowTotal(r).toLocaleString('en-IN')}</td>
              </tr>
            ))}
            <tr className="bg-slate-100 font-bold">
              {Array.from({ length: 10 }, (_, c) => (
                <td key={c + 1} className="py-1 text-center border border-slate-300">{getColTotal(c + 1).toLocaleString('en-IN')}</td>
              ))}
              <td className="py-1 text-center border border-slate-300">M-Total {mTotal.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const CompanyCalculationPage: React.FC<CompanyCalculationPageProps> = ({ shifts, activeShift, onSelectShift, onNavigate }) => {
  const [data, setData] = useState<JantriViewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'main' | 'pnl'>('main');
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [amtLess, setAmtLess] = useState('');
  const [pctLess, setPctLess] = useState('');

  // Edit Mode is a client-side scratchpad only — never persisted server-side.
  const [editValues, setEditValues] = useState<Record<number, number>>({});

  const fetchJantri = async (shiftId: number) => {
    setLoading(true);
    try {
      const res = await apiRequest<JantriViewDto>(`/jantri/${shiftId}`);
      if (res.data) setData(res.data);
    } catch (err) {
      console.warn('Failed to load jantri data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeShift) fetchJantri(activeShift.id);
  }, [activeShift]);

  useEffect(() => {
    setEditValues({});
  }, [activeShift]);

  const gridByNumber = useMemo(() => {
    const map = new Map<string, { totalAmount: number; liability: number }>();
    (data?.grid || []).forEach(c => map.set(c.number, c));
    return map;
  }, [data]);

  const getDefault = (n: number) => {
    const padded = n < 100 ? String(n).padStart(2, '0') : '00';
    return gridByNumber.get(padded)?.totalAmount || 0;
  };

  const getProfitLoss = (n: number) => {
    const padded = n < 100 ? String(n).padStart(2, '0') : '00';
    return gridByNumber.get(padded)?.liability || 0;
  };

  const adjustedEdit = (n: number) => {
    const raw = editValues[n] ?? getDefault(n);
    let val = raw;
    const flat = parseFloat(amtLess);
    if (!isNaN(flat) && flat > 0) val = Math.max(0, val - flat);
    const pct = parseFloat(pctLess);
    if (!isNaN(pct) && pct > 0) val = val * (1 - pct / 100);
    return val;
  };

  const getDifference = (n: number) => adjustedEdit(n) - getDefault(n);

  const saleAsc = useMemo(() => {
    const rows: Array<{ number: string; sale: number }> = [];
    for (let i = 1; i <= 100; i++) {
      const sale = getDefault(i);
      if (sale > 0) rows.push({ number: i < 100 ? String(i).padStart(2, '0') : '00', sale });
    }
    return rows.sort((a, b) => a.sale - b.sale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Company Calculation</span>
        <select
          value={activeShift?.id || ''}
          onChange={(e) => {
            const s = shifts.find(sh => sh.id === parseInt(e.target.value, 10));
            if (s) onSelectShift(s);
          }}
          className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
        >
          {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 font-medium">Amt Less</span>
          <input type="number" value={amtLess} onChange={(e) => setAmtLess(e.target.value)} className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 font-medium">% Less</span>
          <input type="number" value={pctLess} onChange={(e) => setPctLess(e.target.value)} className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs" />
        </div>
        <button
          type="button"
          onClick={() => activeShift && fetchJantri(activeShift.id)}
          className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs"
        >
          Search
        </button>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="flex border-b border-slate-200">
          <button
            type="button"
            onClick={() => setTab('main')}
            className={`px-4 py-2 text-xs font-bold border-b-2 ${tab === 'main' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
          >
            Main
          </button>
          <button
            type="button"
            onClick={() => setTab('pnl')}
            className={`px-4 py-2 text-xs font-bold border-b-2 ${tab === 'pnl' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
          >
            P&amp;L
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {loading ? (
              <div className="py-16 text-center text-slate-400">Loading...</div>
            ) : tab === 'main' ? (
              <>
                <div className="flex flex-col lg:flex-row gap-3">
                  <MiniGrid
                    title="MAIN JANTRI - EDIT MODE"
                    getValue={adjustedEdit}
                    editable
                    onEdit={(num, val) => setEditValues(prev => ({ ...prev, [num]: val }))}
                  />
                  <MiniGrid title="MAIN JANTRI - PROFIT & LOSS" getValue={getProfitLoss} />
                </div>
                <div className="flex flex-col lg:flex-row gap-3">
                  <MiniGrid title="MAIN JANTRI - DEFAULT" getValue={getDefault} />
                  <MiniGrid title="MAIN JANTRI - DIFFRANCE" getValue={getDifference} />
                </div>
              </>
            ) : (
              <MiniGrid title="MAIN JANTRI - PROFIT & LOSS" getValue={getProfitLoss} />
            )}
          </div>

          <div className="w-56 border-l border-slate-300 flex flex-col overflow-hidden">
            <div className="bg-[#152847] text-white text-xs font-bold py-1.5 px-2.5">SALE ASC</div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 font-bold text-[10px]">
                    <th className="py-1 px-2 border-b border-slate-200">NO</th>
                    <th className="py-1 px-2 border-b border-slate-200 text-right">SALE/PL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {saleAsc.length === 0 ? (
                    <tr><td colSpan={2} className="py-6 text-center text-slate-400">No data</td></tr>
                  ) : (
                    saleAsc.map(r => (
                      <tr key={r.number}>
                        <td className="py-1 px-2 font-mono font-bold text-blue-700">{r.number}</td>
                        <td className="py-1 px-2 text-right font-mono text-slate-700">{r.sale.toLocaleString('en-IN')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
