import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { CopyCheck, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export const DuplicatePage: React.FC = () => {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<any[]>('/duplicates');
      setReviews(res.data);
    } catch (err) {
      console.warn('Failed to load duplicate reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const handleResolve = async (id: number, status: 'CONFIRMED' | 'DISMISSED') => {
    try {
      await apiRequest(`/duplicates/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      fetchReviews();
    } catch (err: any) {
      alert(err.message || 'Action failed');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div className="bg-[#0d1527] border border-slate-800 p-4 rounded-xl flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold">
          <CopyCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-black text-white">
            DUPLICATE TRANSACTION REVIEW
          </h1>
          <p className="text-xs text-slate-400">
            Identifies slips entered with similar number patterns in the same shift. Review and confirm or dismiss.
          </p>
        </div>
      </div>

      <div className="bg-[#0c1324] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#090e1c] text-slate-400 font-mono uppercase text-[10px]">
                <th className="py-3 px-3.5">Review #</th>
                <th className="py-3 px-3.5">Original Slip ID</th>
                <th className="py-3 px-3.5">Candidate Duplicate ID</th>
                <th className="py-3 px-3.5 text-center">Similarity</th>
                <th className="py-3 px-3.5 text-center">Status</th>
                <th className="py-3 px-3.5 text-right">Review Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No duplicate transaction warnings pending review.
                  </td>
                </tr>
              ) : (
                reviews.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-900/50">
                    <td className="py-3 px-3.5 font-mono text-slate-500">#{r.id}</td>
                    <td className="py-3 px-3.5 font-mono font-bold text-white">Slip #{r.originalTransactionId}</td>
                    <td className="py-3 px-3.5 font-mono font-bold text-rose-400">Slip #{r.duplicateTransactionId}</td>
                    <td className="py-3 px-3.5 text-center font-mono font-bold text-amber-400">
                      {r.similarityScore}% match
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        r.status === 'CONFIRMED'
                          ? 'bg-rose-950/60 text-rose-400 border border-rose-800/50'
                          : r.status === 'DISMISSED'
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                          : 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      {r.status === 'PENDING' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleResolve(r.id, 'CONFIRMED')}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded text-[11px]"
                          >
                            Confirm Duplicate
                          </button>
                          <button
                            onClick={() => handleResolve(r.id, 'DISMISSED')}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded text-[11px]"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 font-mono">Resolved</span>
                      )}
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
