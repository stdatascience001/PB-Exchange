import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

const PAGE_TITLE = 'Message';
const FIELD: 'message' | 'flashMessage' = 'message';
const COLUMN_LABEL = 'Message';

interface RoleMessageRow {
  roleId: number;
  roleName: string;
  message: string;
  flashMessage: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const titleCase = (s: string) => s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
const isShoutRole = (name: string) => name === 'DEVELOPER' || name === 'SUPER ADMIN' || name === 'ADMIN';

export const MessageManagePage: React.FC = () => {
  const [rows, setRows] = useState<RoleMessageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<number | null>(null);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<RoleMessageRow[]>('/messages');
      if (res.data) {
        setRows(res.data);
        const d: Record<number, string> = {};
        res.data.forEach(r => { d[r.roleId] = r[FIELD]; });
        setDrafts(d);
      }
    } catch (err) {
      console.warn('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const handleUpdate = async (roleId: number) => {
    setSavingRoleId(roleId);
    try {
      await apiRequest(`/messages/${roleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ field: FIELD, value: drafts[roleId] ?? '' }),
      });
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to update message');
    } finally {
      setSavingRoleId(null);
    }
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="mb-2.5">
        <div className="inline-block bg-white border border-slate-300 rounded px-3 py-1.5 text-slate-900 text-xs font-bold shadow-xs">
          {PAGE_TITLE}
        </div>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] w-44">Role</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">{COLUMN_LABEL}</th>
                <th className="py-2.5 px-4 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs">
              {loading ? (
                <tr><td colSpan={4} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="py-14 text-center text-slate-400 font-medium">No roles found.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.roleId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 border-r border-slate-200">
                      {isShoutRole(r.roleName) ? r.roleName : titleCase(r.roleName)}
                    </td>
                    <td className="py-1.5 px-4 border-r border-slate-200">
                      <input
                        type="text"
                        value={drafts[r.roleId] ?? ''}
                        onChange={(e) => setDrafts(prev => ({ ...prev, [r.roleId]: e.target.value }))}
                        placeholder="Enter message here..."
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="py-1.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleUpdate(r.roleId)}
                        disabled={savingRoleId === r.roleId}
                        className="px-4 py-1.5 bg-[#059669] hover:bg-[#047857] active:bg-[#065f46] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
                      >
                        {savingRoleId === r.roleId ? '...' : 'Update'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className="py-2 px-3 text-center border-r border-[#223b63]">Sr</td>
                  <td className="py-2 px-4 border-r border-[#223b63]">Role</td>
                  <td className="py-2 px-4 border-r border-[#223b63]">{COLUMN_LABEL}</td>
                  <td className="py-2 px-4 text-center">Action</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="pt-1.5 text-[10px] text-amber-600 font-semibold">Need Help?</div>
    </div>
  );
};
