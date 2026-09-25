import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

interface TransBeforeAfterDeclarePageProps {
  shifts?: ShiftDto[];
  onNavigate?: (page: string) => void;
}

interface TransRow {
  id: number;
  partyName: string;
  rate: string;
  amount: number;
  isD: boolean;
  addedBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

interface EntryRow {
  id: number;
  numberValue: string;
  amount: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

const formatTimestamp = (val: string) => {
  const d = new Date(val);
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} - ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
};

export const TransBeforeAfterDeclarePage: React.FC<TransBeforeAfterDeclarePageProps> = ({ shifts = [], onNavigate }) => {
  const [shiftId, setShiftId] = useState(shifts[0]?.id ? String(shifts[0].id) : '');
  const [date, setDate] = useState(todayInputDate());
  const [mode, setMode] = useState<'BEFORE' | 'AFTER'>('BEFORE');
  const [partySearch, setPartySearch] = useState('');
  const [rows, setRows] = useState<TransRow[]>([]);
  const [totals, setTotals] = useState({ saleBefore: 0, saleAfter: 0, saleDiff: 0, plBefore: 0, plAfter: 0, plDiff: 0 });
  const [loading, setLoading] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [viewEntries, setViewEntries] = useState<EntryRow[]>([]);

  useEffect(() => {
    if (!shiftId && shifts.length > 0) setShiftId(String(shifts[0].id));
  }, [shifts]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchList = async () => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ shiftId, date, mode });
      const res = await apiRequest<{ rows: TransRow[]; totals: typeof totals }>(`/transactions/before-after-declare?${params.toString()}`);
      if (res.data) {
        setRows(res.data.rows);
        setTotals(res.data.totals);
      }
    } catch (err) {
      console.warn('Failed to load trans before/after declare:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, date, mode]);

  const filteredRows = useMemo(() => {
    if (!partySearch.trim()) return rows;
    const term = partySearch.trim().toLowerCase();
    return rows.filter(r => r.partyName.toLowerCase().includes(term));
  }, [rows, partySearch]);

  const handleView = async (id: number) => {
    setViewingId(id);
    try {
      const res = await apiRequest<EntryRow[]>(`/transactions/${id}/entries`);
      if (res.data) setViewEntries(res.data);
    } catch (err) {
      console.warn('Failed to load entries:', err);
      setViewEntries([]);
    }
  };

  const totalAmount = filteredRows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Trans Before-After Declare</span>
        <span className="text-slate-600 font-medium">Shift</span>
        <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase">
          <option value="">-- ALL SHIFT --</option>
          {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-slate-600 font-medium">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
        <select value={mode} onChange={(e) => setMode(e.target.value as 'BEFORE' | 'AFTER')} className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900">
          <option value="BEFORE">Before Declare</option>
          <option value="AFTER">After Declare</option>
        </select>
        <input
          type="text"
          value={partySearch}
          onChange={(e) => setPartySearch(e.target.value)}
          placeholder="Search party..."
          className="w-44 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button type="button" onClick={fetchList} className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs">
          Search (F5)
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-2.5 flex-1">
        <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                  <th className="py-2 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                  <th className="py-2 px-3 border-r border-[#223b63] w-10 text-center">D</th>
                  <th className="py-2 px-3 border-r border-[#223b63]">Party</th>
                  <th className="py-2 px-3 border-r border-[#223b63]">Rate</th>
                  <th className="py-2 px-3 border-r border-[#223b63] text-right">Amount</th>
                  <th className="py-2 px-3 border-r border-[#223b63]">Added</th>
                  <th className="py-2 px-3 border-r border-[#223b63]">Updated</th>
                  <th className="py-2 px-3 text-center w-16">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
                {loading ? (
                  <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
                ) : (
                  filteredRows.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-1.5 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                      <td className="py-1.5 px-3 text-center font-bold text-emerald-700 border-r border-slate-200">{r.isD ? '✓' : ''}</td>
                      <td className="py-1.5 px-3 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                      <td className="py-1.5 px-3 font-mono text-slate-700 border-r border-slate-200">{r.rate}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.amount)}</td>
                      <td className="py-1 px-3 border-r border-slate-200 leading-snug">
                        <div className="font-bold text-slate-900 uppercase text-[11px]">{r.addedBy}</div>
                        <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(r.createdAt)}</div>
                      </td>
                      <td className="py-1 px-3 border-r border-slate-200 leading-snug">
                        <div className="font-bold text-slate-900 uppercase text-[11px]">{r.updatedBy}</div>
                        <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(r.updatedAt)}</div>
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <button type="button" onClick={() => handleView(r.id)} className="px-2.5 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-[10px] rounded">
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr className="bg-[#152847] text-white font-bold text-[11px]">
                    <td colSpan={4} className="py-2 px-3 border-r border-[#223b63]">Total ({filteredRows.length})</td>
                    <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(totalAmount)}</td>
                    <td colSpan={3} className="py-2 px-3"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="border-t border-slate-300 p-2.5 grid grid-cols-3 sm:grid-cols-6 gap-2 bg-white text-center">
            <div>
              <div className="font-mono font-bold text-slate-900">{fmt(totals.saleBefore)}</div>
              <div className="text-[10px] text-slate-500 font-semibold">Sale-Before</div>
            </div>
            <div>
              <div className="font-mono font-bold text-slate-900">{fmt(totals.saleAfter)}</div>
              <div className="text-[10px] text-slate-500 font-semibold">Sale-After</div>
            </div>
            <div>
              <div className="font-mono font-bold text-slate-900">{fmt(totals.saleDiff)}</div>
              <div className="text-[10px] text-slate-500 font-semibold">Sale-Difference</div>
            </div>
            <div>
              <div className={`font-mono font-bold ${totals.plBefore >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(totals.plBefore)}</div>
              <div className="text-[10px] text-slate-500 font-semibold">P&amp;L-Before</div>
            </div>
            <div>
              <div className={`font-mono font-bold ${totals.plAfter >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(totals.plAfter)}</div>
              <div className="text-[10px] text-slate-500 font-semibold">P&amp;L-After</div>
            </div>
            <div>
              <div className="font-mono font-bold text-slate-900">{fmt(totals.plDiff)}</div>
              <div className="text-[10px] text-slate-500 font-semibold">P&amp;L-Difference</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden w-full md:w-64 flex-shrink-0 flex flex-col">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px]">
                <th className="py-2 px-3 border-r border-[#223b63]">Number</th>
                <th className="py-2 px-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {viewingId === null ? (
                <tr><td colSpan={2} className="py-8 text-center text-slate-400 font-medium">Click View on a row.</td></tr>
              ) : viewEntries.length === 0 ? (
                <tr><td colSpan={2} className="py-8 text-center text-slate-400 font-medium">No entries.</td></tr>
              ) : (
                viewEntries.map(e => (
                  <tr key={e.id}>
                    <td className="py-1.5 px-3 font-mono text-slate-800 border-r border-slate-200">{e.numberValue}</td>
                    <td className="py-1.5 px-3 font-mono font-bold text-slate-900">{fmt(e.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="mt-auto p-2.5 flex justify-end border-t border-slate-200">
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('jantri')}
              className="px-4 py-2 bg-[#eab308] hover:bg-[#ca8a04] text-white font-bold text-xs rounded shadow-xs"
            >
              Jantri View (F3)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
