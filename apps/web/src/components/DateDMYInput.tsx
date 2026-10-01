import React, { useEffect, useState } from 'react';

interface DateDMYInputProps {
  // YYYY-MM-DD (what the API gets); changes only once the three parts make a real date
  value: string;
  onChange: (value: string) => void;
  // DOM id prefix: parts are `${idPrefix}-dd`, `-mm`, `-yyyy`
  idPrefix: string;
  // Enter on the year part (e.g. focus the next filter); unset = Enter just stays
  onEnterFromYear?: () => void;
}

// Date box shown as DD / MM / YYYY (three parts, as the live panels do) instead of the
// browser's own locale picker. Enter steps day -> month -> year; Up/Down steps the focused
// part (wrapping within the month / year); only digits can be typed.
export const DateDMYInput: React.FC<DateDMYInputProps> = ({ value, onChange, idPrefix, onEnterFromYear }) => {
  const [dd, setDd] = useState(() => value.slice(8, 10));
  const [mm, setMm] = useState(() => value.slice(5, 7));
  const [yyyy, setYyyy] = useState(() => value.slice(0, 4));

  // Follow the value when it's set from outside
  useEffect(() => {
    setDd(value.slice(8, 10));
    setMm(value.slice(5, 7));
    setYyyy(value.slice(0, 4));
  }, [value]);

  const commit = (d: string, m: string, y: string) => {
    const di = parseInt(d, 10), mi = parseInt(m, 10), yi = parseInt(y, 10);
    if (!/^\d{4}$/.test(y) || !(mi >= 1 && mi <= 12) || !(di >= 1)) return;
    if (di > new Date(yi, mi, 0).getDate()) return;
    onChange(`${y}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`);
  };

  const focus = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };

  const onKeyDown = (part: 'dd' | 'mm' | 'yyyy', e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (part === 'dd') focus(`${idPrefix}-mm`);
      else if (part === 'mm') focus(`${idPrefix}-yyyy`);
      else onEnterFromYear?.();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = e.key === 'ArrowUp' ? 1 : -1;
    if (part === 'dd') {
      const max = new Date(parseInt(yyyy, 10) || 2000, parseInt(mm, 10) || 1, 0).getDate();
      let v = (parseInt(dd, 10) || 1) + step;
      if (v > max) v = 1;
      if (v < 1) v = max;
      const next = String(v).padStart(2, '0');
      setDd(next);
      commit(next, mm, yyyy);
    } else if (part === 'mm') {
      let v = (parseInt(mm, 10) || 1) + step;
      if (v > 12) v = 1;
      if (v < 1) v = 12;
      const next = String(v).padStart(2, '0');
      setMm(next);
      commit(dd, next, yyyy);
    } else {
      const next = String((parseInt(yyyy, 10) || new Date().getFullYear()) + step);
      setYyyy(next);
      commit(dd, mm, next);
    }
  };

  const seg = 'text-center bg-transparent outline-none font-semibold text-slate-700 focus:bg-[#fde68a] rounded-xs';
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs tracking-wider">
      <input
        id={`${idPrefix}-dd`}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={dd}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setDd(v); commit(v, mm, yyyy); }}
        onKeyDown={(e) => onKeyDown('dd', e)}
        className={`w-7 ${seg}`}
      />
      <span className="text-slate-500">/</span>
      <input
        id={`${idPrefix}-mm`}
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={mm}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setMm(v); commit(dd, v, yyyy); }}
        onKeyDown={(e) => onKeyDown('mm', e)}
        className={`w-7 ${seg}`}
      />
      <span className="text-slate-500">/</span>
      <input
        id={`${idPrefix}-yyyy`}
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={yyyy}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setYyyy(v); commit(dd, mm, v); }}
        onKeyDown={(e) => onKeyDown('yyyy', e)}
        className={`w-10 ${seg}`}
      />
    </div>
  );
};
