import React, { useEffect, useMemo, useRef, useState } from 'react';

interface PartyNameInputProps {
  value: string;
  onChange: (value: string) => void;
  // Every party name that can be picked (already de-duplicated by the caller or not — the
  // list is de-duplicated and sorted here).
  names: string[];
  placeholder?: string;
  className?: string;
}

// Party name box with its own dropdown, in place of a native <datalist>: the whole party list
// A-Z on focus, narrowed as you type (names starting with the text first, then ones that only
// contain it), ↑/↓ + Enter to pick, Esc to close. Free text is still allowed — the value is
// whatever is typed or picked, same as the datalist input it replaces.
// The list is position:fixed off the input's screen rect so a popup's overflow can't clip it.
export const PartyNameInput: React.FC<PartyNameInputProps> = ({ value, onChange, names, placeholder, className }) => {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const unique = Array.from(new Set(names.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const term = value.trim().toUpperCase();
    if (!term) return unique;
    const starts = unique.filter(n => n.toUpperCase().startsWith(term));
    const contains = unique.filter(n => !n.toUpperCase().startsWith(term) && n.toUpperCase().includes(term));
    return [...starts, ...contains];
  }, [names, value]);

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom, width: Math.max(r.width, 220) });
  };

  useEffect(() => setHi(0), [value]);
  useEffect(() => {
    (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  // Keep the list under the box while the popup / page scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi(h => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && open && options[hi]) {
      e.preventDefault();
      pick(options[hi]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        placeholder={placeholder}
        className={className}
      />
      {open && rect && options.length > 0 && (
        <div
          ref={listRef}
          style={{ position: 'fixed', left: rect.left, top: rect.top + 2, width: rect.width }}
          className="z-[1000] max-h-56 overflow-y-auto bg-white border border-slate-300 rounded-md shadow-xl py-1"
        >
          {options.map((n, i) => (
            <div
              key={n}
              onMouseDown={(e) => { e.preventDefault(); pick(n); }}
              onMouseEnter={() => setHi(i)}
              className={`px-3 py-1.5 text-xs uppercase cursor-pointer ${i === hi ? 'bg-[#1e66d0] text-white' : 'text-slate-800 hover:bg-slate-100'}`}
            >
              {n}
            </div>
          ))}
        </div>
      )}
    </>
  );
};
