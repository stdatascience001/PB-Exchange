import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShiftDto, LedgerDto } from '@pb/types';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';
import { PartyPicker } from '../components/PartyPicker.js';

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
  // Live: the page opens on "-- ALL SHIFT --"; Search then asks for a real shift
  const [shiftId, setShiftId] = useState('');
  const [date, setDate] = useState(todayInputDate());
  const [mode, setMode] = useState<'BEFORE' | 'AFTER'>('BEFORE');
  const [partySearch, setPartySearch] = useState('');
  // Party the table is narrowed to — taken from the box on Search (live: typing alone doesn't filter)
  const [appliedParty, setAppliedParty] = useState('');
  const [rows, setRows] = useState<TransRow[]>([]);
  const [totals, setTotals] = useState({ saleBefore: 0, saleAfter: 0, saleDiff: 0, plBefore: 0, plAfter: 0, plDiff: 0 });
  const [loading, setLoading] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [viewEntries, setViewEntries] = useState<EntryRow[]>([]);

  // Only active shifts are offered (as on live) — a shift switched off on Shift Manage's
  // Enable/Disable tab isn't listed. Falls back to the full list if none is active.
  const activeShifts = useMemo(() => {
    const active = shifts.filter(s => s.isActive !== false);
    return active.length > 0 ? active : shifts;
  }, [shifts]);

  // Parties for the Search Party box (lists names starting with the typed text, as on live)
  const [parties, setParties] = useState<LedgerDto[]>([]);
  const partyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    apiRequest<LedgerDto[]>('/ledgers')
      .then(res => { if (res.data) setParties(res.data); })
      .catch(err => console.warn('Failed to load parties:', err));
  }, []);

  const fetchList = async (forShift: string = shiftId) => {
    if (!forShift) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ shiftId: forShift, date, mode });
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

  // Live flow: the page opens on Shift with an empty table; Enter walks Shift -> DD -> MM ->
  // YYYY -> Before/After -> Search Party -> Search, and the list loads on Search (Enter, click
  // or F5) with a spinner on the button. "-- ALL SHIFT --" isn't a shift: Search says so.
  const [hasSearched, setHasSearched] = useState(false);
  const focusById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusById(id);
  };
  useEffect(() => {
    focusById('tbad-shift');
  }, []);

  const handleSearch = () => {
    if (loading) return;
    if (!shiftId) {
      toast.error(
        <div>
          <div className="font-bold text-base">Message</div>
          <div className="text-sm mt-0.5">Please choose a valid shift!</div>
        </div>,
        { toastId: 'tbad-no-shift' }
      );
      focusById('tbad-shift');
      return;
    }
    setHasSearched(true);
    setAppliedParty(partySearch);
    fetchList();
  };

  // Live: picking a shift loads its list straight away (then Enter carries on to the date)
  const handleShiftChange = (value: string) => {
    setShiftId(value);
    if (!value) return;
    setHasSearched(true);
    setAppliedParty(partySearch);
    fetchList(value);
  };
  const searchRef = useRef(handleSearch);
  searchRef.current = handleSearch;

  // F5 = Search (instead of reloading the page), F3 = Jantri View — as the button labels say
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        searchRef.current();
      } else if (e.key === 'F3') {
        e.preventDefault();
        onNavigate && onNavigate('jantri');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNavigate]);

  const filteredRows = useMemo(() => {
    if (!appliedParty.trim()) return rows;
    const term = appliedParty.trim().toLowerCase();
    return rows.filter(r => r.partyName.toLowerCase().includes(term));
  }, [rows, appliedParty]);

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
        <select id="tbad-shift" value={shiftId} onChange={(e) => handleShiftChange(e.target.value)} onKeyDown={enterTo('tbad-date-dd')} className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 min-w-36">
          <option value="">-- ALL SHIFT --</option>
          {activeShifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-slate-600 font-medium">Date</span>
        <DateDMYInput value={date} onChange={setDate} idPrefix="tbad-date" separator="-" onEnterFromYear={() => focusById('tbad-mode')} />
        <select id="tbad-mode" value={mode} onChange={(e) => setMode(e.target.value as 'BEFORE' | 'AFTER')} onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); partyRef.current?.focus(); partyRef.current?.select(); }} className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
          <option value="BEFORE">Before Declare</option>
          <option value="AFTER">After Declare</option>
        </select>
        <div className="w-56">
          <PartyPicker
            parties={parties}
            value={partySearch}
            onChange={setPartySearch}
            onPick={(p) => { setPartySearch(p.partyName); focusById('tbad-search-btn'); }}
            onInvalid={() => focusById('tbad-search-btn')}
            inputRef={partyRef}
            placeholder="SEARCH PARTY..."
            className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase placeholder:text-slate-300 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
          />
        </div>
        <button id="tbad-search-btn" type="button" onClick={handleSearch} disabled={loading} className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
          Search (F5)
          {/* Spinner while the list loads, as on live */}
          {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
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
                ) : !hasSearched ? (
                  null /* live: just the header + 0 total row until a Search */
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
              {/* Live keeps this total row under the header at all times: count, then the amount
                  total (0 / 0 before a Search or when nothing is found) */}
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className="py-2 px-3 border-r border-[#223b63] text-center">{filteredRows.length}</td>
                  <td className="py-2 px-3 border-r border-[#223b63] text-center">D</td>
                  <td className="py-2 px-3 border-r border-[#223b63]">Party</td>
                  <td className="py-2 px-3 border-r border-[#223b63]">Rate</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(totalAmount)}</td>
                  <td className="py-2 px-3 border-r border-[#223b63]">Added</td>
                  <td className="py-2 px-3 border-r border-[#223b63]">Updated</td>
                  <td className="py-2 px-3 text-center">Action</td>
                </tr>
              </tfoot>
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
