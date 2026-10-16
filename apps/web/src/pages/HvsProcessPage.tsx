import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface HvsProcessPageProps {
  onNavigate?: (page: string) => void;
}

interface AgentDto {
  id: number;
  agentName: string;
}

// GET /transactions/hvs-process (TransactionService.getHvsProcessData) — live 11 columns:
// P&L, HP-Amt, Vapsi-Amt, Total = HP + Vapsi, Closing (month-end balance, Dr − Cr),
// T-Settle-Amt = Closing − Total
interface HvsRow {
  partyId: number;
  partyName: string;
  agentName: string;
  mobile: string;
  pnl: number;
  hpAmt: number;
  vapsiAmt: number;
  total: number;
  closing: number;
  tSettleAmt: number;
}

const CALENDAR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Live Year list: 2020 up to next year
const HVS_YEARS = Array.from({ length: new Date().getFullYear() + 1 - 2020 + 1 }, (_, i) => 2020 + i);
const MONTH_INDEX: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST)
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, signed, as the live page prints them (11751, 208054)
const fmt = (n: number) => String(Math.round(n || 0) + 0);
const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">{kind === 'error' ? 'Error' : 'Message'}</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

function monthRange(month: string, year: number) {
  const m = MONTH_INDEX[month] ?? new Date().getMonth();
  const from = new Date(Date.UTC(year, m, 1));
  const to = new Date(Date.UTC(year, m + 1, 0));
  return { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
}

export const HvsProcessPage: React.FC<HvsProcessPageProps> = ({ onNavigate }) => {
  const now = new Date();
  const [month, setMonth] = useState(CALENDAR_MONTHS[now.getMonth()]);
  // Year opens on the list's first year (2020), as the live page does
  const [year, setYear] = useState(HVS_YEARS[0]);
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [agentId, setAgentId] = useState<number | ''>('');
  // every row Load Data returned; `rows` below is what the Party filter leaves of them
  const [allRows, setRows] = useState<HvsRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [processDate, setProcessDate] = useState(todayInputDate());
  const [processing, setProcessing] = useState(false);
  // Only the latest Load Data may fill the table (Month / Agent switched while one is loading)
  const reqRef = useRef(0);

  // the loaded rows (the live page has no Party filter on top of them)
  const rows = allRows;

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<AgentDto[]>('/agents');
        if (res.data) setAgents(res.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Live keyboard flow: the page opens on Month; Enter walks Month -> Year -> Load Data,
  // whose Enter loads the month (spinner beside the button).
  useEffect(() => {
    document.getElementById('hvs-month')?.focus();
  }, []);
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.getElementById(id)?.focus();
  };

  const handleLoadData = async () => {
    if (loading) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const { fromDate, toDate } = monthRange(month, year);
      const params = new URLSearchParams({ fromDate, toDate });
      if (agentId) params.append('agentId', String(agentId));
      const res = await apiRequest<HvsRow[]>(`/transactions/hvs-process?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      setRows(res.data || []);
      setChecked(new Set());
      setLoaded(true);
      if (!res.data || res.data.length === 0) notify('error', 'Record not avaliable!', 'hvs-empty');
    } catch (err: any) {
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load HVS process data:', err);
      notify('error', err?.message || 'Failed to load HVS data', 'hvs-load');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  // Footer sums (live: count, P&L, HP-Amt, Vapsi-Amt, Total, Closing, T-Settle-Amt)
  const totals = useMemo(() => rows.reduce((t, r) => ({
    pnl: t.pnl + r.pnl,
    hpAmt: t.hpAmt + r.hpAmt,
    vapsiAmt: t.vapsiAmt + r.vapsiAmt,
    total: t.total + r.total,
    closing: t.closing + r.closing,
    tSettleAmt: t.tSettleAmt + r.tSettleAmt,
  }), { pnl: 0, hpAmt: 0, vapsiAmt: 0, total: 0, closing: 0, tSettleAmt: 0 }), [rows]);

  const toggleCheck = (partyId: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId); else next.add(partyId);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === rows.length) setChecked(new Set());
    else setChecked(new Set(rows.map(r => r.partyId)));
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['SR,Party Name,Agent,Mobile,P&L,HP-Amt,Vapsi-Amt,Total,Closing,T-Settle-Amt'].concat(
        rows.map((r, i) => `${i + 1},"${r.partyName}","${r.agentName}","${r.mobile}",${fmt(r.pnl)},${fmt(r.hpAmt)},${fmt(r.vapsiAmt)},${fmt(r.total)},${fmt(r.closing)},${fmt(r.tSettleAmt)}`),
        [`${rows.length},,,,${fmt(totals.pnl)},${fmt(totals.hpAmt)},${fmt(totals.vapsiAmt)},${fmt(totals.total)},${fmt(totals.closing)},${fmt(totals.tSettleAmt)}`]
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'hvs_process.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Go-Process: every checked party's T-Settle-Amt posted as one settlement entry, all in a
  // single database transaction (POST /transactions/hvs-process) — every entry or none
  const handleGoProcess = async () => {
    if (processing) return;
    const targets = rows.filter(r => checked.has(r.partyId) && Math.round(r.tSettleAmt) !== 0);
    if (targets.length === 0) {
      notify('error', 'Please check at least one party with a T-Settle amount!', 'hvs-tick');
      return;
    }
    if (!processDate) return notify('error', 'Please select Date!', 'hvs-date');
    if (!window.confirm(`Settle ${targets.length} checked part(ies) for their T-Settle-Amt?`)) return;
    setProcessing(true);
    try {
      const res = await apiRequest<{ posted: number }>('/transactions/hvs-process', {
        method: 'POST',
        body: JSON.stringify({
          month: (MONTH_INDEX[month] ?? 0) + 1,
          year,
          voucherDate: processDate,
          items: targets.map(t => ({ partyId: t.partyId, amount: Math.round(t.tSettleAmt) })),
        }),
      });
      notify('success', `${res.data?.posted || targets.length} part(ies) processed successfully!`, `hvs-ok-${Date.now()}`);
      handleLoadData();
    } catch (err: any) {
      notify('error', err.message || 'Failed to process selected parties');
    } finally {
      setProcessing(false);
    }
  };

  const th = 'py-2.5 px-3 border-r border-[#223b63]';
  const td = 'py-2 px-3 font-semibold text-slate-700 border-r border-slate-200';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">HVS Process</span>

        <span className="font-bold text-sm text-slate-900">Month</span>
        <select id="hvs-month" value={month} onChange={(e) => setMonth(e.target.value)} onKeyDown={enterTo('hvs-year')} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400">
          {Object.keys(MONTH_INDEX).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select id="hvs-year" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} onKeyDown={enterTo('hvs-load-btn')} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400">
          {HVS_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <button
          id="hvs-load-btn"
          type="button"
          onClick={handleLoadData}
          className="px-4 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          Load Data
        </button>
        {/* Spinner beside Load Data while the month loads, as on live */}
        {loading && <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />}

        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value ? parseInt(e.target.value, 10) : '')}
          className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase"
        >
          <option value="">-- ALL AGENT --</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
        </select>

        <button type="button" onClick={handleExportExcel} className="ml-auto px-4 py-1 bg-[#15803d] hover:bg-[#166534] text-white font-bold text-xs rounded shadow-xs">
          Excel
        </button>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1 max-h-[calc(100vh-230px)]">
          <table className="w-full text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className={`${th} w-10 text-center`}>SR</th>
                <th className={`${th} w-10 text-center`}>
                  <input type="checkbox" checked={rows.length > 0 && checked.size === rows.length} onChange={toggleAll} />
                </th>
                <th className={`${th}`}>Party Name</th>
                <th className={`${th} text-center`}>Agent</th>
                <th className={`${th} text-center`}>Mobile</th>
                <th className={`${th} text-right`}>P&amp;L</th>
                <th className={`${th} text-right`}>HP-Amt</th>
                <th className={`${th} text-right`}>Vapsi-Amt</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={`${th} text-right`}>Closing</th>
                <th className={`${th} text-right`}>T-Settle-Amt</th>
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !loaded ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">Choose Month/Year and click Load Data.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">No records found for this period.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.partyId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
                    <td className={`${td} text-center`}>{idx + 1}</td>
                    <td className={`${td} text-center`}>
                      <input type="checkbox" checked={checked.has(r.partyId)} onChange={() => toggleCheck(r.partyId)} />
                    </td>
                    <td className={`${td} uppercase bg-[#f1f1f1]`}>{r.partyName}</td>
                    <td className={`${td} text-center uppercase`}>{r.agentName}</td>
                    <td className={`${td} text-center`}>{r.mobile}</td>
                    <td className={`${td} text-right`}>{fmt(r.pnl)}</td>
                    <td className={`${td} text-right`}>{fmt(r.hpAmt)}</td>
                    <td className={`${td} text-right`}>{fmt(r.vapsiAmt)}</td>
                    <td className={`${td} text-right`}>{fmt(r.total)}</td>
                    <td className={`${td} text-right`}>{fmt(r.closing)}</td>
                    <td className={`${td} text-right`}>{fmt(r.tSettleAmt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && loaded && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className={`${th} text-center`}>{rows.length}</td>
                  <td className={`${th} text-center`}>-</td>
                  <td className={th}>Party Name</td>
                  <td className={`${th} text-center`}>Agent</td>
                  <td className={`${th} text-center`}>Mobile</td>
                  <td className={`${th} text-right`}>{fmt(totals.pnl)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.hpAmt)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.vapsiAmt)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.total)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.closing)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.tSettleAmt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="border-t border-slate-300 p-2.5 flex flex-wrap items-end gap-3 bg-white">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Date</label>
            <DateDMYInput value={processDate} onChange={setProcessDate} idPrefix="hvs-pdate" />
          </div>
          <button
            type="button"
            onClick={handleGoProcess}
            disabled={processing}
            className="px-6 py-2 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Go-Process'}
          </button>
        </div>
      </div>
    </div>
  );
};
