import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { X, Edit2, Trash2 } from 'lucide-react';

interface AgentItem {
  id: number;
  userId: number;
  agentName: string;
  group?: string;
  agent?: string;
  mainAgentName?: string;
  parentAgent?: string;
  parentAgentName?: string;
  parentAgentId?: number;
  commissionRate?: number;
  hissaPercentage?: number;
  contactNumber?: string;
  updatedBy?: string;
  updatedAt?: string;
  createdAt: string;
}

const formatAgentDate = (dateStr?: string) => {
  if (!dateStr) return '2023-04-02 14:12:57';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return dateStr;
  }
};

export const AgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [actionMenuOpenId, setActionMenuOpenId] = useState<number | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);

  // Form State matching pbmax1.com Image 3
  const [agentName, setAgentName] = useState('');
  const [mainAgentName, setMainAgentName] = useState('');
  const [parentAgentName, setParentAgentName] = useState('');

  // "Main Agent Name" is picked from the Cash Agent ledgers, not typed free-hand: on the live
  // reference the field opens a list holding exactly those parties whose Ledger Group is
  // "Cash Agent" (CASH 13 13 A/C, CASH ABHI, CASH AKASH, ... and BOOOK SALARIES), while
  // same-prefixed parties on another group — CASH AMAN AUG A/C, which is Fanter — are absent.
  // So creating a ledger under the Cash Agent group is what makes its Party Name appear here.
  const [cashAgentParties, setCashAgentParties] = useState<string[]>([]);
  const [showMainAgentList, setShowMainAgentList] = useState(false);
  const mainAgentBoxRef = useRef<HTMLDivElement>(null);

  // Empty input -> whole list; typing narrows it. Matches anywhere in the name so "AKASH"
  // finds "CASH AKASH", same as the reference's type-ahead.
  const mainAgentSuggestions = React.useMemo(() => {
    const term = mainAgentName.trim().toLowerCase();
    if (!term) return cashAgentParties;
    return cashAgentParties.filter((n) => n.toLowerCase().includes(term));
  }, [cashAgentParties, mainAgentName]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<AgentItem[]>('/agents');
      if (res.data) {
        setAgents(res.data);
      }
    } catch (err) {
      console.warn('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetched from the shared ledger list with its optional group filter, so only Cash Agent
  // parties come down the wire rather than every ledger.
  const fetchCashAgentParties = async () => {
    try {
      const res = await apiRequest<Array<{ partyName: string }>>(`/ledgers?group=${encodeURIComponent('Cash Agent')}`);
      if (res.data) {
        setCashAgentParties(
          res.data
            .map((l) => (l.partyName || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
        );
      }
    } catch (err) {
      // A failed lookup must not block agent creation — the field stays free-text.
      console.warn('Failed to load Cash Agent parties:', err);
    }
  };

  useEffect(() => {
    fetchAgents();
    fetchCashAgentParties();
  }, []);

  // Close the Main Agent Name suggestion list on an outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (mainAgentBoxRef.current && !mainAgentBoxRef.current.contains(e.target as Node)) {
        setShowMainAgentList(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Close action menu on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setActionMenuOpenId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Keyboard Shortcuts: F2 opens modal, F5 reloads, Escape closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openCreateModal();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        fetchAgents();
      }
      if (e.key === 'Escape' && showModal) {
        e.preventDefault();
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const openCreateModal = () => {
    setEditingAgentId(null);
    setAgentName('');
    setMainAgentName('');
    setParentAgentName('');
    setShowMainAgentList(false);
    // Re-read the Cash Agent parties each time the dialog opens, so a ledger created on the
    // Ledgers page shows up here without needing a full page reload.
    fetchCashAgentParties();
    setShowModal(true);
    setActionMenuOpenId(null);
  };

  const openEditModal = (agent: AgentItem) => {
    setShowMainAgentList(false);
    fetchCashAgentParties();
    setEditingAgentId(agent.id);
    setAgentName(agent.agentName || agent.group || '');
    setMainAgentName(agent.mainAgentName || (agent.agent !== 'VIKAS CASH' ? agent.agent : '') || '');
    setParentAgentName(agent.parentAgentName || agent.parentAgent || '');
    setShowModal(true);
    setActionMenuOpenId(null);
  };

  const handleDeleteAgent = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete agent "${name}"?`)) {
      return;
    }
    try {
      await apiRequest(`/agents/${id}`, {
        method: 'DELETE',
      });
      fetchAgents();
    } catch (err: any) {
      alert(err.message || 'Failed to delete agent');
    } finally {
      setActionMenuOpenId(null);
    }
  };

  const handleSearchClick = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(searchTerm.trim());
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) {
      alert('Agent Name is required');
      return;
    }

    try {
      if (editingAgentId) {
        await apiRequest(`/agents/${editingAgentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            agentName: agentName.trim().toUpperCase(),
            mainAgentName: mainAgentName.trim().toUpperCase() || 'VIKAS CASH',
            parentAgentName: parentAgentName.trim().toUpperCase() || '',
          }),
        });
      } else {
        await apiRequest('/agents', {
          method: 'POST',
          body: JSON.stringify({
            agentName: agentName.trim().toUpperCase(),
            mainAgentName: mainAgentName.trim().toUpperCase() || 'VIKAS CASH',
            parentAgentName: parentAgentName.trim().toUpperCase() || '',
          }),
        });
      }
      setShowModal(false);
      setAgentName('');
      setMainAgentName('');
      setParentAgentName('');
      setEditingAgentId(null);
      fetchAgents();
    } catch (err: any) {
      alert(err.message || 'Failed to save agent');
    }
  };

  const activeSearch = submittedSearch || searchTerm;
  const filteredAgents = agents.filter(a => {
    const term = activeSearch.toLowerCase().trim();
    if (!term) return true;
    return (
      (a.agentName && a.agentName.toLowerCase().includes(term)) ||
      (a.group && a.group.toLowerCase().includes(term)) ||
      (a.agent && a.agent.toLowerCase().includes(term)) ||
      (a.mainAgentName && a.mainAgentName.toLowerCase().includes(term)) ||
      (a.parentAgent && a.parentAgent.toLowerCase().includes(term)) ||
      (a.parentAgentName && a.parentAgentName.toLowerCase().includes(term)) ||
      (a.updatedBy && a.updatedBy.toLowerCase().includes(term))
    );
  });


  return (
    <div className="min-h-full bg-[#eaedf2] p-3 sm:p-4 flex flex-col justify-between text-slate-800 select-none font-sans">
      {/* Outer Card matching pbmax1.com */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden">
        {/* Subheader Filter Bar matching Image 2 */}
        <div className="p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <form onSubmit={handleSearchClick} className="flex items-center gap-3 text-xs">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Agent</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-semibold text-xs">Search</span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder=""
                className="w-44 sm:w-64 px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-inner"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-1 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors"
            >
              Search
            </button>
          </form>

          <button
            onClick={openCreateModal}
            className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>Add (F2)</span>
          </button>
        </div>

        {/* 7-Column Agents Table matching Image 2 */}
        {/* Agents table scrolls inside its own box (both ways), header row pinned at the top and
            footer row at the bottom, as on live */}
        <div className="overflow-auto max-h-[calc(100vh-230px)] min-h-[240px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Group</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Parent Agent</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated By</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated Date</th>
                <th className="py-2 px-2.5 text-center w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading && agents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    Loading agents...
                  </td>
                </tr>
              ) : filteredAgents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No agents found.
                  </td>
                </tr>
              ) : (
                filteredAgents.map((a, idx) => (
                  <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                    {/* Sr */}
                    <td className="py-1.5 px-2.5 text-center font-mono text-slate-600 border-r border-slate-200">
                      {idx + 1}
                    </td>

                    {/* Group */}
                    <td className="py-1.5 px-3.5 font-bold text-slate-900 uppercase tracking-tight border-r border-slate-200">
                      {a.group || a.agentName}
                    </td>

                    {/* Agent */}
                    <td className="py-1.5 px-3.5 font-medium uppercase text-slate-700 border-r border-slate-200">
                      {a.agent || a.mainAgentName || 'VIKAS CASH'}
                    </td>

                    {/* Parent Agent */}
                    <td className="py-1.5 px-3.5 font-medium uppercase text-slate-700 border-r border-slate-200">
                      {a.parentAgent || a.parentAgentName || ''}
                    </td>

                    {/* Updated By */}
                    <td className="py-1.5 px-3.5 font-semibold uppercase text-slate-700 border-r border-slate-200">
                      {a.updatedBy || 'A100'}
                    </td>

                    {/* Updated Date */}
                    <td className="py-1.5 px-3.5 font-mono text-slate-600 text-[11px] border-r border-slate-200">
                      {formatAgentDate(a.updatedAt || a.createdAt)}
                    </td>

                    {/* Action */}
                    <td className="py-1.5 px-2.5 text-center relative">
                      <div className="inline-block relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuOpenId(actionMenuOpenId === a.id ? null : a.id);
                          }}
                          className="px-2.5 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white rounded text-[10px] font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          Action
                        </button>

                        {/* Action Menu Dropdown */}
                        {actionMenuOpenId === a.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 mt-1 w-28 bg-white border border-slate-200 rounded shadow-xl py-1 z-30 text-xs text-left"
                          >
                            <button
                              type="button"
                              onClick={() => openEditModal(a)}
                              className="w-full px-3 py-1.5 hover:bg-blue-50 text-slate-800 flex items-center gap-2 font-medium"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAgent(a.id, a.agentName || a.group || '')}
                              className="w-full px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2 font-medium"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {/* Table Footer matching Image 2 */}
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center font-mono">
                  {filteredAgents.length}
                </th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Group</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Parent Agent</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated By</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated Date</th>
                <th className="py-2 px-2.5 text-center">Action</th>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Bottom Help Bar matching Image 2 */}
        <div className="p-2.5 bg-[#f8fafc] border-t border-slate-200 text-slate-500 text-xs font-semibold">
          <span className="hover:text-slate-800 cursor-pointer">Need Help?</span>
        </div>
      </div>

      {/* Agents Add/Edit Modal matching Image 3 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto">
          {/* No overflow-hidden here: it used to clip the Main Agent Name suggestion list at
              the card's bottom edge (the list rendered half-cut). The header carries rounded-t
              instead, so the corners still look the same. */}
          <div className="bg-white rounded shadow-2xl max-w-2xl w-full border border-slate-300 my-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header matching Image 3 */}
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between rounded-t">
              <h2 className="text-sm font-bold tracking-wide">Agents</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body Form matching Image 3 */}
            <form onSubmit={handleSaveAgent}>

              <div className="p-4 space-y-4 text-xs">
                {/* Single Row: Agent Name, Main Agent Name, Parent Agent Name */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Agent Name
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder=""
                      className="w-full px-2.5 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div className="relative" ref={mainAgentBoxRef}>
                    <label className="block text-slate-700 font-medium mb-1">
                      Main Agent Name
                    </label>
                    <input
                      type="text"
                      value={mainAgentName}
                      onChange={(e) => {
                        setMainAgentName(e.target.value);
                        setShowMainAgentList(true);
                      }}
                      onFocus={() => setShowMainAgentList(true)}
                      placeholder=""
                      autoComplete="off"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                    />
                    {/* Cash Agent parties, filtered as you type — an empty field shows the
                        whole list, the way the live reference opens it. */}
                    {showMainAgentList && mainAgentSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-400 shadow-lg rounded-xs z-50 max-h-48 overflow-y-auto pbmax-table-scrollbar">
                        {mainAgentSuggestions.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setMainAgentName(name);
                              setShowMainAgentList(false);
                            }}
                            className={`w-full text-left px-2.5 py-1 text-xs uppercase whitespace-nowrap overflow-hidden text-ellipsis border-b border-slate-100 last:border-b-0 focus:outline-none ${
                              name.toUpperCase() === mainAgentName.trim().toUpperCase()
                                ? 'bg-[#fef08a] text-slate-900 font-bold'
                                : 'text-slate-800 hover:bg-[#fef08a] focus:bg-[#fef08a]'
                            }`}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Parent Agent Name
                    </label>
                    <input
                      type="text"
                      value={parentAgentName}
                      onChange={(e) => setParentAgentName(e.target.value)}
                      placeholder=""
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer matching Image 3 */}
              <div className="p-3 bg-white border-t border-slate-200 flex justify-end items-center gap-3">
                <button
                  type="submit"
                  className="px-6 py-1.5 bg-[#152847] hover:bg-[#1e3a68] active:bg-[#0f1d33] text-white font-bold rounded text-xs transition-colors shadow-xs"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 text-slate-700 hover:text-slate-900 font-semibold text-xs transition-colors"
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
