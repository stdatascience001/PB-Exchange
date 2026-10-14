import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiRequest } from '../api/client.js';

interface ShiftLine {
  shiftId: number;
  shiftName: string;
  rate: string;
  sHissa: number;
  totalSale: number;
  dSale: number;
  aSale: number;
  comm: number;
  oDara: number;
  oAkhar: number;
  tpc: number;
  hissa: number;
  debit: number;
  credit: number;
}

interface PartyDetail {
  partyId: number;
  partyName: string;
  userName: string;
  fromDate: string;
  toDate: string;
  rows: ShiftLine[];
  masterTotal: Omit<ShiftLine, 'shiftId' | 'shiftName' | 'rate' | 'sHissa'>;
  summary: { opening: number; pnl: number; hpAmt: number; rebate: number; tpc: number; kist: number; payment: number; closing: number };
}

interface AllShiftPartyModalProps {
  open: boolean;
  onClose: () => void;
  partyId: number;
  partyName: string;
  // the range the report on screen was loaded for (YYYY-MM-DD)
  fromDate: string;
  toDate: string;
}

// The app's name, shown at the top of the report like live's "PB EXCHANGE" (Navbar brand)
const BRAND = 'PUNJAB KING';

// YYYY-MM-DD -> DD-MM-YYYY (live "FROM: 01-09-2026 | TO: 30-09-2026")
const dmy = (d: string) => {
  const [y, m, day] = (d || '').split('-');
  return day ? `${day}-${m}-${y}` : d;
};
// Live "REPORTING TIME: 10/13/2026, 08:26:08 PM" — the moment the popup was opened
const reportingTime = () =>
  new Date().toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
const n = (v: number) => String(Math.round(v || 0) + 0);

// All Shift Report → click a Party (live "ALL SHIFT REPORT"): the party's range shift by shift
// with its Master Total, then its balance line — Opening, P&L, HP-Amt, Rebate, TPC, Payment,
// Closing — the same figures as its row on the report.
export const AllShiftPartyModal: React.FC<AllShiftPartyModalProps> = ({ open, onClose, partyId, partyName, fromDate, toDate }) => {
  const [detail, setDetail] = useState<PartyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [stamp, setStamp] = useState('');
  const backdropDownRef = useRef(false);

  useEffect(() => {
    if (!open || !partyId) return;
    let cancelled = false;
    setDetail(null);
    setStamp(reportingTime());
    setLoading(true);
    const params = new URLSearchParams({ view: 'party', partyId: String(partyId), fromDate, toDate });
    apiRequest<PartyDetail>(`/transactions/all-shift-report?${params.toString()}`)
      .then(res => { if (!cancelled) setDetail(res.data || null); })
      .catch(err => console.warn('Failed to load all-shift party report:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, partyId, fromDate, toDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const th = 'py-2.5 px-2 border-r border-[#223b63] whitespace-nowrap';
  const td = 'py-2 px-2 border-r border-slate-200 whitespace-nowrap';
  const rows = detail?.rows || [];
  const t = detail?.masterTotal;
  const s = detail?.summary;

  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl overflow-hidden border border-slate-300 max-h-[92vh] flex flex-col">
        <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-bold tracking-tight uppercase inline-flex items-center gap-2">
            All Shift Report
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-200 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto p-1 select-text">
          {/* Report heading: range on the left, brand / party / user-id centred, time on the right */}
          <div className="grid grid-cols-3 items-center px-3 pt-3 pb-4 text-slate-700">
            <div className="text-[11px] font-bold uppercase">FROM: {dmy(fromDate)} | TO: {dmy(toDate)}</div>
            <div className="text-center leading-snug">
              <div className="text-xl font-bold tracking-wide text-slate-700">{BRAND}</div>
              <div className="text-base font-bold uppercase">{detail?.partyName || partyName}</div>
              <div className="text-base font-bold uppercase">USER-ID: {detail?.userName || '-'}</div>
            </div>
            <div className="text-[11px] font-bold uppercase text-right">REPORTING TIME: {stamp}</div>
          </div>

          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] uppercase">
                <th className={`${th} w-12`}>Sr.</th>
                <th className={th}>Party</th>
                <th className={`${th} text-center`}>Rate</th>
                <th className={`${th} text-center`}>S-Hissa</th>
                <th className={`${th} text-right`}>T-Sale</th>
                <th className={`${th} text-right`}>D-Sale</th>
                <th className={`${th} text-right`}>A-Sale</th>
                <th className={`${th} text-right`}>Comm</th>
                <th className={`${th} text-right`}>O-Dara</th>
                <th className={`${th} text-right`}>O-Akhar</th>
                <th className={`${th} text-right`}>TPC</th>
                <th className={`${th} text-right`}>Hissa</th>
                <th className={`${th} text-right`}>Debit</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading && !detail ? (
                <tr><td colSpan={14} className="py-8 text-center text-slate-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={14} className="py-8 text-center text-slate-400">Record not avaliable!</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.shiftId} className="even:bg-slate-50/70 font-semibold text-slate-700">
                    <td className={td}>{i + 1}</td>
                    <td className={`${td} font-bold uppercase bg-[#f1f1f1]`}>{r.shiftName}</td>
                    <td className={`${td} text-center`}>{r.rate}</td>
                    <td className={`${td} text-center`}>{r.sHissa}</td>
                    <td className={`${td} text-right`}>{n(r.totalSale)}</td>
                    <td className={`${td} text-right`}>{n(r.dSale)}</td>
                    <td className={`${td} text-right`}>{n(r.aSale)}</td>
                    <td className={`${td} text-right`}>{n(r.comm)}</td>
                    <td className={`${td} text-right`}>{n(r.oDara)}</td>
                    <td className={`${td} text-right`}>{n(r.oAkhar)}</td>
                    <td className={`${td} text-right`}>{n(r.tpc)}</td>
                    <td className={`${td} text-right`}>{n(r.hissa)}</td>
                    <td className={`${td} text-right`}>{r.debit > 0 ? n(r.debit) : ''}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{r.credit > 0 ? n(r.credit) : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
            {t && rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-xs uppercase">
                  <td className={th}>{rows.length}</td>
                  <td className={th}>Master Total</td>
                  <td className={`${th} text-center`}>Rate</td>
                  <td className={`${th} text-center`}>S-Hissa</td>
                  <td className={`${th} text-right`}>{n(t.totalSale)}</td>
                  <td className={`${th} text-right`}>{n(t.dSale)}</td>
                  <td className={`${th} text-right`}>{n(t.aSale)}</td>
                  <td className={`${th} text-right`}>{n(t.comm)}</td>
                  <td className={`${th} text-right`}>{n(t.oDara)}</td>
                  <td className={`${th} text-right`}>{n(t.oAkhar)}</td>
                  <td className={`${th} text-right`}>{n(t.tpc)}</td>
                  <td className={`${th} text-right`}>{n(t.hissa)}</td>
                  <td className={`${th} text-right`}>{n(t.debit)}</td>
                  <td className="py-2.5 px-2 text-right whitespace-nowrap">{n(t.credit)}</td>
                </tr>
              </tfoot>
            )}
          </table>

          {/* Balance line (live): OPENING … CLOSING */}
          {s && (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-6 text-slate-700 font-bold uppercase">
              <span className="text-base">Opening: {n(s.opening)}</span>
              <span className="text-xs">P&amp;L: {n(s.pnl)}</span>
              <span className="text-xs">HP-Amt: {n(s.hpAmt)}</span>
              <span className="text-xs">Rebate: {n(s.rebate)}</span>
              <span className="text-xs">TPC: {n(s.tpc)}</span>
              {Math.round(s.kist) !== 0 && <span className="text-xs">Kist: {n(s.kist)}</span>}
              <span className="text-xs">Payment: {n(s.payment)}</span>
              <span className="text-base">Closing: {n(s.closing)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
