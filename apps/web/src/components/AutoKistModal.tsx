import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DateDMYInput } from './DateDMYInput.js';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';

interface DueKist {
  id: number;
  partyLedgerId: number;
  partyName: string;
  kistNo: number;
  kistDate: string;
  amount: number;
  kistType: string;
}

interface AutoKistModalProps {
  open: boolean;
  onClose: () => void;
  // Called after Process Voucher posts at least one kist, so the page can reload its lists.
  onProcessed: () => void;
}

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const messageToast = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

// Kist Voucher page's "Auto Kist (F3)" popup:
//   Date (today) + Search → the PENDING kists due on that date (GET /vouchers/kist-due)
//   tick rows (header box ticks all) → Process Voucher posts only the ticked kists as
//   KIST vouchers (Party Dr / KIST A/C Cr) and marks them DONE (POST /vouchers/kist-auto).
export const AutoKistModal: React.FC<AutoKistModalProps> = ({ open, onClose, onProcessed }) => {
  const [date, setDate] = useState(todayLocal());
  const [rows, setRows] = useState<DueKist[]>([]);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Each open starts fresh on today's date with an empty grid, like the live popup.
  useEffect(() => {
    if (!open) return;
    setDate(todayLocal());
    setRows([]);
    setTicked(new Set());
    setSearched(false);
    // Live: opens with the cursor on the date's day part
    const id = requestAnimationFrame(() => {
      const el = document.getElementById('autokist-date-dd') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);
  // A click on the dimmed area outside the box closes it (as Esc / X do); only a press that
  // starts AND ends there counts
  const backdropDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const search = async (forDate = date) => {
    if (!forDate) {
      messageToast('error', 'Please select Date!', 'auto-kist-date');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest<DueKist[]>(`/vouchers/kist-due?date=${encodeURIComponent(forDate)}`);
      setRows(res.data || []);
      setTicked(new Set());
      setSearched(true);
    } catch (err: any) {
      messageToast('error', err.message || 'Failed to load kists');
    } finally {
      setLoading(false);
    }
  };

  const allTicked = rows.length > 0 && ticked.size === rows.length;
  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(rows.map(r => r.id)));
  const toggleOne = (id: number) =>
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tickedTotal = useMemo(
    () => rows.filter(r => ticked.has(r.id)).reduce((sum, r) => sum + r.amount, 0),
    [rows, ticked]
  );

  const processVoucher = async () => {
    if (ticked.size === 0) {
      messageToast('error', 'Please tick at least one kist!', 'auto-kist-none');
      return;
    }
    setProcessing(true);
    try {
      const res = await apiRequest<{ posted: number; totalAmount: number }>('/vouchers/kist-auto', {
        method: 'POST',
        body: JSON.stringify({ scheduleIds: Array.from(ticked) }),
      });
      const posted = res.data?.posted || 0;
      if (posted > 0) {
        messageToast('success', `${posted} Kist Voucher has been processed successfully!`, `auto-kist-${Date.now()}`);
        onProcessed();
      } else {
        messageToast('error', 'These kists were already processed!', 'auto-kist-already');
      }
      // Processed kists are DONE now, so they drop out of this date's list.
      search();
    } catch (err: any) {
      messageToast('error', err.message || 'Process Voucher failed');
    } finally {
      setProcessing(false);
    }
  };

  if (!open) return null;

  const th = 'py-2.5 px-3 border-r border-[#2b446f] font-bold text-[12px] text-left';

  return (
    <div
      onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (backdropDownRef.current && e.target === e.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-14 z-50 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-300 flex flex-col max-h-[85vh]">
        <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight">Auto Kist Voucher</h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-300 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Date + Search */}
        <form
          onSubmit={(e) => { e.preventDefault(); search(); }}
          className="px-3 py-2 flex items-center gap-4 text-xs border-b border-slate-200"
        >
          <span className="font-semibold text-slate-600">Date</span>
          {/* DD / MM / YYYY as live; Enter steps DD -> MM -> YYYY -> Search */}
          <DateDMYInput
            value={date}
            onChange={setDate}
            idPrefix="autokist-date"
            onEnterFromYear={() => document.getElementById('autokist-search-btn')?.focus()}
          />
          <button
            id="autokist-search-btn"
            type="submit"
            disabled={loading}
            className="px-10 py-2 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded-xs shadow-xs transition-colors disabled:opacity-60"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Grid */}
        <div className="flex-1 min-h-[320px] overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white">
                <th className={`${th} w-12`}>Sr</th>
                <th className={`${th} w-12 text-center`}>
                  <input
                    type="checkbox"
                    checked={allTicked}
                    onChange={toggleAll}
                    disabled={rows.length === 0}
                    className="h-4 w-4 cursor-pointer align-middle"
                    title="Tick all"
                  />
                </th>
                <th className={th}>Party</th>
                <th className={`${th} w-28`}>Type</th>
                <th className="py-2.5 px-3 font-bold text-[12px] text-left w-28">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium">Loading kists...</td></tr>
              ) : rows.length === 0 ? (
                searched ? (
                  <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium">No pending kist on this date.</td></tr>
                ) : null
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={r.id}
                    onClick={() => toggleOne(r.id)}
                    className={`cursor-pointer ${ticked.has(r.id) ? 'bg-blue-50/80' : 'hover:bg-slate-50'}`}
                  >
                    <td className="py-1.5 px-3 font-mono text-slate-600 border-r border-slate-200">{i + 1}</td>
                    <td className="py-1.5 px-3 text-center border-r border-slate-200">
                      <input
                        type="checkbox"
                        checked={ticked.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 cursor-pointer align-middle"
                      />
                    </td>
                    <td className="py-1.5 px-3 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-1.5 px-3 font-semibold text-slate-800 border-r border-slate-200">{r.kistType}</td>
                    <td className="py-1.5 px-3 font-mono font-bold text-slate-900">{r.amount.toLocaleString('en-IN')}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="sticky bottom-0">
              <tr className="bg-[#152847] text-white">
                <td className={th}>{rows.length > 0 ? ticked.size : 'Sr'}</td>
                <td className={`${th} text-center`}>Tick</td>
                <td className={th}>Party</td>
                <td className={th}>Type</td>
                <td className="py-2.5 px-3 font-bold text-[12px] font-mono">
                  {rows.length > 0 ? tickedTotal.toLocaleString('en-IN') : 'Amount'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-slate-200">
          <button
            type="button"
            onClick={processVoucher}
            disabled={processing}
            className="px-4 py-2 bg-[#1e3a8a] hover:bg-[#172554] active:bg-[#0f172a] text-white font-bold rounded-xs text-xs shadow-xs disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Process Voucher'}
          </button>
        </div>
      </div>
    </div>
  );
};
