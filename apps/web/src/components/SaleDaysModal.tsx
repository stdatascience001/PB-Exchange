import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SaleDaysModalProps {
  open: boolean;
  onClose: () => void;
  partyName: string;
  // YYYY-MM-DD, oldest first
  days: string[];
}

// All Shift Report → click a DayAv number (live): the party's name and every day in the range it
// had a sale, as "SR. | DATE" with the dates shown YYYY-MM-DD (live "2026-09-17") and the count
// in the footer.
export const SaleDaysModal: React.FC<SaleDaysModalProps> = ({ open, onClose, partyName, days }) => {
  const backdropDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const th = 'py-2.5 px-3 border-r border-[#223b63] whitespace-nowrap';
  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-2 sm:p-4 pt-16 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-[300px] overflow-hidden border border-slate-300 max-h-[85vh] flex flex-col">
        <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between gap-3">
          <h2 className="text-sm sm:text-base font-bold tracking-tight uppercase truncate" title={partyName}>{partyName}</h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-200 p-0.5 shrink-0" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-1 pbmax-table-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-[#152847] text-white font-bold text-[11px] uppercase">
                <th className={`${th} w-16`}>Sr.</th>
                <th className="py-2.5 px-3 text-center">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {days.length === 0 ? (
                <tr><td colSpan={2} className="py-6 text-center text-slate-400">Record not avaliable!</td></tr>
              ) : (
                days.map((d, i) => (
                  <tr key={d} className="even:bg-slate-50/70 font-semibold text-slate-700">
                    <td className="py-2 px-3 border-r border-slate-200">{i + 1}</td>
                    <td className="py-2 px-3 text-center">{d}</td>
                  </tr>
                ))
              )}
            </tbody>
            {days.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#152847] text-white font-bold text-[11px] uppercase">
                  <td className={th}>{days.length}</td>
                  <td className="py-2.5 px-3 text-center">Date</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
