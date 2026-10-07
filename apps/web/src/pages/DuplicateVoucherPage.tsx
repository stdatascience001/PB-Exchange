import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface DuplicateVoucherGroup {
  partyLedgerId: number;
  partyName: string;
  amount: number;
  voucherDate: string;
  entrySide: string;
  oppositePartyName: string;
  count: number;
  voucherIds: number[];
}

const VOUCHER_TYPES = [
  { value: 'JOURNAL', label: 'Journal' },
  { value: 'LIMIT', label: 'Limit' },
  { value: 'KIST', label: 'Kist' },
  { value: 'VAPSI', label: 'Vapsi' },
  { value: 'HAWA_PATTI', label: 'Hawa Patti' },
];

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const messageToast = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

const formatDateOnly = (dateVal?: string) => {
  if (!dateVal) return '-';
  // voucherDate comes as YYYY-MM-DD — format the string itself so no timezone can shift it.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateVal);
  if (ymd) return `${ymd[3]}-${ymd[2]}-${ymd[1]}`;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
};

export const DuplicateVoucherPage: React.FC = () => {
  const [list, setList] = useState<DuplicateVoucherGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [voucherType, setVoucherType] = useState('JOURNAL');
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  // Delete confirmation popup: the duplicate group whose latest repeat is about to go.
  const [deleteTarget, setDeleteTarget] = useState<DuplicateVoucherGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  // announce: the Search button (and Delete's refresh) say "Record not found!" when nothing
  // comes back, as the live page does; the automatic load on open / type change stays quiet.
  const fetchDuplicates = async (announce = false) => {
    const problem = !fromDate || !toDate
      ? 'Please select both Dates!'
      : fromDate > toDate
        ? 'From Date cannot be after To Date!'
        : '';
    if (problem) {
      messageToast('error', problem, 'dup-voucher-date');
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ voucherType, fromDate, toDate });
      const res = await apiRequest<DuplicateVoucherGroup[]>(`/vouchers/duplicates?${params.toString()}`);
      const rows = res.data || [];
      setList(rows);
      if (announce && rows.length === 0) messageToast('error', 'Record not found!', 'dup-voucher-none');
    } catch (err: any) {
      console.warn('Failed to load duplicate vouchers:', err);
      if (announce) messageToast('error', err.message || 'Failed to load duplicate vouchers');
    } finally {
      setLoading(false);
    }
  };

  // Delete removes the most recent repeat of the group and keeps the original (oldest)
  // voucher, so D-Count drops by one; the row goes once only the original is left.
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const repeatId = deleteTarget.voucherIds[deleteTarget.voucherIds.length - 1];
    setDeleting(true);
    try {
      await apiRequest(`/vouchers/${repeatId}`, { method: 'DELETE' });
      messageToast('success', 'Duplicate voucher has been deleted successfully!', `dup-voucher-deleted-${repeatId}`);
      setDeleteTarget(null);
      fetchDuplicates();
    } catch (err: any) {
      messageToast('error', err.message || 'Failed to delete voucher');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    fetchDuplicates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherType]);

  // Live Enter flow: the page opens on the voucher type; Enter walks Type -> From DD -> MM ->
  // YYYY -> To DD -> MM -> YYYY -> Search, and Enter on Search searches (spinner while it runs)
  const focusDv = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => focusDv('dv-type'));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchDuplicates(true);
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('No duplicate records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Date,Party,Amount,Dr/Cr,O-Party,D-Count'].concat(
        list.map(r => `${formatDateOnly(r.voucherDate)},"${r.partyName}",${r.amount},${r.entrySide},"${r.oppositePartyName}",${r.count}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `duplicate_voucher_${voucherType}_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Duplicate Voucher</span>

            <select
              id="dv-type"
              value={voucherType}
              onChange={(e) => setVoucherType(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusDv('dv-from-dd'); } }}
              className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 cursor-pointer min-w-28 shadow-xs"
            >
              {VOUCHER_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {/* DD / MM / YYYY as live */}
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="dv-from" onEnterFromYear={() => focusDv('dv-to-dd')} />
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="dv-to" onEnterFromYear={() => focusDv('dv-search-btn')} />

            <button
              id="dv-search-btn"
              type="submit"
              disabled={loading}
              className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5"
            >
              Search
              {/* Spinner while the list loads, as on live */}
              {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Excel
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Dr/Cr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">O-Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center w-24">D-Count</th>
                <th className="py-2.5 px-4 text-center w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center text-slate-400 font-medium">Checking for duplicate vouchers...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-slate-400 font-medium">No duplicate vouchers detected.</td></tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 text-center font-mono text-slate-600 border-r border-slate-200">{formatDateOnly(r.voucherDate)}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                      {r.amount}
                    </td>
                    <td className="py-2 px-4 text-center font-semibold text-slate-800 border-r border-slate-200">
                      {r.entrySide === 'CR' ? 'Cr' : 'Dr'}
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{r.oppositePartyName}</td>
                    <td className="py-2 px-4 text-center font-semibold text-slate-900 border-r border-slate-200" title={`Voucher IDs: ${r.voucherIds.join(', ')}`}>
                      {r.count}
                    </td>
                    <td className="py-2 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        className="px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-[10px] rounded shadow-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation (in-page popup, not the browser's confirm) */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-16 z-50 animate-in fade-in duration-150"
          onKeyDown={(e) => { if (e.key === 'Escape') setDeleteTarget(null); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-300">
            <div className="px-5 pt-5 pb-4">
              <h2 className="text-base font-bold text-slate-900 mb-2">Delete Duplicate Voucher</h2>
              <p className="text-sm text-slate-700">
                Delete one duplicate of <span className="font-bold uppercase">{deleteTarget.partyName}</span>{' '}
                {deleteTarget.amount} {deleteTarget.entrySide === 'CR' ? 'Cr' : 'Dr'} ({formatDateOnly(deleteTarget.voucherDate)})?
                The original voucher is kept.
              </p>
            </div>
            <div className="px-5 pb-5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-6 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-sm rounded-full shadow-xs disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'OK'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-5 py-1.5 bg-[#dbe6fb] hover:bg-[#c9d8f7] text-[#1f3f7a] font-bold text-sm rounded-full"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
