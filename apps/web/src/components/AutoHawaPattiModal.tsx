import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';
import { VAPSI_MONTHS, vapsiYears } from './AutoVapsiModal.js';

// One party of GET /transactions/hawa-patti-summary (TransactionService.getHawaPattiSummary)
interface HpRow {
  partyId: number;
  partyName: string;
  agentName: string;
  hpPartyId: number;
  hpPartyName: string;
  isHp: boolean;
  wDay: number;
  tSale: number;
  pnl: number;
  hpPct: number;
  hpAmt: number;
}

interface AgentOption { id: number; agentName: string }

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (n: number) => String(Math.round(n || 0));
const dmy = (ymd: string) => ymd.split('-').reverse().join(' / ');

const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

// Hawa Patti page's "Auto Hawa Patti (F3)" popup: Month / Year (+ Agent, On Base), Search lists
// each party's month — HP Party Name, IsHP, W-Day, T-Sale, P&L, HP %, HP-Amt (editable) — tick
// parties and Process Voucher posts each HP-Amt against HP A/C on the Voucher Date.
export const AutoHawaPattiModal: React.FC<{ open: boolean; onClose: () => void; onProcessed: () => void }> = ({ open, onClose, onProcessed }) => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState('');
  const [onBase, setOnBase] = useState(false);
  const [rows, setRows] = useState<HpRow[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [voucherDate, setVoucherDate] = useState(todayLocal());
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setTicked(new Set());
    setAmounts({});
    setVoucherDate(todayLocal());
    if (agents.length === 0) {
      apiRequest<AgentOption[]>('/agents')
        .then(res => res.data && setAgents([...res.data].sort((a, b) => a.agentName.localeCompare(b.agentName))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Live Enter flow: opens on Month; Enter walks Month -> Year -> Agents -> Search, and Enter
  // on Search searches
  const focusAh = (id: string) => (document.getElementById(id) as HTMLElement | null)?.focus();
  const ahEnterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusAh(id);
  };
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => focusAh('ah-month'));
    return () => cancelAnimationFrame(id);
  }, [open]);
  // A click on the dimmed area outside the box closes it (as Esc / X do)
  const backdropDownRef = useRef(false);

  const search = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year), onBase: onBase ? '1' : '0' });
      if (agentId) params.append('agentId', agentId);
      const res = await apiRequest<{ rows: HpRow[]; from: string; to: string }>(`/transactions/hawa-patti-summary?${params.toString()}`);
      const list = res.data?.rows || [];
      setRows(list);
      setRange(res.data ? { from: res.data.from, to: res.data.to } : null);
      setAmounts(Object.fromEntries(list.map(r => [r.partyId, String(Math.round(r.hpAmt))])));
      setTicked(new Set());
      if (list.length === 0) notify('error', 'Record not found!', 'auto-hp-none');
    } catch (err: any) {
      notify('error', err.message || 'Failed to load hawa patti', 'auto-hp-load');
    } finally {
      setLoading(false);
    }
  };

  const amountOf = (r: HpRow) => parseFloat(amounts[r.partyId] ?? String(r.hpAmt)) || 0;
  // Only HP parties with an HP amount can be processed.
  const tickable = rows.filter(r => r.isHp && amountOf(r) !== 0);
  const allTicked = tickable.length > 0 && tickable.every(r => ticked.has(r.partyId));
  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(tickable.map(r => r.partyId)));
  const toggle = (id: number) => setTicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const totals = useMemo(() => rows.reduce((t, r) => ({
    tSale: t.tSale + r.tSale, pnl: t.pnl + r.pnl, hpAmt: t.hpAmt + amountOf(r),
  }), { tSale: 0, pnl: 0, hpAmt: 0 }), [rows, amounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const processVoucher = async () => {
    const chosen = rows.filter(r => ticked.has(r.partyId) && r.isHp && amountOf(r) !== 0);
    if (chosen.length === 0) return notify('error', 'Please tick at least one party!', 'auto-hp-tick');
    if (!voucherDate) return notify('error', 'Please select Voucher Date!', 'auto-hp-date');
    setProcessing(true);
    try {
      const res = await apiRequest<{ posted: number }>('/transactions/hawa-patti-process', {
        method: 'POST',
        body: JSON.stringify({
          month, year, voucherDate,
          items: chosen.map(r => ({ hpPartyId: r.hpPartyId, amount: amountOf(r), partyName: r.partyName })),
        }),
      });
      notify('success', `${res.data?.posted || 0} Hawa Patti Voucher has been processed successfully!`, `auto-hp-ok-${Date.now()}`);
      setTicked(new Set());
      onProcessed();
    } catch (err: any) {
      notify('error', err.message || 'Process Voucher failed');
    } finally {
      setProcessing(false);
    }
  };

  if (!open) return null;

  const th = 'py-2.5 px-2 border-r border-[#2b446f] font-bold text-[12px] whitespace-nowrap';
  const td = 'py-1.5 px-2 border-r border-slate-200 font-semibold text-slate-700';
  const sel = 'px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-bold text-slate-800 cursor-pointer focus:outline-none focus:bg-[#fde68a]';

  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-10 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-[1720px] overflow-hidden border border-slate-300 flex flex-col h-[85vh]">
        <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight">
            Auto Hawa Patti Voucher{range ? ` | ${dmy(range.from)} - ${dmy(range.to)}` : ''}
          </h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-300 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="px-3 py-2 flex flex-wrap items-center gap-4 text-xs border-b border-slate-200">
          <span className="font-semibold text-slate-600">Month</span>
          <select id="ah-month" onKeyDown={ahEnterTo('ah-year')} value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className={`${sel} w-32`}>
            {VAPSI_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select id="ah-year" onKeyDown={ahEnterTo('ah-agent')} value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className={`${sel} w-32`}>
            {vapsiYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="font-semibold text-slate-600">Agents</span>
          <select id="ah-agent" onKeyDown={ahEnterTo('ah-search-btn')} value={agentId} onChange={(e) => setAgentId(e.target.value)} className={`${sel} w-32`}>
            <option value="">-- ALL --</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
          </select>
          <button id="ah-search-btn" type="submit" disabled={loading} className="px-10 py-2 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded-xs disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1662c6]">
            {loading ? 'Searching...' : 'Search'}
          </button>
          <label className="ml-16 flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer" title="P&L before commission (Sale − Payout)">
            <input type="checkbox" checked={onBase} onChange={(e) => setOnBase(e.target.checked)} /> On Base
          </label>
          <button
            type="button"
            onClick={() => {
              if (rows.length === 0) return notify('error', 'Record not found!', 'auto-hp-excel');
              const lines = ['Sr,Agent,Party Name,HP Party Name,IsHP,W-Day,T-Sale,P&L,HP %,HP-Amt'];
              rows.forEach((r, i) => lines.push(`${i + 1},"${r.agentName}","${r.partyName}","${r.hpPartyName}",${r.isHp ? 'YES' : 'NO'},${r.wDay},${fmt(r.tSale)},${fmt(r.pnl)},${r.hpPct},${fmt(amountOf(r))}`));
              const link = document.createElement('a');
              link.setAttribute('href', encodeURI('data:text/csv;charset=utf-8,' + lines.join('\n')));
              link.setAttribute('download', `auto_hawa_patti_${VAPSI_MONTHS[month - 1]}_${year}.csv`);
              document.body.appendChild(link); link.click(); document.body.removeChild(link);
            }}
            className="ml-auto px-11 py-2 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded-xs"
          >
            Excel
          </button>
        </form>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white">
                <th className={`${th} w-12 text-left`}>Sr</th>
                <th className={`${th} w-11 text-center`}>
                  <input type="checkbox" checked={allTicked} onChange={toggleAll} disabled={tickable.length === 0} className="h-4 w-4 cursor-pointer align-middle" title="Tick all" />
                </th>
                <th className={`${th} w-32 text-center`}>Agent</th>
                <th className={`${th} text-left`}>Party Name</th>
                <th className={`${th} text-left w-64`}>HP Party Name</th>
                <th className={`${th} w-14`}>IsHP</th>
                <th className={`${th} w-20`}>W-Day</th>
                <th className={`${th} w-24`}>T-Sale</th>
                <th className={`${th} w-24`}>P&amp;L</th>
                <th className={`${th} w-16`}>HP %</th>
                <th className="py-2.5 px-2 font-bold text-[12px] w-28">HP-Amt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.partyId} className={`[&>td]:border-b [&>td]:border-slate-200 ${ticked.has(r.partyId) ? 'bg-blue-50/80' : 'even:bg-slate-50/60'}`}>
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} text-center`}>
                    <input
                      type="checkbox"
                      checked={ticked.has(r.partyId)}
                      disabled={!r.isHp || amountOf(r) === 0}
                      onChange={() => toggle(r.partyId)}
                      className="h-4 w-4 cursor-pointer"
                    />
                  </td>
                  <td className={`${td} text-center uppercase`}>{r.agentName}</td>
                  <td className={`${td} uppercase`}>{r.partyName}</td>
                  <td className={`${td} uppercase`}>{r.hpPartyName}</td>
                  <td className={`${td} text-center`}>
                    <span className={`px-2 py-0.5 rounded-xs text-[9px] font-bold text-white ${r.isHp ? 'bg-[#00897b]' : 'bg-slate-400'}`}>{r.isHp ? 'YES' : 'NO'}</span>
                  </td>
                  <td className={`${td} text-center`}>{r.wDay}</td>
                  <td className={`${td} text-right`}>{fmt(r.tSale)}</td>
                  <td className={`${td} text-right`}>{fmt(r.pnl)}</td>
                  <td className={`${td} text-center`}>{r.hpPct}</td>
                  <td className="py-1 px-1.5">
                    <input
                      type="number"
                      value={amounts[r.partyId] ?? ''}
                      disabled={!r.isHp}
                      onChange={(e) => setAmounts(prev => ({ ...prev, [r.partyId]: e.target.value }))}
                      className="w-full px-2 py-1 bg-white border border-slate-300 rounded-xs text-right font-semibold focus:outline-none focus:bg-[#fde68a] disabled:bg-slate-50"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#152847] text-white font-bold text-[12px]">
                  <td className={th}>{rows.length}</td>
                  <td className={`${th} text-center`}>Tik</td>
                  <td className={th}>Agent</td>
                  <td className={th}>Party Name</td>
                  <td className={th}>HP Party Name</td>
                  <td className={th}>IsHP</td>
                  <td className={th}>W-Day</td>
                  <td className={`${th} text-right`}>{fmt(totals.tSale)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.pnl)}</td>
                  <td className={th}>HP %</td>
                  <td className="py-2.5 px-2 text-right">{fmt(totals.hpAmt)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="flex items-center justify-end gap-4 px-4 py-3 border-t border-slate-200">
          <span className="font-bold text-sm text-slate-700">Voucher Date</span>
          <input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className="px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-semibold" />
          <button type="button" onClick={processVoucher} disabled={processing} className="px-4 py-2 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold rounded-xs text-xs disabled:opacity-50">
            {processing ? 'Processing...' : 'Process Voucher'}
          </button>
        </div>
      </div>
    </div>
  );
};
