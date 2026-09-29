import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';

interface RedeclareRow {
  partyId: number;
  partyName: string;
  sale: number;
  reSale: number;
  diffSale: number;
  pl: number;
  rePl: number;
  diffPl: number;
}

interface RedeclareInfo {
  declarationId: number;
  shiftId: number;
  shiftName: string;
  displayDate: string;
  winningNumber: string;
  redeclareCount: number;
  hasDifference: boolean;
  summary: {
    declare: { sale: number; pl: number };
    reDeclare: { sale: number; pl: number };
    difference: { sale: number; pl: number };
  };
  rows: RedeclareRow[];
}

interface RedeclareModalProps {
  declarationId: number | null;
  // Declare Needed row's change count, shown on the button as "RE-DECLARE (n)"
  changeCount?: number;
  onClose: () => void;
  onRedeclared: () => void;
}

const num = (v: number) => Math.round(v).toString();

// Dashboard → Declare Needed → ReDeclare: "DECLARE INFO | <SHIFT> | <DD-MM-YYYY>" popup.
// Left: SUMMARY of Sale / P&L as declared vs. as it stands now, and the difference.
// Right: party-wise SALE / Re-SALE / DIFF-SALE / P&L / Re-P&L / DIFF-P&L.
// RE-DECLARE re-settles the same winning number on the current data.
export const RedeclareModal: React.FC<RedeclareModalProps> = ({ declarationId, changeCount, onClose, onRedeclared }) => {
  const [info, setInfo] = useState<RedeclareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (declarationId == null) return;
    let cancelled = false;
    setInfo(null);
    setLoading(true);
    apiRequest<RedeclareInfo>(`/declarations/redeclare/${declarationId}`)
      .then((res) => { if (!cancelled && res.data) setInfo(res.data); })
      .catch((err: any) => {
        if (!cancelled) toast.error(err.message || 'Failed to load declare info', { toastId: 'redeclare-load' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [declarationId]);

  useEffect(() => {
    if (declarationId == null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [declarationId, onClose]);

  if (declarationId == null) return null;

  const handleRedeclare = async () => {
    if (!info) return;
    if (!window.confirm(`Re-declare ${info.shiftName} | ${info.displayDate} with number ${info.winningNumber}?`)) return;
    setSaving(true);
    try {
      await apiRequest(`/declarations/redeclare/${info.declarationId}`, { method: 'POST' });
      toast.success(`${info.shiftName} | ${info.displayDate} re-declared successfully`);
      onRedeclared();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Re-declare failed', { toastId: 'redeclare-save' });
    } finally {
      setSaving(false);
    }
  };

  const summaryBlock = (label: string, sale: number, pl: number) => (
    <div className="py-3 border-b border-slate-200 last:border-b-0">
      <div className="text-[11px] font-bold text-slate-800 uppercase mb-1">{label}</div>
      <div className="flex items-baseline justify-between">
        <span className="text-base text-slate-700">{num(sale)}</span>
        <span className="text-base font-bold text-slate-900">{num(pl)}</span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-md shadow-2xl w-full max-w-[1140px] max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#1f3a6e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold uppercase tracking-wide">
            Declare Info{info ? ` | ${info.shiftName} | ${info.displayDate}` : ''}
          </h2>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white cursor-pointer" title="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading || !info ? (
          <div className="p-10 text-center text-sm text-slate-500">{loading ? 'Loading...' : 'No data'}</div>
        ) : (
          <div className="flex flex-col md:flex-row gap-3 p-3 min-h-0 flex-1">
            {/* SUMMARY */}
            <div className="md:w-[260px] shrink-0 border border-slate-200 rounded px-4 py-3 self-start w-full">
              <div className="text-base font-bold text-slate-800 uppercase mb-3">Summary</div>
              <div className="flex justify-between text-[11px] text-slate-500 uppercase pb-2 border-b border-slate-200">
                <span>Sale</span>
                <span>P&amp;L</span>
              </div>
              {summaryBlock('Declare', info.summary.declare.sale, info.summary.declare.pl)}
              {summaryBlock('Re-Declare', info.summary.reDeclare.sale, info.summary.reDeclare.pl)}
              {summaryBlock('Diffrance', info.summary.difference.sale, info.summary.difference.pl)}
              <button
                type="button"
                onClick={handleRedeclare}
                disabled={saving}
                className="mt-3 w-full py-2 bg-[#1f3a6e] hover:bg-[#162b52] disabled:opacity-60 text-white text-xs font-bold uppercase rounded cursor-pointer transition-colors"
              >
                {saving ? 'Re-Declaring...' : `Re-Declare (${changeCount ?? 0})`}
              </button>
            </div>

            {/* Party-wise table */}
            <div className="flex-1 min-w-0 overflow-auto border border-slate-200 rounded max-h-[70vh]">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-[#1f3a6e] text-white uppercase">
                  <tr>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88]">Sr</th>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88]">Party</th>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88]">Sale</th>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88] normal-case">Re-SALE</th>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88]">Diff-Sale</th>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88]">P&amp;L</th>
                    <th className="py-2.5 px-2 text-left font-bold border-r border-[#2d4d88] normal-case">Re-P&amp;L</th>
                    <th className="py-2.5 px-2 text-left font-bold">Diff-P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {info.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">No parties</td>
                    </tr>
                  ) : (
                    info.rows.map((r, i) => (
                      <tr key={r.partyId} className="even:bg-slate-50 border-b border-slate-200">
                        <td className="py-2 px-2 border-r border-slate-200">{i + 1}</td>
                        <td className="py-2 px-2 border-r border-slate-200 font-semibold uppercase">{r.partyName}</td>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono">{num(r.sale)}</td>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono">{num(r.reSale)}</td>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono">{num(r.diffSale)}</td>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono">{num(r.pl)}</td>
                        <td className="py-2 px-2 border-r border-slate-200 text-right font-mono">{num(r.rePl)}</td>
                        <td className="py-2 px-2 text-right font-mono">{num(r.diffPl)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
