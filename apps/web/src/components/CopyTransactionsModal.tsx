import React, { useEffect, useMemo, useState } from 'react';
import { ShiftDto } from '@pb/types';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';

interface CopyTransactionsModalProps {
  // The slip being copied; null keeps the popup closed
  tx: { id: number } | null;
  shifts: ShiftDto[];
  onClose: () => void;
  // Runs after a Process that copied the slip into at least one shift (refresh the list)
  onCopied: () => void;
}

// The live "Copy Transactions" popup (Live Transactions / Declare Transactions → Copy): pick
// one or more shifts — only Active shifts whose result isn't declared yet — and Process copies
// the slip into each of them through the copy endpoint (so each shift's cut-off, limits and
// locks still apply). Sr | [x] | Shift, header checkbox ticks all; the cursor starts on the
// first shift, Enter walks the checkboxes then Process, Space ticks, Escape closes.
export const CopyTransactionsModal: React.FC<CopyTransactionsModalProps> = ({ tx, shifts, onClose, onCopied }) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);
  const copyShifts = useMemo(
    () => shifts.filter(s => s.isActive !== false && !s.declaredNumber),
    [shifts]
  );

  useEffect(() => {
    if (!tx) return;
    setSelectedIds(new Set());
    const id = setTimeout(() => (document.getElementById('copy-shift-0') as HTMLInputElement | null)?.focus(), 0);
    return () => clearTimeout(id);
  }, [tx]);

  if (!tx) return null;

  const toggle = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allChecked = copyShifts.length > 0 && copyShifts.every(s => selectedIds.has(s.id));
  const toggleAll = () => setSelectedIds(allChecked ? new Set() : new Set(copyShifts.map(s => s.id)));

  const handleCheckboxKey = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = document.getElementById(`copy-shift-${idx + 1}`) as HTMLInputElement | null;
    if (next) next.focus();
    else document.getElementById('copy-process-btn')?.focus();
  };

  const handleProcess = async () => {
    if (processing) return;
    const targets = copyShifts.filter(s => selectedIds.has(s.id));
    if (targets.length === 0) {
      toast.error(
        <div><div className="font-bold text-base">Error</div><div className="text-sm mt-0.5">Please select at least one shift.</div></div>,
        { toastId: 'copy-no-shift' }
      );
      return;
    }
    setProcessing(true);
    const failed: string[] = [];
    for (const shift of targets) {
      try {
        await apiRequest(`/transactions/${tx.id}/copy-next-shift`, {
          method: 'POST',
          body: JSON.stringify({ targetShiftId: shift.id }),
        });
      } catch (err: any) {
        failed.push(`${shift.name}: ${err.message || 'Copy failed'}`);
      }
    }
    setProcessing(false);
    const done = targets.length - failed.length;
    if (done > 0) {
      toast.success(
        <div><div className="font-bold text-base">Success</div><div className="text-sm mt-0.5">Transaction copied to {done} shift{done > 1 ? 's' : ''}.</div></div>,
        { toastId: 'copy-done' }
      );
      onCopied();
    }
    if (failed.length > 0) {
      toast.error(
        <div><div className="font-bold text-base">Error</div>{failed.map(f => <div key={f} className="text-sm mt-0.5">{f}</div>)}</div>,
        { toastId: 'copy-failed', autoClose: 8000 }
      );
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      // A click on the dimmed area outside the box closes it (as Esc / X do)
      onMouseDown={(e) => { (e.currentTarget as HTMLElement).dataset.downOnBackdrop = e.target === e.currentTarget ? '1' : ''; }}
      onClick={(e) => { if (e.target === e.currentTarget && (e.currentTarget as HTMLElement).dataset.downOnBackdrop === '1') onClose(); }}
    >
      <div className="bg-white rounded-md shadow-2xl w-full max-w-lg overflow-hidden border border-slate-300 flex flex-col max-h-[90vh]">
        <div className="bg-[#1e3a6e] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide">Copy Transactions</h2>
          <button type="button" onClick={onClose} className="text-white/90 hover:text-white p-0.5" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto pbmax-table-scrollbar flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px]">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12">Sr</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all" className="h-4 w-4 cursor-pointer align-middle" />
                </th>
                <th className="py-2.5 px-3">Shift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {copyShifts.length === 0 ? (
                <tr><td colSpan={3} className="py-10 text-center text-slate-400">No open shift to copy into.</td></tr>
              ) : copyShifts.map((s, idx) => (
                <tr
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  className={`cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'} hover:bg-amber-50`}
                >
                  <td className="py-2.5 px-3 font-semibold text-slate-700 border-r border-slate-200">{idx + 1}</td>
                  <td className="py-2.5 px-3 text-center border-r border-slate-200" onClick={(e) => e.stopPropagation()}>
                    <input
                      id={`copy-shift-${idx}`}
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggle(s.id)}
                      onKeyDown={(e) => handleCheckboxKey(idx, e)}
                      className="h-4 w-4 cursor-pointer align-middle focus:ring-2 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-800 uppercase">{s.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end">
          <button
            id="copy-process-btn"
            type="button"
            onClick={handleProcess}
            disabled={processing}
            className="px-4 py-1.5 bg-[#1e3a6e] hover:bg-[#162c55] text-white font-bold text-xs rounded shadow-xs disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {processing ? 'Processing...' : 'Process'}
          </button>
        </div>
      </div>
    </div>
  );
};
