import React, { useEffect, useMemo, useRef, useState } from 'react';

interface PartyNameInputProps {
  value: string;
  onChange: (value: string) => void;
  // Every party name that can be picked (already de-duplicated by the caller or not — the
  // list is de-duplicated and sorted here).
  names: string[];
  placeholder?: string;
  className?: string;
  // Optional DOM id for the input (lets a parent move focus to it)
  id?: string;
  // false: Enter on an EMPTY box doesn't pick the highlighted name (lets a parent's Enter
  // flow step past a blank box). Default true — unchanged behavior everywhere else.
  pickOnEmpty?: boolean;
  // true: ↑/↓ writes the highlighted name into the box as it moves (the list stays as it
  // was before the arrows, so you can keep scrolling), and Enter keeps it. Default false.
  fillOnArrow?: boolean;
}

// Party name box with its own dropdown, in place of a native <datalist>: the whole party list
// A-Z on focus, narrowed as you type (names starting with the text first, then ones that only
// contain it), ↑/↓ + Enter to pick, Esc to close. Free text is still allowed — the value is
// whatever is typed or picked, same as the datalist input it replaces.
// The list is position:fixed off the input's screen rect so a popup's overflow can't clip it.
export const PartyNameInput: React.FC<PartyNameInputProps> = ({ value, onChange, names, placeholder, className, id, pickOnEmpty = true, fillOnArrow = false }) => {
  const [open, setOpen] = useState(false);
  // fillOnArrow: the text the list was filtered by when ↑/↓ started filling the box — held
  // so the list doesn't narrow down to the name just written in. null = filter by the box.
  const [arrowQuery, setArrowQuery] = useState<string | null>(null);
  const filterText = arrowQuery ?? value;
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const unique = Array.from(new Set(names.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const term = filterText.trim().toUpperCase();
    if (!term) return unique;
    const starts = unique.filter(n => n.toUpperCase().startsWith(term));
    const contains = unique.filter(n => !n.toUpperCase().startsWith(term) && n.toUpperCase().includes(term));
    return [...starts, ...contains];
  }, [names, filterText]);

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom, width: Math.max(r.width, 220) });
  };

  useEffect(() => setHi(0), [filterText]);
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
    setArrowQuery(null);
  };

  // fillOnArrow: move the highlight and write that name into the box
  const arrowFill = (dir: 1 | -1) => {
    if (options.length === 0) return;
    if (arrowQuery === null) setArrowQuery(value);
    // The first ↑/↓ (box not filled from the list yet) takes the row already highlighted —
    // the first item — instead of skipping past it; later presses move up / down.
    const next = arrowQuery === null
      ? Math.min(Math.max(hi, 0), options.length - 1)
      : Math.min(Math.max(hi + dir, 0), options.length - 1);
    setOpen(true);
    setHi(next);
    onChange(options[next]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (fillOnArrow && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      arrowFill(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi(h => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && open && options[hi] && (pickOnEmpty || value.trim() !== '')) {
      e.preventDefault();
      pick(options[hi]);
    } else if (e.key === 'Escape') {
      // An open list takes the first Esc (the popup around it stays open)
      if (open) e.stopPropagation();
      setOpen(false);
      setArrowQuery(null);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => { setArrowQuery(null); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); setArrowQuery(null); }, 150)}
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
