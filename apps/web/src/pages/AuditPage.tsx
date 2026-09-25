import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { FileCheck2, ShieldCheck, Clock, User, CheckCircle2 } from 'lucide-react';

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<any[]>('/audit');
      setLogs(res.data);
    } catch (err) {
      console.warn('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="bg-[#0d1527] border border-slate-800 p-4 rounded-xl flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold">
          <FileCheck2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-black text-white">
            TRANSACTION AUDIT & COMPLIANCE LOGS
          </h1>
          <p className="text-xs text-slate-400">
            Immutable system audit trail tracking slip creations, updates, voids, result declarations, and IP block actions.
          </p>
        </div>
      </div>

      <div className="bg-[#0c1324] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#090e1c] text-slate-400 font-mono uppercase text-[10px]">
                <th className="py-3 px-3.5">Log #</th>
                <th className="py-3 px-3.5">Action</th>
                <th className="py-3 px-3.5">Target Entity</th>
                <th className="py-3 px-3.5">Target ID</th>
                <th className="py-3 px-3.5">Actor ID</th>
                <th className="py-3 px-3.5">Data Changes</th>
                <th className="py-3 px-3.5">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No audit records recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-900/50">
                    <td className="py-3 px-3.5 font-mono text-slate-500">#{l.id}</td>
                    <td className="py-3 px-3.5">
                      <span className="px-2 py-0.5 bg-blue-950/60 text-blue-300 border border-blue-800/50 rounded font-mono font-bold text-[10px]">
                        {l.action}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 font-bold text-white">{l.entityType}</td>
                    <td className="py-3 px-3.5 font-mono text-amber-400 font-semibold">{l.entityId}</td>
                    <td className="py-3 px-3.5 font-mono text-slate-400">User #{l.actorId}</td>
                    <td className="py-3 px-3.5 font-mono text-[11px] text-slate-400 max-w-xs truncate">
                      {JSON.stringify(l.afterData || l.beforeData || {})}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-400 text-[11px]">
                      {new Date(l.createdAt).toLocaleString()}
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
