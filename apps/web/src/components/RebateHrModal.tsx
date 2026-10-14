import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface HrRow {
  partyId: number;
  partyName: string;
  hpBase: number;
  hpPct: number;
  hpAmt: number;
  rbtBase: number;
  rbtPct: number;
  rbtAmt: number;
  tHr: number;
  settleAmt: number;
}

interface RebateHrModalProps {
  open: boolean;
  onClose: () => void;
  partyName: string;
  opening: number;
  closing: number;
  rows: HrRow[];
  // YYYY-MM-DD, for the Excel file name
  fromDate: string;
  toDate: string;
}

const n = (v: number) => String(Math.round(v || 0) + 0);

// All Shift Report → click a Rebate number (live): the party's month-end HR — every party booked
// to it (itself and those whose HP Ledger is this party) with the HP part (HP-Base × HP-%) and the
// Rebate part (RBT-Base, RBT-%, RBT-Amt on what is left after HP), T-HR = HP-Amt + RBT-Amt, and the
// part already settled by Vapsi / Hawa Patti vouchers. Header: OPENING, HR, SETTEL, CLOSING, Excel.
export const RebateHrModal: React.FC<RebateHrModalProps> = ({ open, onClose, partyName, opening, closing, rows, fromDate, toDate }) => {
  const backdropDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sum = (k: keyof Omit<HrRow, 'partyId' | 'partyName'>) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const hr = sum('tHr');
  const settle = sum('settleAmt');

  const handleExcel = () => {
    const head = ['SR.', 'PARTY', 'HP-BASE', 'HP-%', 'HP-AMT', 'RBT-BASE', 'RBT-%', 'RBT-AMT', 'T-HR', 'SETTEL-AMT'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat(rows.map((r, i) => [
      i + 1, esc(r.partyName), n(r.hpBase), r.hpPct, n(r.hpAmt), n(r.rbtBase), r.rbtPct, n(r.rbtAmt), n(r.tHr), n(r.settleAmt),
    ].join(',')));
    lines.push(['', 'TOTAL', n(sum('hpBase')), '', n(sum('hpAmt')), n(sum('rbtBase')), '', n(sum('rbtAmt')), n(hr), n(settle)].join(','));
    const link = document.createElement('a');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + lines.join('\n')));
    link.setAttribute('download', `rebate_${partyName.replace(/[^A-Za-z0-9]+/g, '_')}_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const th = 'py-2.5 px-2 border-r border-[#223b63] whitespace-nowrap';
  const td = 'py-2 px-2 border-r border-slate-200 whitespace-nowrap';
  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-2 sm:p-4 pt-16 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-300 max-h-[85vh] flex flex-col">
        <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-bold tracking-tight uppercase">{partyName}</h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-200 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-2 px-1 py-1.5 text-xs font-bold uppercase text-slate-800">
          <span className="min-w-36">Opening: {n(opening)}</span>
          <span className="min-w-36">HR: {n(hr)}</span>
          <span className="min-w-36">Settel: {n(settle)}</span>
          <span className="min-w-36">Closing: {n(closing)}</span>
          <button
            type="button"
            onClick={handleExcel}
            className="ml-auto mr-2 px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs normal-case"
          >
            Excel
          </button>
        </div>

        <div className="overflow-auto p-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-[#152847] text-white font-bold text-[11px] uppercase">
                <th className={`${th} w-12`}>Sr.</th>
                <th className={th}>Party</th>
                <th className={`${th} text-right`}>HP-Base</th>
                <th className={`${th} text-right`}>HP-%</th>
                <th className={`${th} text-right`}>HP-Amt</th>
                <th className={`${th} text-right`}>RBT-Base</th>
                <th className={`${th} text-right`}>RBT-%</th>
                <th className={`${th} text-right`}>RBT-Amt</th>
                <th className={`${th} text-right`}>T-HR</th>
                <th className="py-2.5 px-2 text-right whitespace-nowrap">Settel-Amt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="py-6 text-center text-slate-400">Record not avaliable!</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.partyId} className="even:bg-slate-50/70 font-semibold text-slate-700">
                    <td className={td}>{i + 1}</td>
                    <td className={`${td} font-bold uppercase`}>{r.partyName}</td>
                    <td className={`${td} text-right`}>{n(r.hpBase)}</td>
                    <td className={`${td} text-right`}>{r.hpPct}</td>
                    <td className={`${td} text-right`}>{n(r.hpAmt)}</td>
                    <td className={`${td} text-right`}>{n(r.rbtBase)}</td>
                    <td className={`${td} text-right`}>{r.rbtPct}</td>
                    <td className={`${td} text-right`}>{n(r.rbtAmt)}</td>
                    <td className={`${td} text-right`}>{n(r.tHr)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{n(r.settleAmt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#152847] text-white font-bold text-xs uppercase">
                  <td className={th}>Sr.</td>
                  <td className={th}>Party</td>
                  <td className={`${th} text-right`}>{n(sum('hpBase'))}</td>
                  <td className={`${th} text-right`}>HP-%</td>
                  <td className={`${th} text-right`}>{n(sum('hpAmt'))}</td>
                  <td className={`${th} text-right`}>{n(sum('rbtBase'))}</td>
                  <td className={`${th} text-right`}>RBT-%</td>
                  <td className={`${th} text-right`}>{n(sum('rbtAmt'))}</td>
                  <td className={`${th} text-right`}>{n(hr)}</td>
                  <td className="py-2.5 px-2 text-right whitespace-nowrap">{n(settle)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
