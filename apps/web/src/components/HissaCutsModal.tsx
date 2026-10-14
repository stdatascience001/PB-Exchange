import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface HissaCut {
  partyId: number;
  partyName: string;
  agentName: string;
  totalSale: number;
  comm: number;
  payout: number;
  // Sale + Comm − Payout
  book: number;
  // the party's own S-Hissa % — the cut is taken from what is left after it
  sHissa?: number;
  // the Hissa Party % (Ledger Update → Re-Config) the party gives this receiver
  percent: number;
  // Book × % (exact)
  cutAmount: number;
}

interface HissaCutsModalProps {
  open: boolean;
  onClose: () => void;
  receiverName: string;
  shiftName: string;
  // YYYY-MM-DD
  date: string;
  cuts: HissaCut[];
  // the receiver row's Hissa on the report (the rounded total of the cuts, negative)
  rowHissa: number;
}

const fmt = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Daily Report → click HP A/C (or any ledger that receives Hissa): every party whose book was cut
// into it, with how the cut was worked out — Book (Sale + Comm − Payout) × that party's Hissa % to
// this ledger. A positive cut is owed TO the receiver (it shows in its Credit), a negative one (the
// party won, its book is below 0) is owed BY it.
export const HissaCutsModal: React.FC<HissaCutsModalProps> = ({ open, onClose, receiverName, shiftName, date, cuts, rowHissa }) => {
  const backdropDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sum = (k: 'totalSale' | 'comm' | 'payout' | 'book' | 'cutAmount') => cuts.reduce((a, c) => a + (c[k] || 0), 0);
  const totalCut = sum('cutAmount');
  const [yy, mm, dd] = (date || '').split('-');
  const titleDate = dd ? `${dd} / ${mm} / ${yy}` : '';
  const th = 'py-2 px-3 border-r border-[#223b63] whitespace-nowrap';
  const td = 'py-1.5 px-3 border-r border-slate-200 whitespace-nowrap';

  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-300 max-h-[90vh] flex flex-col">
        <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm sm:text-base font-bold tracking-tight uppercase">
            {receiverName} — Hissa Cut | {shiftName || '-'} | {titleDate}
          </h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-200 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs border-b border-slate-200 bg-slate-50">
          <span className="text-slate-600">Parties: <b className="text-slate-900">{cuts.length}</b></span>
          <span className="text-slate-600">Total Cut: <b className={totalCut >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmt(totalCut)}</b></span>
          <span className="text-slate-600">On report (rounded): Hissa <b className="text-slate-900">{fmt(rowHissa)}</b>, {totalCut >= 0 ? 'Credit' : 'Debit'} <b className="text-slate-900">{fmt(Math.abs(rowHissa))}</b></span>
          <span className="text-slate-500">Cut = Book (Sale + Comm − Payout) × (100 − S-Hissa)% × Hissa %</span>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-[#152847] text-white font-bold text-[11px]">
                <th className={`${th} w-10 text-center`}>Sr</th>
                <th className={th}>Party</th>
                <th className={th}>Agent</th>
                <th className={`${th} text-right`}>Total Sale</th>
                <th className={`${th} text-right`}>Comm</th>
                <th className={`${th} text-right`}>Payout</th>
                <th className={`${th} text-right`}>Book</th>
                <th className={`${th} text-right`}>S-Hissa</th>
                <th className={`${th} text-right`}>Hissa %</th>
                <th className="py-2 px-3 text-right whitespace-nowrap">Cut Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {cuts.length === 0 ? (
                <tr><td colSpan={10} className="py-8 text-center text-slate-400">Record not avaliable!</td></tr>
              ) : (
                cuts.map((c, i) => (
                  <tr key={`${c.partyId}-${i}`} className="hover:bg-slate-50 even:bg-slate-50/60">
                    <td className={`${td} text-center font-mono text-slate-500`}>{i + 1}</td>
                    <td className={`${td} font-bold uppercase text-slate-900`}>{c.partyName}</td>
                    <td className={`${td} font-semibold uppercase text-slate-700`}>{c.agentName}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(c.totalSale)}</td>
                    <td className={`${td} text-right font-mono text-rose-700`}>{fmt(c.comm)}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(c.payout)}</td>
                    <td className={`${td} text-right font-mono font-semibold ${c.book >= 0 ? 'text-slate-900' : 'text-rose-700'}`}>{fmt(c.book)}</td>
                    <td className={`${td} text-right font-mono`}>{c.sHissa || 0}%</td>
                    <td className={`${td} text-right font-mono`}>{c.percent}%</td>
                    <td className={`py-1.5 px-3 text-right font-mono font-bold whitespace-nowrap ${c.cutAmount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(c.cutAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {cuts.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className={`${th} text-center`}>{cuts.length}</td>
                  <td className={th} colSpan={2}>Total</td>
                  <td className={`${th} text-right font-mono`}>{fmt(sum('totalSale'))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(sum('comm'))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(sum('payout'))}</td>
                  <td className={`${th} text-right font-mono`}>{fmt(sum('book'))}</td>
                  <td className={`${th} text-right`}>-</td>
                  <td className={`${th} text-right`}>-</td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(totalCut)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
