import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

const PAGE_TITLE = 'Profit & Loss Report';

interface ShiftPnlRow {
  shiftId: number;
  shiftName: string;
  shiftCode: string;
  totalSale: number;
  dSale: number;
  aSale: number;
  comm: number;
  oDara: number;
  oAkhar: number;
  tpc: number;
  hissa: number;
  closing: number;
}

interface ShiftPnlResponse {
  rows: ShiftPnlRow[];
  masterTotal: (Omit<ShiftPnlRow, 'shiftId' | 'shiftName' | 'shiftCode'> & { shiftCount: number }) | null;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

export const ProfitLossReportPage: React.FC = () => {
  const [data, setData] = useState<ShiftPnlResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('fromDate', fromDate);
      params.append('toDate', toDate);
      const res = await apiRequest<ShiftPnlResponse>(`/transactions/shift-profit-loss?${params.toString()}`);
      if (res.data) setData(res.data);
    } catch (err) {
      console.warn('Failed to load Profit & Loss report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReport();
  };

  const handleExportExcel = () => {
    if (!data || data.rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Shift,Total Sale,Dara Sale,Akhar Sale,Comm,Dara Open,Akhar Open,TPC,Hissa,Closing'].concat(
        data.rows.map((r, i) => `${i + 1},"${r.shiftName} { ${r.shiftCode} }",${r.totalSale},${r.dSale},${r.aSale},${r.comm},${r.oDara},${r.oAkhar},${r.tpc},${r.hissa},${r.closing}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${PAGE_TITLE.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">{PAGE_TITLE}</span>
            <span className="text-slate-600 font-medium">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <span className="text-slate-600 font-medium">To</span>
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
                <th className="py-2.5 px-4 border-r border-[#223b63]">Shift</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Total Sale</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Dara Sale</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Akhar Sale</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Comm</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Dara Open</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Akhar Open</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">TPC</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Hissa</th>
                <th className="py-2.5 px-4 text-right">Closing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">No declared shifts found for this filter.</td></tr>
              ) : (
                data.rows.map((r, idx) => (
                  <tr key={r.shiftId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">
                      {r.shiftName} <span className="text-slate-400 font-normal normal-case">{`{ ${r.shiftCode} }`}</span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.totalSale)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.dSale)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.aSale)}</td>
                    <td className="py-2 px-4 text-right font-mono text-rose-700 border-r border-slate-200">{fmt(r.comm)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.oDara)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.oAkhar)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.tpc)}</td>
                    <td className={`py-2 px-4 text-right font-mono border-r border-slate-200 ${r.hissa >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>{fmt(r.hissa)}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold ${r.closing >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.closing)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {data && data.rows.length > 0 && data.masterTotal && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className="py-2 px-3 text-center border-r border-[#223b63]">{data.masterTotal.shiftCount}</td>
                  <td className="py-2 px-4 border-r border-[#223b63]">Shift</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.totalSale)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.dSale)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.aSale)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.comm)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.oDara)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.oAkhar)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.tpc)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.hissa)}</td>
                  <td className="py-2 px-4 text-right font-mono">{fmt(data.masterTotal.closing)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
