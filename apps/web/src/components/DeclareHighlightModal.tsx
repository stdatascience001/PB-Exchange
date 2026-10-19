import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';
import {
  DECLARE_HIGHLIGHT_PAGE_LABELS, DeclareHighlightPage, loadDeclareHighlight, publishDeclareHighlight,
} from '../utils/declaredHighlight.js';

// Super Admin → profile menu → "Declare Highlight": one tick per page. A ticked page shows the
// declared result highlighted (the number and its Andar / Bahar haruf, in its grids and Jantri
// popups); an unticked one shows them plain. Saved for everyone (PUT /settings/declare-highlight).
export const DeclareHighlightModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [pages, setPages] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadDeclareHighlight(true)
      .then(m => setPages({ ...m }))
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
  const allOn = DECLARE_HIGHLIGHT_PAGE_LABELS.every(x => isOn(x.page));
  const setAll = (v: boolean) => setPages(Object.fromEntries(DECLARE_HIGHLIGHT_PAGE_LABELS.map(x => [x.page, v])));

  const save = async () => {
    setSaving(true);
    try {
      const full = Object.fromEntries(DECLARE_HIGHLIGHT_PAGE_LABELS.map(x => [x.page, isOn(x.page)]));
      const res = await apiRequest<{ pages: Record<string, boolean> }>('/settings/declare-highlight', {
        method: 'PUT',
        body: JSON.stringify({ pages: full }),
      });
      publishDeclareHighlight(res.data?.pages || full);
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

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-[200] animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden border border-slate-300">
        <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide">Declare Highlight</h2>
          <button type="button" onClick={onClose} className="text-white hover:text-slate-300 p-0.5" title="Close (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 text-xs text-slate-700">
          <p className="mb-3 text-slate-500">
            Tick a page to show the declared result highlighted on it (the number and its Andar / Bahar
            haruf, in its grid and Jantri popups).
          </p>
          {loading ? (
            <div className="py-8 text-center text-slate-400">Loading...</div>
          ) : (
            <>
              <label className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-200 font-bold text-slate-800 cursor-pointer">
                <input type="checkbox" checked={allOn} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 cursor-pointer" />
                All Pages
              </label>
              {menus.map(menu => (
                <div key={menu} className="mb-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{menu}</div>
                  {DECLARE_HIGHLIGHT_PAGE_LABELS.filter(x => x.menu === menu).map(x => (
                    <label key={x.page} className="flex items-center gap-2 py-1 pl-1 font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 rounded">
                      <input
                        type="checkbox"
                        checked={isOn(x.page)}
                        onChange={(e) => setPages(prev => ({ ...prev, [x.page]: e.target.checked }))}
                        className="h-4 w-4 cursor-pointer"
                      />
                      {x.label}
                    </label>
                  ))}
                </div>
              ))}
            </>
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
