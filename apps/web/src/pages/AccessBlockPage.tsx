import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { X, ShieldAlert } from 'lucide-react';

interface BlockedIpItem {
  id: number;
  ipAddress: string;
  reason?: string;
  blockedBy: number;
  isActive: boolean;
  createdAt: string;
}

export const AccessBlockPage: React.FC = () => {
  const [blockedList, setBlockedList] = useState<BlockedIpItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);

  // Form State
  const [ipAddress, setIpAddress] = useState('');
  const [reason, setReason] = useState('Suspicious automated activity');

  const fetchBlocked = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<BlockedIpItem[]>('/access');
      if (res.data) {
        setBlockedList(res.data);
      }
    } catch (err) {
      console.warn('Failed to load blocked IPs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlocked();
  }, []);

  // F2 Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setShowModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipAddress.trim()) return;

    try {
      await apiRequest('/access', {
        method: 'POST',
        body: JSON.stringify({ ipAddress: ipAddress.trim(), reason }),
      });
      setShowModal(false);
      setIpAddress('');
      fetchBlocked();
    } catch (err: any) {
      alert(err.message || 'Failed to block IP');
    }
  };

  const handleUnblock = async (id: number) => {
    if (!window.confirm('Unblock this IP address?')) return;
    try {
      await apiRequest(`/access/${id}`, { method: 'DELETE' });
      fetchBlocked();
    } catch (err: any) {
      alert(err.message || 'Unblock failed');
    }
  };

  const filteredIps = blockedList.filter(b =>
    b.ipAddress.includes(searchTerm) ||
    (b.reason && b.reason.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-full bg-[#eaedf2] p-4 sm:p-5 flex flex-col justify-between text-slate-800 select-none">
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {/* Subheader Filter Bar */}
        <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm text-slate-800">Access Block</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 font-medium">Search</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder=""
                className="w-48 sm:w-64 px-3 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-5 py-2 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow transition-colors flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>Add (F2)</span>
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-xs">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-14 text-center">Sr. No</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Blocked IP Address</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Reason / Violation</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Blocked By</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Blocked Date</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Status</th>
                <th className="py-2.5 px-3 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans text-xs">
              {filteredIps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No blocked IP addresses currently active.
                  </td>
                </tr>
              ) : (
                filteredIps.map((b, idx) => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600 border-r border-slate-100">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-4 font-bold font-mono text-rose-600 border-r border-slate-100">
                      {b.ipAddress}
                    </td>
                    <td className="py-2.5 px-4 border-r border-slate-100 text-slate-700 font-medium">
                      {b.reason || 'Unauthorized Access Attempt'}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold text-slate-600 border-r border-slate-100">
                      Admin #{b.blockedBy}
                    </td>
                    <td className="py-2.5 px-4 text-center text-slate-500 font-mono text-[11px] border-r border-slate-100">
                      {new Date(b.createdAt).toLocaleString('en-GB')}
                    </td>
                    <td className="py-2.5 px-3 text-center border-r border-slate-100">
                      <span className="px-2.5 py-0.5 bg-rose-600 text-white rounded-full text-[10px] font-bold uppercase shadow-sm">
                        BLOCKED
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => handleUnblock(b.id)}
                        className="px-3 py-1 bg-slate-700 hover:bg-slate-800 text-white rounded text-[11px] font-bold shadow-sm"
                      >
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-[#152847] text-white font-bold text-xs">
                <th className="py-2 px-3 border-r border-[#223b63] text-center">Sr. No</th>
                <th className="py-2 px-4 border-r border-[#223b63]">Blocked IP Address</th>
                <th className="py-2 px-4 border-r border-[#223b63]">Reason / Violation</th>
                <th className="py-2 px-4 border-r border-[#223b63] text-center">Blocked By</th>
                <th className="py-2 px-4 border-r border-[#223b63] text-center">Blocked Date</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">Status</th>
                <th className="py-2 px-3 text-center">Action</th>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-xs font-semibold">
          Need Help?
        </div>
      </div>

      {/* Block IP Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1b2b48] text-white px-5 py-3 flex items-center justify-between">
              <h2 className="text-base font-bold tracking-wide">Block Client IP Address</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleBlock} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">IP Address (IPv4 / IPv6)</label>
                <input
                  type="text"
                  required
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                  placeholder="e.g. 157.49.37.106"
                  className="w-full px-3 py-1.5 bg-[#fef08a] border border-amber-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Block Reason</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. DDOS or unauthorized bot"
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs"
                />
              </div>

              <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
                <button
                  type="submit"
                  className="px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-xs transition-colors shadow-sm"
                >
                  Block IP
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 font-bold text-xs"
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
