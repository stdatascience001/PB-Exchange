import React, { useState, useEffect } from 'react';
import { UserSession, ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

interface OperatorUser {
  userId: number;
  username: string;
  fullName?: string;
  designation?: string;
  roleName?: string;
}

interface ShiftPermissionRow {
  shiftId: number;
  shiftName: string;
  shiftDate: string; // YYYY-MM-DD
  canAllow: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  allSelf: boolean;
  dataScope: string; // AFT-, ALL, SELF
  expiresAt: string; // YYYY-MM-DDTHH:mm or formatted
  saving?: boolean;
}

interface DeclareTransPermissionPageProps {
  shifts?: ShiftDto[];
  user?: UserSession | null;
}

const DEFAULT_SHIFTS = [
  { id: 1, name: 'DELHI BAZAAR' },
  { id: 2, name: 'SHRI GANESH' },
  { id: 3, name: 'JAI LUXMI' },
  { id: 4, name: 'PUNJAB DAY' },
  { id: 5, name: 'HYDRABAD' },
  { id: 6, name: 'HIMALAYA' },
  { id: 7, name: 'FARIDABAD' },
  { id: 8, name: 'NEW FARIDABAD' },
  { id: 9, name: 'GHAZIABAD' },
  { id: 10, name: 'GALI' },
  { id: 11, name: 'DESHAWER' },
];

export const DeclareTransPermissionPage: React.FC<DeclareTransPermissionPageProps> = ({
  shifts = [],
  user,
}) => {
  const [operators, setOperators] = useState<OperatorUser[]>([]);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [operatorSearch, setOperatorSearch] = useState('');
  const [selectedOperator, setSelectedOperator] = useState<OperatorUser | null>(null);

  const [permissions, setPermissions] = useState<ShiftPermissionRow[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Initialize permission table rows
  const activeShiftsList = shifts.length > 0
    ? shifts.map(s => ({ id: s.id, name: s.name.replace(/\s*\(\d+\)\s*$/, '').trim() }))
    : DEFAULT_SHIFTS;

  const initEmptyPermissions = (): ShiftPermissionRow[] => {
    const todayStr = new Date().toISOString().split('T')[0];
    return activeShiftsList.map(s => ({
      shiftId: s.id,
      shiftName: s.name,
      shiftDate: todayStr,
      canAllow: false,
      canAdd: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
      allSelf: false,
      dataScope: 'AFT-',
      expiresAt: '',
    }));
  };

  const fetchOperators = async () => {
    setLoadingOperators(true);
    try {
      const res = await apiRequest<OperatorUser[]>('/shifts/permissions/operators');
      if (res.data && res.data.length > 0) {
        setOperators(res.data);
        if (!selectedOperator) {
          setSelectedOperator(res.data[0]);
        }
      } else {
        // Fallback default operators if none returned
        const fallbacks: OperatorUser[] = [
          { userId: 1, username: 'B08', roleName: 'OPERATOR' },
          { userId: 2, username: 'B09', roleName: 'OPERATOR' },
          { userId: 3, username: 'B10', roleName: 'OPERATOR' },
          { userId: 4, username: 'B13', roleName: 'OPERATOR' },
          { userId: 5, username: 'A34', roleName: 'OPERATOR' },
          { userId: 6, username: 'B28', roleName: 'OPERATOR' },
        ];
        setOperators(fallbacks);
        if (!selectedOperator) setSelectedOperator(fallbacks[0]);
      }
    } catch (err) {
      console.warn('Failed to load operators:', err);
    } finally {
      setLoadingOperators(false);
    }
  };

  const fetchPermissions = async (userId: number) => {
    setLoadingPerms(true);
    try {
      const res = await apiRequest<any[]>(`/shifts/permissions/${userId}`);
      const empty = initEmptyPermissions();
      if (res.data && res.data.length > 0) {
        const mapped = empty.map(row => {
          const found = res.data?.find((p: any) => p.shiftId === row.shiftId);
          if (found) {
            return {
              ...row,
              shiftDate: found.shiftDate ? found.shiftDate.split('T')[0] : row.shiftDate,
              canAllow: !!found.canAllow,
              canAdd: !!found.canAdd,
              canEdit: !!found.canEdit,
              canDelete: !!found.canDelete,
              canExport: !!found.canExport,
              allSelf: found.dataScope === 'ALL',
              dataScope: found.dataScope || 'AFT-',
              expiresAt: found.expiresAt ? found.expiresAt.slice(0, 16) : '',
            };
          }
          return row;
        });
        setPermissions(mapped);
      } else {
        setPermissions(empty);
      }
    } catch (err) {
      console.warn('Failed to load permissions:', err);
      setPermissions(initEmptyPermissions());
    } finally {
      setLoadingPerms(false);
    }
  };

  useEffect(() => {
    fetchOperators();
  }, []);

  useEffect(() => {
    if (selectedOperator) {
      fetchPermissions(selectedOperator.userId);
    } else {
      setPermissions(initEmptyPermissions());
    }
  }, [selectedOperator?.userId]);

  const updateRow = (index: number, updates: Partial<ShiftPermissionRow>) => {
    setPermissions(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const handleSaveRow = async (row: ShiftPermissionRow, index: number) => {
    if (!selectedOperator) {
      alert('Please select an operator first.');
      return;
    }

    updateRow(index, { saving: true });
    setStatusMessage(null);

    try {
      await apiRequest(`/shifts/permissions/${selectedOperator.userId}`, {
        method: 'POST',
        body: JSON.stringify({
          permissions: [
            {
              shiftId: row.shiftId,
              shiftDate: row.shiftDate,
              canAllow: row.canAllow,
              canAdd: row.canAdd,
              canEdit: row.canEdit,
              canDelete: row.canDelete,
              canExport: row.canExport,
              dataScope: row.allSelf ? 'ALL' : row.dataScope,
              expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
            },
          ],
        }),
      });
      setStatusMessage({ type: 'success', text: `Permissions for ${row.shiftName} saved successfully!` });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save permissions.' });
    } finally {
      updateRow(index, { saving: false });
    }
  };

  const filteredOperators = operators.filter(op =>
    op.username.toLowerCase().includes(operatorSearch.toLowerCase()) ||
    (op.fullName && op.fullName.toLowerCase().includes(operatorSearch.toLowerCase()))
  );

  return (
    <div className="min-h-[calc(100vh-82px)] bg-[#eaedf2] p-3 sm:p-4 text-slate-800 select-none font-sans text-xs">
      {/* Top Header Label matching Screenshot 2 */}
      <div className="mb-3">
        <div className="inline-block bg-white border border-slate-300 rounded px-3 py-1.5 text-slate-900 text-xs font-bold shadow-xs">
          Declare Trans Permission
        </div>
      </div>

      {statusMessage && (
        <div className={`mb-3 px-3 py-2 rounded text-xs font-bold border ${
          statusMessage.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
            : 'bg-rose-50 text-rose-800 border-rose-300'
        }`}>
          {statusMessage.text}
        </div>
      )}

      {/* Main Layout: Left Sidebar + Right Permissions Table */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col md:flex-row">
        {/* LEFT: Operator Sidebar matching Screenshot 2 */}
        <div className="w-full md:w-56 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-300 flex flex-col flex-shrink-0">
          {/* Reload Operator Button */}
          <button
            type="button"
            onClick={fetchOperators}
            disabled={loadingOperators}
            className="w-full py-2.5 px-3 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs uppercase tracking-wide transition-colors cursor-pointer border-b border-teal-800 flex items-center justify-center gap-1.5"
          >
            {loadingOperators ? 'Loading...' : 'Reload Operator'}
          </button>

          {/* Yellow Search Box */}
          <div className="p-2 border-b border-slate-200 bg-white">
            <input
              type="text"
              value={operatorSearch}
              onChange={(e) => setOperatorSearch(e.target.value)}
              placeholder="SEARCH..."
              className="w-full px-2.5 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Operator List */}
          <div className="flex-1 overflow-y-auto max-h-[550px] divide-y divide-slate-200 bg-white">
            {filteredOperators.length === 0 ? (
              <div className="p-4 text-center text-slate-400 font-medium">
                No operators found
              </div>
            ) : (
              filteredOperators.map(op => {
                const isSelected = selectedOperator?.userId === op.userId;
                return (
                  <button
                    key={op.userId}
                    type="button"
                    onClick={() => setSelectedOperator(op)}
                    className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-100 text-blue-900 border-l-4 border-blue-600 font-extrabold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="uppercase">{op.username}</span>
                    {op.fullName && (
                      <span className="text-[10px] text-slate-400 font-normal truncate max-w-[100px]">
                        {op.fullName}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: Main Shift Permissions Table matching Screenshot 2 */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <table className="w-full text-left text-xs border-separate border-spacing-0">
            <thead className="bg-[#152847]">
              <tr className="bg-[#152847] text-white font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-b border-[#223b63] w-12 text-center">SR</th>
                <th className="py-2.5 px-3 border-r border-b border-[#223b63] min-w-32">SHIFT</th>
                <th className="py-2.5 px-3 border-r border-b border-[#223b63] w-36 text-center">SHIFT DATE</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-14 text-center">ALLOW</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-14 text-center">ADD</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-14 text-center">EDIT</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-14 text-center">DELETE</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-14 text-center">EXPORT</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-16 text-center">ALL/SELF</th>
                <th className="py-2.5 px-2.5 border-r border-b border-[#223b63] w-20 text-center">DATA</th>
                <th className="py-2.5 px-3 border-r border-b border-[#223b63] min-w-44 text-center">EXPIRY</th>
                <th className="py-2.5 px-3 border-b border-[#223b63] w-20 text-center">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white font-sans text-xs whitespace-nowrap">
              {loadingPerms ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400 font-medium">
                    Loading permissions...
                  </td>
                </tr>
              ) : permissions.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400 font-medium">
                    No shifts configured.
                  </td>
                </tr>
              ) : (
                permissions.map((row, idx) => (
                  <tr key={row.shiftId} className="hover:bg-slate-50 transition-colors">
                    {/* SR */}
                    <td className="py-2 px-3 text-center font-mono font-semibold text-slate-600 border-r border-b border-slate-200">
                      {idx + 1}
                    </td>

                    {/* SHIFT */}
                    <td className="py-2 px-3 font-bold text-slate-900 uppercase border-r border-b border-slate-200">
                      {row.shiftName}
                    </td>

                    {/* SHIFT DATE */}
                    <td className="py-1.5 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="date"
                        value={row.shiftDate}
                        onChange={(e) => updateRow(idx, { shiftDate: e.target.value })}
                        className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* ALLOW */}
                    <td className="py-2 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="checkbox"
                        checked={row.canAllow}
                        onChange={(e) => updateRow(idx, { canAllow: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* ADD */}
                    <td className="py-2 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="checkbox"
                        checked={row.canAdd}
                        onChange={(e) => updateRow(idx, { canAdd: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* EDIT */}
                    <td className="py-2 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="checkbox"
                        checked={row.canEdit}
                        onChange={(e) => updateRow(idx, { canEdit: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* DELETE */}
                    <td className="py-2 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="checkbox"
                        checked={row.canDelete}
                        onChange={(e) => updateRow(idx, { canDelete: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* EXPORT */}
                    <td className="py-2 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="checkbox"
                        checked={row.canExport}
                        onChange={(e) => updateRow(idx, { canExport: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* ALL/SELF */}
                    <td className="py-2 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="checkbox"
                        checked={row.allSelf}
                        onChange={(e) => updateRow(idx, { allSelf: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* DATA */}
                    <td className="py-1.5 px-2 text-center border-r border-b border-slate-200">
                      <select
                        value={row.dataScope}
                        onChange={(e) => updateRow(idx, { dataScope: e.target.value })}
                        className="px-1.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="AFT-">AFT-</option>
                        <option value="ALL">ALL</option>
                        <option value="SELF">SELF</option>
                      </select>
                    </td>

                    {/* EXPIRY */}
                    <td className="py-1.5 px-2.5 text-center border-r border-b border-slate-200">
                      <input
                        type="datetime-local"
                        value={row.expiresAt}
                        onChange={(e) => updateRow(idx, { expiresAt: e.target.value })}
                        className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* ACTION */}
                    <td className="py-1.5 px-2.5 text-center border-b border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleSaveRow(row, idx)}
                        disabled={row.saving}
                        className="px-3 py-1 bg-[#1d4ed8] hover:bg-[#1e40af] active:bg-[#1e3a8a] disabled:bg-blue-300 text-white font-bold text-xs rounded uppercase tracking-wider shadow-xs transition-colors cursor-pointer"
                      >
                        {row.saving ? '...' : 'SAVE'}
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
