import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LedgerDto } from '@pb/types';

// Party picker shared by Settling Report and Admin Cash (report Party box + payment form): parties
// whose name STARTS WITH the typed text, A-Z, arrow keys to move, Enter/click to pick.
export const PartyPicker: React.FC<{
  parties: LedgerDto[];
  value: string;
  onChange: (text: string) => void;
  onPick: (p: LedgerDto) => void;
  onInvalid: () => void;
  // Typed text that isn't any party's name (checked on leaving the box and on Enter).
  onInvalidName?: () => void;
  className: string;
  inputRef?: React.RefObject<HTMLInputElement>;
  // Hint shown in the empty box (e.g. "ENTER SETTLE A/C"); unset = none, as before
  placeholder?: string;
}> = ({ parties, value, onChange, onPick, onInvalid, onInvalidName, className, inputRef, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const boxRef = inputRef || ownInputRef;
  // The list is position:fixed off the input's screen rect, so no card/overflow can clip it,
  // and it opens UPWARD when there isn't room below (e.g. the payment form at the page foot).
  const LIST_MAX_H = 208;
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const place = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const openUp = below < LIST_MAX_H + 8 && r.top > below;
    setPos(openUp
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top }
      : { left: r.left, width: r.width, top: r.bottom });
  };
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const options = useMemo(() => {
    const term = value.trim().toUpperCase();
    if (!term) return [];
    return parties
      .filter(p => p.partyName.toUpperCase().startsWith(term))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
  }, [parties, value]);

  useEffect(() => setHi(0), [value]);
  useEffect(() => {
    (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const pick = (p: LedgerDto) => {
    setOpen(false);
    onPick(p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi(h => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = parties.find(p => p.partyName.toUpperCase() === value.trim().toUpperCase());
      const choice = open && options[hi] ? options[hi] : exact;
      if (choice) pick(choice);
      else if (value.trim() && onInvalidName) onInvalidName();
      else onInvalid();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={boxRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          // Leaving the box with text that matches no party (e.g. "SDFDSF") is rejected.
          const typed = value.trim().toUpperCase();
          if (typed && onInvalidName && !parties.some(p => p.partyName.toUpperCase() === typed)) onInvalidName();
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className={className}
      />
      {open && pos && options.length > 0 && (
        <div
          ref={listRef}
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: LIST_MAX_H }}
          className="bg-white border border-slate-400 shadow-2xl z-[1000] overflow-y-auto"
        >
          {options.map((p, i) => (
            <div
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHi(i)}
              className={`px-2 py-0.5 text-[13px] uppercase cursor-pointer ${i === hi ? 'bg-[#f6c343] font-bold text-slate-900' : 'text-slate-800'}`}
            >
              {p.partyName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
