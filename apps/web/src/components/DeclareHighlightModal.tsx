import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';
import {
  DECLARE_HIGHLIGHT_PAGE_LABELS, DECLARE_HIGHLIGHT_ROLES, DeclareHighlightPage, DeclareHighlightRoles,
  loadDeclareHighlightSettings, publishDeclareHighlight,
} from '../utils/declaredHighlight.js';

// Super Admin → profile menu → "Declare Highlight": one row per page. The Page tick turns the
// highlight on for that page (the declared number and its Andar / Bahar haruf, in its grids and
// Jantri popups); the role ticks say which roles see it there. Saved for everyone
// (PUT /settings/declare-highlight).
const ROLE_LABELS: Record<string, string> = {
  'SUPER ADMIN': 'Super Admin',
  'DEVELOPER': 'Developer',
  'ADMIN': 'Admin',
  'MANAGER': 'Manager',
  'MARKETER': 'Marketer',
  'AUDITOR': 'Auditor',
  'DATA ENTRY OPERATOR': 'Data Entry Operator',
  'TALLY OPERATOR': 'Tally Operator',
};

export const DeclareHighlightModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [pages, setPages] = useState<Record<string, boolean>>({});
  const [roles, setRoles] = useState<DeclareHighlightRoles>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadDeclareHighlightSettings(true)
      .then(m => {
        setPages({ ...m.pages });
        setRoles(JSON.parse(JSON.stringify(m.roles || {})));
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isOn = (p: DeclareHighlightPage) => pages[p] !== false;
  const roleOn = (p: DeclareHighlightPage, r: string) => roles[p]?.[r] !== false;
  const allOn = DECLARE_HIGHLIGHT_PAGE_LABELS.every(x => isOn(x.page));
  const setAll = (v: boolean) => setPages(Object.fromEntries(DECLARE_HIGHLIGHT_PAGE_LABELS.map(x => [x.page, v])));
  const setRole = (p: DeclareHighlightPage, r: string, v: boolean) =>
    setRoles(prev => ({ ...prev, [p]: { ...(prev[p] || {}), [r]: v } }));
  const roleAllOn = (r: string) => DECLARE_HIGHLIGHT_PAGE_LABELS.every(x => roleOn(x.page, r));
  const setRoleAll = (r: string, v: boolean) =>
    setRoles(prev => {
      const next = { ...prev };
      for (const x of DECLARE_HIGHLIGHT_PAGE_LABELS) next[x.page] = { ...(next[x.page] || {}), [r]: v };
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const full = Object.fromEntries(DECLARE_HIGHLIGHT_PAGE_LABELS.map(x => [x.page, isOn(x.page)]));
      const fullRoles = Object.fromEntries(DECLARE_HIGHLIGHT_PAGE_LABELS.map(x => [
        x.page,
        Object.fromEntries(DECLARE_HIGHLIGHT_ROLES.map(r => [r, roleOn(x.page, r)])),
      ]));
      const res = await apiRequest<{ pages: Record<string, boolean>; roles?: DeclareHighlightRoles }>('/settings/declare-highlight', {
        method: 'PUT',
        body: JSON.stringify({ pages: full, roles: fullRoles }),
      });
      publishDeclareHighlight(res.data?.pages || full, res.data?.roles || fullRoles);
      toast.success(
        <div>
          <div className="font-bold text-base">Message</div>
          <div className="text-sm mt-0.5">Declare Highlight has been saved successfully!</div>
        </div>,
        { toastId: 'declare-highlight-saved' }
      );
      onClose();
    } catch (err: any) {
      toast.error(
        <div>
          <div className="font-bold text-base">Error</div>
          <div className="text-sm mt-0.5">{err?.message || 'Failed to save'}</div>
        </div>,
        { toastId: 'declare-highlight-error' }
      );
    } finally {
      setSaving(false);
    }
  };

  const menus = Array.from(new Set(DECLARE_HIGHLIGHT_PAGE_LABELS.map(x => x.menu)));
  const cell = 'px-1.5 py-1 text-center border-l border-slate-200';
  const box = 'h-4 w-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-[200] animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-300 flex flex-col max-h-[92vh]">
        <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide">Declare Highlight</h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-300 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 text-xs text-slate-700 overflow-auto">
          <p className="mb-3 text-slate-500">
            Tick a page to show the declared result highlighted on it (the number and its Andar / Bahar
            haruf, in its grid and Jantri popups), then tick the roles that see it there.
          </p>
          {loading ? (
            <div className="py-8 text-center text-slate-400">Loading...</div>
          ) : (
            <table className="w-full border border-slate-200 border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 text-left">Page</th>
                  {DECLARE_HIGHLIGHT_ROLES.map(r => (
                    <th key={r} className={`${cell} w-[88px] leading-tight`}>{ROLE_LABELS[r] || r}</th>
                  ))}
                </tr>
                {/* All: every page / every page for one role */}
                <tr className="border-t border-slate-200 font-bold text-slate-800">
                  <td className="px-2 py-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={allOn} onChange={(e) => setAll(e.target.checked)} className={box} />
                      All Pages
                    </label>
                  </td>
                  {DECLARE_HIGHLIGHT_ROLES.map(r => (
                    <td key={r} className={cell}>
                      <input
                        type="checkbox"
                        checked={roleAllOn(r)}
                        onChange={(e) => setRoleAll(r, e.target.checked)}
                        title={`${ROLE_LABELS[r] || r}: all pages`}
                        className={box}
                      />
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {menus.map(menu => (
                  <React.Fragment key={menu}>
                    <tr className="border-t border-slate-200">
                      <td colSpan={1 + DECLARE_HIGHLIGHT_ROLES.length} className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {menu}
                      </td>
                    </tr>
                    {DECLARE_HIGHLIGHT_PAGE_LABELS.filter(x => x.menu === menu).map(x => (
                      <tr key={x.page} className="hover:bg-slate-50">
                        <td className="px-2 py-1">
                          <label className="flex items-center gap-2 pl-1 font-semibold text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isOn(x.page)}
                              onChange={(e) => setPages(prev => ({ ...prev, [x.page]: e.target.checked }))}
                              className={box}
                            />
                            {x.label}
                          </label>
                        </td>
                        {DECLARE_HIGHLIGHT_ROLES.map(r => (
                          <td key={r} className={cell}>
                            <input
                              type="checkbox"
                              checked={roleOn(x.page, r)}
                              // an unticked page shows nothing to anyone — its role ticks wait until it is ticked again
                              disabled={!isOn(x.page)}
                              onChange={(e) => setRole(x.page, r, e.target.checked)}
                              title={`${x.label} — ${ROLE_LABELS[r] || r}`}
                              className={box}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-slate-600 hover:text-slate-900 font-semibold text-xs">
            Close
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="px-6 py-1.5 bg-[#152847] hover:bg-[#1e3a68] text-white font-bold text-xs rounded disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
