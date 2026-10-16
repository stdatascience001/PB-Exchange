import React, { useState, useEffect, useRef } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft, X } from 'lucide-react';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface ProductivityAuditPageProps {
  shifts?: ShiftDto[];
  onNavigate?: (page: string) => void;
}

interface ProductivityAuditRow {
  staffId: number;
  name: string;
  mobile: string;
  address: string;
  role: string;
  username?: string;
  tParty: number;
  tCount: number;
  valid: number;
  mistake: number;
  modify: number;
  tAmount: number;
}

// GET /transactions/productivity-audit/detail — one auditor's verdicts (Name click popup)
interface AuditVerdict {
  transactionId: number;
  partyName: string;
  shiftName: string;
  auditedAt: string;
  diffSeconds: number | null;
  status: string;
  remark: string;
  modified: boolean;
  tAmount: number;
  updatedBy: string;
  updatedAt: string;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST)
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, as live prints them (11, 39870)
const fmt = (n: number) => String(Math.round(n || 0));
// Popup durations as live: 00:00:45; the first verdict reads START
const hms = (sec: number | null) => {
  if (sec === null) return 'START';
  const s = Math.max(0, Math.round(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
};
// Popup stamps as live: 16-10-2026 19:11 (stored wall-clock values, printed as stored)
const stamp = (v: string) => {
  if (!v) return '-';
  const [d, t] = v.replace('T', ' ').slice(0, 16).split(' ');
  return `${d.split('-').reverse().join('-')} ${t || ''}`.trim();
};
const TH = 'py-2.5 px-3 border-r border-[#223b63]';
const TD = 'py-2 px-3 font-semibold text-slate-700 border-r border-slate-200';
// Live column order (12): Sr. | Name | Mobile | Address | User Type | User | T-Party | T-Count |
// Valid | Mistake | Modify | T-Amount
const AUDIT_COLS = ['Sr.', 'Name', 'Mobile', 'Address', 'User Type', 'User', 'T-Party', 'T-Count', 'Valid', 'Mistake', 'Modify', 'T-Amount'];

export const ProductivityAuditPage: React.FC<ProductivityAuditPageProps> = ({ shifts = [], onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [shiftId, setShiftId] = useState('');
  const [rows, setRows] = useState<ProductivityAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Only the latest Search may fill the table
  const reqRef = useRef(0);
  // Name click → TRANSACTION PRODUCTIVITY REPORT popup (that auditor's verdicts)
  const [detailFor, setDetailFor] = useState<ProductivityAuditRow | null>(null);
  const [detail, setDetail] = useState<AuditVerdict[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (shiftId) params.append('shiftId', shiftId);
      const res = await apiRequest<ProductivityAuditRow[]>(`/transactions/productivity-audit?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      setRows(res.data || []);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load productivity audit:', err);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  const openDetail = async (r: ProductivityAuditRow) => {
    setDetailFor(r);
    setDetail([]);
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate, userId: String(r.staffId) });
      if (shiftId) params.append('shiftId', shiftId);
      const res = await apiRequest<AuditVerdict[]>(`/transactions/productivity-audit/detail?${params.toString()}`);
      setDetail(res.data || []);
    } catch (err) {
      console.warn('Failed to load productivity audit detail:', err);
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
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Shift -> Search, and the report loads on
  // Search (Enter or click) with a spinner on the button.
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
    focusById('prodaudit-fromDate-dd');
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
      ['Sr,Name,Mobile,Address,User Type,User,T-Party,T-Count,Valid,Mistake,Modify,T-Amount'].concat(
        rows.map((r, i) => `${i + 1},"${r.name}","${r.mobile}","${r.address}","${r.role}","${r.username || ''}",${r.tParty},${r.tCount},${r.valid},${r.mistake},${r.modify},${fmt(r.tAmount)}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'productivity_audit.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Productivity Audit</span>
            <span className="text-slate-600 font-medium">From</span>
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="prodaudit-fromDate" separator="-" onEnterFromYear={() => focusById('prodaudit-toDate-dd')} />
            <span className="text-slate-600 font-medium">To</span>
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="prodaudit-toDate" separator="-" onEnterFromYear={() => focusById('prodaudit-shift')} />
            <span className="text-slate-600 font-medium">Shift</span>
            <select
              id="prodaudit-shift"
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              onKeyDown={enterTo('prodaudit-search-btn')}
              className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">ALL</option>
              {/* only the Active shifts (Master → Shift: Active), as the other shift pickers */}
              {shifts.filter(s => s.isActive !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button id="prodaudit-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
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
          <table className="w-auto min-w-[1200px] text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                {AUDIT_COLS.map((c, ci) => (
                  <th key={c} className={`${TH} ${ci === 0 ? 'w-10' : ci < 6 ? 'w-40' : 'w-20'} ${ci >= 6 ? 'text-right' : 'text-center'}`}>{c}</th>
                ))}
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
                      title="Show this auditor's Valid / Mistake list"
                    >
                      {r.name}
                    </td>
                    <td className={`${TD} text-center`}>{r.mobile}</td>
                    <td className={`${TD} text-center uppercase`}>{r.address}</td>
                    <td className={`${TD} text-center uppercase`}>{r.role}</td>
                    <td className={`${TD} text-center uppercase bg-[#f1f1f1]`}>{r.username || '-'}</td>
                    <td className={`${TD} text-right`}>{fmt(r.tParty)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.tCount)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.valid)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.mistake)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.modify)}</td>
                    <td className={`${TD} text-right`}>{fmt(r.tAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Live footer repeats the column names */}
            {!loading && hasSearched && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  {AUDIT_COLS.map((c, ci) => (
                    <td key={c} className={`${TH} ${ci >= 6 ? 'text-right' : 'text-center'}`}>{c}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Name click (live): TRANSACTION PRODUCTIVITY REPORT — the auditor's verdicts in time order */}
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
                    <th className={`${TH} w-32 text-center`}>Added Time</th>
                    <th className={`${TH} w-24 text-center`}>Diff Time</th>
                    <th className={`${TH} w-20 text-center`}>Status</th>
                    <th className={`${TH} w-24 text-right`}>T-Amount</th>
                    <th className={`${TH} w-28 text-center`}>Update By</th>
                    <th className="py-2.5 px-3 w-32 text-center">Update Date</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading ? (
                    <tr><td colSpan={9} className="py-10 text-center text-slate-400">Loading...</td></tr>
                  ) : detail.length === 0 ? (
                    <tr><td colSpan={9} className="py-10 text-center text-slate-400">No audits found.</td></tr>
                  ) : detail.map((d, i) => {
                    const mistake = d.status === 'MISTAKE';
                    return (
                      <tr key={d.transactionId} className="even:bg-slate-50/60 [&>td]:border-b [&>td]:border-slate-200">
                        <td className={TD}>{i + 1}</td>
                        {/* live: a MISTAKE slip's party in red */}
                        <td className={`${TD} uppercase ${mistake ? '!text-red-600 font-bold' : ''}`}>{d.partyName}</td>
                        <td className={`${TD} text-center uppercase`}>{d.shiftName}</td>
                        <td className={`${TD} text-center`}>{stamp(d.auditedAt)}</td>
                        <td className={`${TD} text-center`}>{hms(d.diffSeconds)}</td>
                        <td className={`${TD} text-center`}>
                          {/* live: the Mistake remark shows on hover */}
                          <span
                            title={mistake && d.remark ? d.remark : undefined}
                            className={`inline-block px-2 py-0.5 rounded-xs text-[9px] font-bold text-white ${mistake ? 'bg-red-600' : 'bg-[#00897b]'}`}
                          >
                            {mistake ? 'MISTAKE' : 'VALID'}
                          </span>
                        </td>
                        <td className={`${TD} text-right`}>{fmt(d.tAmount)}</td>
                        <td className={`${TD} text-center uppercase`}>{d.updatedBy}</td>
                        <td className="py-2 px-3 font-semibold text-slate-700 text-center">{stamp(d.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
