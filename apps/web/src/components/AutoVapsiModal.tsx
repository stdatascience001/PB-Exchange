import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';

export const VAPSI_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Years offered by the Month/Year pickers: 2020 (live's first) up to next year.
export const vapsiYears = () => {
  const now = new Date().getFullYear();
  return Array.from({ length: now + 2 - 2020 }, (_, i) => 2020 + i);
};

// One party of GET /transactions/vapsi-summary (TransactionService.getVapsiSummary).
export interface VapsiSummaryRow {
  partyId: number;
  partyName: string;
  agentName: string;
  tpv: number;
  wDay: number;
  tSale: number;
  pnl: number;
  hissaPct: number;
  hpAmt: number;
  finalPl: number;
  payment: number;
  vapsiPct: number;
  vapsiAmt: number;
  done: boolean;
  thirdParties: { partyName: string; ledgerId: number | null; percent: number }[];
}

interface AgentOption { id: number; agentName: string }

interface AutoVapsiModalProps {
  open: boolean;
  onClose: () => void;
  onProcessed: () => void;
}

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (n: number) => String(Math.round(n || 0));

const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

// Vapsi Voucher page's "Auto Vapsi (F3)" popup: pick Month / Year (+ Agent, With HP A/Cs,
// On Base), Search lists each party's month — TPV, W-Day, T-Sale, P&L, Hissa%, HP-Amt,
// Final-PL, Payment, Vapsi%, Vapsi-Amt — tick parties (header box ticks all) and Process
// Voucher posts their Vapsi (and their 3rd-party rebates) on the Voucher Date.
export const AutoVapsiModal: React.FC<AutoVapsiModalProps> = ({ open, onClose, onProcessed }) => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState('');
  const [withHp, setWithHp] = useState(false);
  const [onBase, setOnBase] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'DONE'>('ALL');
  const [rows, setRows] = useState<VapsiSummaryRow[]>([]);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [voucherDate, setVoucherDate] = useState(todayLocal());
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setTicked(new Set());
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

  // Live Enter flow: opens on Month; Enter walks Month -> Year -> Agents -> With HP A/Cs ->
  // Search, and Enter on Search searches
  const focusAv = (id: string) => (document.getElementById(id) as HTMLElement | null)?.focus();
  const avEnterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusAv(id);
  };
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => focusAv('av-month'));
    return () => cancelAnimationFrame(id);
  }, [open]);
  // A click on the dimmed area outside the box closes it (as Esc / X do)
  const backdropDownRef = useRef(false);

  const search = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year), withHp: withHp ? '1' : '0', onBase: onBase ? '1' : '0' });
      if (agentId) params.append('agentId', agentId);
      const res = await apiRequest<{ rows: VapsiSummaryRow[] }>(`/transactions/vapsi-summary?${params.toString()}`);
      setRows(res.data?.rows || []);
      setTicked(new Set());
      // Live: "Error / Vapsi not available of party!" when the month has nothing to vapsi
      if (!res.data?.rows?.length) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Vapsi not available of party!</div>
          </div>,
          { toastId: 'auto-vapsi-none' }
        );
      }
    } catch (err: any) {
      notify('error', err.message || 'Failed to load vapsi', 'auto-vapsi-load');
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(
    () => rows.filter(r => filter === 'ALL' || (filter === 'DONE' ? r.done : !r.done)),
    [rows, filter]
  );
  // Only parties with a Vapsi amount can be processed.
  const tickable = visible.filter(r => r.vapsiAmt > 0);
  const allTicked = tickable.length > 0 && tickable.every(r => ticked.has(r.partyId));
  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(tickable.map(r => r.partyId)));
  const toggle = (id: number) => setTicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const totals = useMemo(() => visible.reduce((t, r) => ({
    tSale: t.tSale + r.tSale, pnl: t.pnl + r.pnl, hpAmt: t.hpAmt + r.hpAmt, finalPl: t.finalPl + r.finalPl,
    payment: t.payment + r.payment, vapsiAmt: t.vapsiAmt + (ticked.has(r.partyId) ? r.vapsiAmt : 0),
  }), { tSale: 0, pnl: 0, hpAmt: 0, finalPl: 0, payment: 0, vapsiAmt: 0 }), [visible, ticked]);

  const processVoucher = async () => {
    const chosen = rows.filter(r => ticked.has(r.partyId) && r.vapsiAmt > 0);
    if (chosen.length === 0) return notify('error', 'Please tick at least one party!', 'auto-vapsi-tick');
    if (!voucherDate) return notify('error', 'Please select Voucher Date!', 'auto-vapsi-date');
    const already = chosen.filter(r => r.done).map(r => r.partyName);
    if (already.length && !window.confirm(`Vapsi for ${VAPSI_MONTHS[month - 1]} ${year} is already posted for: ${already.join(', ')}.\nPost again?`)) return;
    setProcessing(true);
    try {
      const base = (r: VapsiSummaryRow) => (onBase ? r.payment : r.finalPl);
      const res = await apiRequest<{ posted: number }>('/transactions/vapsi-process', {
        method: 'POST',
        body: JSON.stringify({
          month, year, voucherDate,
          items: chosen.map(r => ({
            partyId: r.partyId,
            amount: Math.round(r.vapsiAmt * 100) / 100,
            thirdParties: r.thirdParties
              .filter(t => t.ledgerId)
              .map(t => ({ ledgerId: t.ledgerId, amount: Math.round(Math.max(0, base(r)) * t.percent) / 100 })),
          })),
        }),
      });
      notify('success', `${res.data?.posted || 0} Vapsi Voucher has been processed successfully!`, `auto-vapsi-ok-${Date.now()}`);
      onProcessed();
      search();
    } catch (err: any) {
      notify('error', err.message || 'Process Voucher failed');
    } finally {
      setProcessing(false);
    }
  };

  if (!open) return null;

  const th = 'py-2.5 px-2 border-r border-[#2b446f] font-bold text-[12px] whitespace-nowrap';
  const td = 'py-1.5 px-2 border-r border-slate-200 font-semibold text-slate-700 text-right';
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
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-[1700px] overflow-hidden border border-slate-300 flex flex-col h-[85vh]">
        <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight">Auto Vapsi Voucher |</h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-300 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="px-3 py-2 flex flex-wrap items-center gap-4 text-xs border-b border-slate-200">
          <span className="font-semibold text-slate-600">Month</span>
          <select id="av-month" onKeyDown={avEnterTo('av-year')} value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className={`${sel} w-32`}>
            {VAPSI_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select id="av-year" onKeyDown={avEnterTo('av-agent')} value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className={`${sel} w-32`}>
            {vapsiYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="font-semibold text-slate-600">Agents</span>
          <select id="av-agent" onKeyDown={avEnterTo('av-withhp')} value={agentId} onChange={(e) => setAgentId(e.target.value)} className={`${sel} w-32`}>
            <option value="">-- ALL --</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
          </select>
          <label className="flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
            <input id="av-withhp" onKeyDown={avEnterTo('av-search-btn')} type="checkbox" checked={withHp} onChange={(e) => setWithHp(e.target.checked)} /> With HP A/Cs
          </label>
          <button id="av-search-btn" type="submit" disabled={loading} className="px-10 py-2 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded-xs disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1662c6]">
            {loading ? 'Searching...' : 'Search'}
          </button>
          <span className="font-semibold text-slate-600">Filter</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as 'ALL' | 'PENDING' | 'DONE')} className={`${sel} w-32`}>
            <option value="ALL">ALL</option>
            <option value="PENDING">PENDING</option>
            <option value="DONE">DONE</option>
          </select>
          <label className="flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer" title="Vapsi on Payment instead of Final-PL">
            <input type="checkbox" checked={onBase} onChange={(e) => setOnBase(e.target.checked)} /> On Base
          </label>
          <button
            type="button"
            onClick={() => {
              if (visible.length === 0) return notify('error', 'Record not found!', 'auto-vapsi-excel');
              const lines = ['Sr,Agent,Party Name,TPV,W-Day,T-Sale,P&L,Hissa%,HP-Amt,Final-PL,Payment,Vapsi%,Vapsi-Amt'];
              visible.forEach((r, i) => lines.push(`${i + 1},"${r.agentName}","${r.partyName}",${r.tpv},${r.wDay},${fmt(r.tSale)},${fmt(r.pnl)},${r.hissaPct},${fmt(r.hpAmt)},${fmt(r.finalPl)},${fmt(r.payment)},${r.vapsiPct},${fmt(r.vapsiAmt)}`));
              const link = document.createElement('a');
              link.setAttribute('href', encodeURI('data:text/csv;charset=utf-8,' + lines.join('\n')));
              link.setAttribute('download', `auto_vapsi_${VAPSI_MONTHS[month - 1]}_${year}.csv`);
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
                <th className={th}>TPV</th>
                <th className={th}>W-Day</th>
                <th className={th}>T-Sale</th>
                <th className={th}>P&amp;L</th>
                <th className={th}>Hissa%</th>
                <th className={th}>HP-Amt</th>
                <th className={th}>Final-PL</th>
                <th className={th}>Payment</th>
                <th className={th}>Vapsi%</th>
                <th className={`${th} w-11 text-center`}>
                  <input type="checkbox" checked={allTicked} onChange={toggleAll} disabled={tickable.length === 0} className="h-4 w-4 cursor-pointer align-middle" title="Tick all" />
                </th>
                <th className="py-2.5 px-2 font-bold text-[12px]">Vapsi-Amt</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const canTick = r.vapsiAmt > 0;
                const box = (
                  <input type="checkbox" checked={ticked.has(r.partyId)} disabled={!canTick} onChange={() => toggle(r.partyId)} className="h-4 w-4 cursor-pointer" />
                );
                return (
                  <tr key={r.partyId} className={`[&>td]:border-b [&>td]:border-slate-200 ${ticked.has(r.partyId) ? 'bg-blue-50/80' : 'even:bg-slate-50/60'} ${r.done ? 'text-emerald-700' : ''}`}>
                    <td className={`${td} !text-left`}>{i + 1}</td>
                    <td className={`${td} !text-center`}>{box}</td>
                    <td className={`${td} !text-center uppercase`}>{r.agentName}</td>
                    <td className={`${td} !text-left uppercase`}>{r.partyName}{r.done && <span className="ml-1.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px]">DONE</span>}</td>
                    <td className={td}>{r.tpv}</td>
                    <td className={td}>{r.wDay}</td>
                    <td className={td}>{fmt(r.tSale)}</td>
                    <td className={td}>{fmt(r.pnl)}</td>
                    <td className={td}>{r.hissaPct}</td>
                    <td className={td}>{fmt(r.hpAmt)}</td>
                    <td className={td}>{fmt(r.finalPl)}</td>
                    <td className={td}>{fmt(r.payment)}</td>
                    <td className={td}>{r.vapsiPct}</td>
                    <td className={`${td} !text-center`}>{box}</td>
                    <td className="py-1.5 px-2 font-bold text-slate-800 text-right">{fmt(r.vapsiAmt)}</td>
                  </tr>
                );
              })}
            </tbody>
            {visible.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#152847] text-white font-bold text-[12px]">
                  <td className={th}>{visible.length}</td>
                  <td className={`${th} text-center`}>{ticked.size}</td>
                  <td className={th}>Agent</td>
                  <td className={th}>Party Name</td>
                  <td className={th}></td>
                  <td className={th}></td>
                  <td className={`${th} text-right`}>{fmt(totals.tSale)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.pnl)}</td>
                  <td className={th}></td>
                  <td className={`${th} text-right`}>{fmt(totals.hpAmt)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.finalPl)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.payment)}</td>
                  <td className={th}></td>
                  <td className={th}></td>
                  <td className="py-2.5 px-2 text-right">{fmt(totals.vapsiAmt)}</td>
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
