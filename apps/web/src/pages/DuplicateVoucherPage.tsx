import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

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

const formatDateOnly = (dateVal?: string) => {
  if (!dateVal) return '-';
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

  const fetchDuplicates = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ voucherType, fromDate, toDate });
      const res = await apiRequest<DuplicateVoucherGroup[]>(`/vouchers/duplicates?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load duplicate vouchers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDuplicates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherType]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDuplicates();
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
              value={voucherType}
              onChange={(e) => setVoucherType(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-28 shadow-xs"
            >
              {VOUCHER_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
            />

            <button
              type="submit"
              className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors"
            >
              Search
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
                      ₹{r.amount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.entrySide === 'CR' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {r.entrySide}
                      </span>
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{r.oppositePartyName}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-full text-[10px]">
                        {r.count}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => alert(`Voucher IDs: ${r.voucherIds.join(', ')}`)}
                        className="px-3 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-[10px] rounded shadow-xs"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
