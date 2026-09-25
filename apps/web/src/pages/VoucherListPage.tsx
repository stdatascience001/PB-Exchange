import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

const PAGE_TITLE = 'Voucher List';
const VOUCHER_TYPE_FILTER: string | undefined = undefined; // undefined = all voucher types

interface VoucherListItem {
  id: number;
  voucherNumber: string;
  voucherType: string;
  totalAmount: number;
  narration: string | null;
  partyName: string;
  entrySide: string;
  oppositePartyName: string;
  createdByUsername: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const formatTimestamp = (dateVal?: string) => {
  if (!dateVal) return '-';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  } catch {
    return dateVal;
  }
};

export const VoucherListPage: React.FC = () => {
  const [list, setList] = useState<VoucherListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState(todayInputDate());

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (VOUCHER_TYPE_FILTER) params.append('voucherType', VOUCHER_TYPE_FILTER);
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      const res = await apiRequest<VoucherListItem[]>(`/vouchers/manual?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load vouchers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchList();
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Date,Type,Party,Cr/Dr,Amount,Opposite Party,Remark'].concat(
        list.map(v => `${v.createdAt.slice(0, 10)},${v.voucherType},"${v.partyName}",${v.entrySide},${v.totalAmount},"${v.oppositePartyName}","${v.narration || ''}"`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${PAGE_TITLE.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">{PAGE_TITLE}</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <button type="submit" className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
              Search
            </button>
          </div>
          <button type="button" onClick={handleExportExcel} className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                {!VOUCHER_TYPE_FILTER && <th className="py-2.5 px-4 border-r border-[#223b63]">Type</th>}
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Cr/Dr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Opposite Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Remark</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Added</th>
                <th className="py-2.5 px-4">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                list.map((v, idx) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{v.createdAt.slice(0, 10)}</td>
                    {!VOUCHER_TYPE_FILTER && (
                      <td className="py-2 px-4 border-r border-slate-200">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold uppercase">
                          {v.voucherType.replace(/_/g, ' ')}
                        </span>
                      </td>
                    )}
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.entrySide === 'CR' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {v.entrySide}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{v.totalAmount.toLocaleString('en-IN')}</td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                    <td className="py-2 px-4 text-slate-600 border-r border-slate-200 whitespace-normal max-w-xs">{v.narration || '-'}</td>
                    <td className="py-1 px-4 border-r border-slate-200 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{v.createdByUsername}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(v.createdAt)}</div>
                    </td>
                    <td className="py-1 px-4 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{v.updatedBy}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(v.updatedAt)}</div>
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
