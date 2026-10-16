import React, { useState, useEffect, useRef } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft, X } from 'lucide-react';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface ProductivityReportPageProps {
  shifts?: ShiftDto[];
  onNavigate?: (page: string) => void;
}

interface ProductivityRow {
  staffId: number;
  name: string;
  mobile: string;
  address: string;
  role: string;
  username: string;
  // slips saved (live Free Count)
  freeCount?: number;
  // seconds: Σ gaps longer than D-Min / Σ time on each slip / time at the desk (taken + gaps)
  freeTime: number;
  timeTaken: number;
  tTime: number;
  // number entries / Σ slip amount
  tCount: number;
  tAmount: number;
}

// GET /transactions/productivity-detail — one operator's slips (Name click popup)
interface ProductivitySlip {
  transactionId: number;
  partyName: string;
  shiftName: string;
  startAt: string;
  endAt: string;
  timeTaken: number;
  freeTime: number;
  tCount: number;
  tAmount: number;
  updatedBy: string;
  updatedAt: string;
}

// Summary times as live: hours.minutes — 0.17 (17 min), 1.50 (1 h 50 min); no time → 0
const hm = (sec: number) => {
  const s = Math.max(0, Math.round(sec || 0));
  if (s === 0) return '0';
  return `${Math.floor(s / 3600)}.${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};
// Popup durations as live: 00:00:56
const hms = (sec: number) => {
  const s = Math.max(0, Math.round(sec || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
};
// Popup stamps as live: 16-10-2026 14:31 (stored wall-clock values, printed as stored)
const stamp = (v: string) => {
  if (!v) return '-';
  const [d, t] = v.replace('T', ' ').slice(0, 16).split(' ');
  return `${d.split('-').reverse().join('-')} ${t || ''}`.trim();
};

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST)
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, as live prints them (11245, 415623)
const fmt = (n: number) => String(Math.round(n || 0));

const TH = 'py-2.5 px-3 border-r border-[#223b63]';
const TD = 'py-2 px-3 font-semibold text-slate-700 border-r border-slate-200';
// Live column order: Sr. | Name | Mobile | Address | User Type | User | Free Count | Free Time |
// Time Taken | T-Time | T-Count | T-Amount
const PROD_COLS = [
  { label: 'Sr.', w: 'w-10', align: 'text-center' },
  { label: 'Name', w: 'w-40', align: 'text-center' },
  { label: 'Mobile', w: 'w-20', align: 'text-center' },
  { label: 'Address', w: 'w-20', align: 'text-center' },
  { label: 'User Type', w: 'w-40', align: 'text-center' },
  { label: 'User', w: 'w-20', align: 'text-center' },
  { label: 'Free Count', w: 'w-20', align: 'text-right' },
  { label: 'Free Time', w: 'w-20', align: 'text-right' },
  { label: 'Time Taken', w: 'w-20', align: 'text-right' },
  { label: 'T-Time', w: 'w-20', align: 'text-right' },
  { label: 'T-Count', w: 'w-20', align: 'text-right' },
  { label: 'T-Amount', w: 'w-20', align: 'text-right' },
];

export const ProductivityReportPage: React.FC<ProductivityReportPageProps> = ({ shifts = [], onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [shiftId, setShiftId] = useState('');
  // D-Min: a gap between two of an operator's slips counts as Free Time only when it is longer
  // than this many minutes (blank → Free Time 0, as the live page shows)
  const [dMin, setDMin] = useState('');
  const [rows, setRows] = useState<ProductivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Only the latest Search may fill the table
  const reqRef = useRef(0);
  // Name click → TRANSACTION PRODUCTIVITY REPORT popup (that operator's slips)
  const [detailFor, setDetailFor] = useState<ProductivityRow | null>(null);
  const [detail, setDetail] = useState<ProductivitySlip[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (shiftId) params.append('shiftId', shiftId);
      if (parseFloat(dMin) > 0) params.append('dMin', String(parseFloat(dMin)));
      const res = await apiRequest<ProductivityRow[]>(`/transactions/productivity-report?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      setRows(res.data || []);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load productivity report:', err);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  const openDetail = async (r: ProductivityRow) => {
    setDetailFor(r);
    setDetail([]);
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate, userId: String(r.staffId) });
      if (shiftId) params.append('shiftId', shiftId);
      const res = await apiRequest<ProductivitySlip[]>(`/transactions/productivity-detail?${params.toString()}`);
      setDetail(res.data || []);
    } catch (err) {
      console.warn('Failed to load productivity detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };
  // Esc closes the popup
  useEffect(() => {
    if (!detailFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailFor]);

  // Live flow: the page opens with the cursor on From's day and an empty table; Enter walks
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Shift -> D-Min -> Search, and the report
  // loads on Search (Enter or click) with a spinner on the button.
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
    focusById('prod-fromDate-dd');
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchList();
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Name,Mobile,Address,User Type,User,Free Count,Free Time,Time Taken,T-Time,T-Count,T-Amount'].concat(
        rows.map((r, i) => `${i + 1},"${r.name}","${r.mobile}","${r.address}","${r.role}","${r.username}",${r.freeCount ?? 0},${hm(r.freeTime)},${hm(r.timeTaken)},${hm(r.tTime)},${r.tCount},${fmt(r.tAmount)}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'productivity_report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalTCount = rows.reduce((s, r) => s + r.tCount, 0);
  const totalTAmount = rows.reduce((s, r) => s + r.tAmount, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Productivity Report</span>
            <span className="text-slate-600 font-medium">From</span>
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="prod-fromDate" separator="-" onEnterFromYear={() => focusById('prod-toDate-dd')} />
            <span className="text-slate-600 font-medium">To</span>
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="prod-toDate" separator="-" onEnterFromYear={() => focusById('prod-shift')} />
            <span className="text-slate-600 font-medium">Shift</span>
            <select
              id="prod-shift"
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              onKeyDown={enterTo('prod-dmin')}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">ALL</option>
              {/* only the Active shifts (Master → Shift: Active), as the other shift pickers */}
              {shifts.filter(s => s.isActive !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="text-slate-600 font-medium">D-Min</span>
            <input id="prod-dmin" type="number" value={dMin} onChange={(e) => setDMin(e.target.value)} onKeyDown={enterTo('prod-search-btn')} placeholder="D-Min" className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fde68a]" />
            <button id="prod-search-btn" type="submit" disabled={loading} className="px-10 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
              Search
              {/* Spinner while the report loads, as on live */}
              {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            </button>
          </div>
          <button type="button" onClick={handleExportExcel} className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-auto flex-1 max-h-[calc(100vh-190px)]">
          <table className="w-auto min-w-[1080px] text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                {PROD_COLS.map(c => <th key={c.label} className={`${TH} ${c.w} ${c.align}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={12} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={12} className="py-14" /></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.staffId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
                    <td className={`${TD} text-center`}>{idx + 1}</td>
                    <td
                      className={`${TD} text-center uppercase bg-[#f1f1f1] cursor-pointer hover:text-blue-700 hover:underline`}
                      onClick={() => openDetail(r)}
                      title="Show this user's slips"
                    >
                      {r.name}
                    </td>
                    <td className={`${TD} text-center`}>{r.mobile}</td>
                    <td className={`${TD} text-center uppercase whitespace-normal`}>{r.address}</td>
                    <td className={`${TD} text-center uppercase`}>{r.role}</td>
                    <td className={`${TD} text-center uppercase bg-[#f1f1f1]`}>{r.username}</td>
                    <td className={`${TD} text-right`}>{r.freeCount ?? 0}</td>
                    <td className={`${TD} text-right`}>{hm(r.freeTime)}</td>
                    <td className={`${TD} text-right`}>{hm(r.timeTaken)}</td>
                    <td className={`${TD} text-right`}>{hm(r.tTime)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.tCount)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.tAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Live footer repeats the column names; T-Count / T-Amount carry the totals */}
            {!loading && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  {PROD_COLS.map(c => (
                    <td key={c.label} className={`${TH} ${c.align}`} title={c.label === 'Sr.' ? `${rows.length} users` : undefined}>
                      {c.label === 'T-Count' ? fmt(totalTCount) : c.label === 'T-Amount' ? fmt(totalTAmount) : c.label}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Name click (live): TRANSACTION PRODUCTIVITY REPORT — the user's slips in From–To / Shift */}
      {detailFor && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setDetailFor(null); }}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-10 z-50 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-[1720px] overflow-hidden border border-slate-300 flex flex-col max-h-[85vh]">
            <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight uppercase">Transaction Productivity Report</h2>
              <button type="button" onClick={() => setDetailFor(null)} className="text-white hover:text-slate-300 p-0.5" title="Close (Esc)">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                    <th className={`${TH} w-12 text-left`}>Sr.</th>
                    <th className={`${TH} text-left`}>Party</th>
                    <th className={`${TH} w-28 text-center`}>Shift</th>
                    <th className={`${TH} w-32 text-center`}>Start Time</th>
                    <th className={`${TH} w-24 text-center`}>Time Taken</th>
                    <th className={`${TH} w-32 text-center`}>End Time</th>
                    <th className={`${TH} w-24 text-center`}>Free Time</th>
                    <th className={`${TH} w-20 text-right`}>T-Count</th>
                    <th className={`${TH} w-24 text-right`}>T-Amt</th>
                    <th className={`${TH} w-28 text-center`}>Update By</th>
                    <th className="py-2.5 px-3 w-32 text-center">Update Date</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading ? (
                    <tr><td colSpan={11} className="py-10 text-center text-slate-400">Loading...</td></tr>
                  ) : detail.length === 0 ? (
                    <tr><td colSpan={11} className="py-10 text-center text-slate-400">No slips found.</td></tr>
                  ) : detail.map((d, i) => (
                    <tr key={d.transactionId} className="even:bg-slate-50/60 [&>td]:border-b [&>td]:border-slate-200">
                      <td className={TD}>{i + 1}</td>
                      <td className={`${TD} uppercase`}>{d.partyName}</td>
                      <td className={`${TD} text-center uppercase`}>{d.shiftName}</td>
                      <td className={`${TD} text-center`}>{stamp(d.startAt)}</td>
                      <td className={`${TD} text-center`}>{hms(d.timeTaken)}</td>
                      <td className={`${TD} text-center`}>{stamp(d.endAt)}</td>
                      <td className={`${TD} text-center`}>{hms(d.freeTime)}</td>
                      <td className={`${TD} text-right`}>{d.tCount}</td>
                      <td className={`${TD} text-right`}>{fmt(d.tAmount)}</td>
                      <td className={`${TD} text-center uppercase`}>{d.updatedBy}</td>
                      <td className="py-2 px-3 font-semibold text-slate-700 text-center">{stamp(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
