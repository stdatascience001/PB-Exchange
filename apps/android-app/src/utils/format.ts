// Display helpers in the live app's formats

const pad = (n: number) => String(n).padStart(2, '0');

// "2026-10-23" / ISO -> "23-10-2026"
export const dmy = (value?: string | null): string => {
  if (!value) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m && value.length <= 10) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};

// ISO -> "14-06-2022 04:38 PM"
export const dmyTime = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())} ${ampm}`;
};

// Date -> "YYYY-MM-DD" (API date params)
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Numbers as the live app prints them: whole rupees, no grouping ("1233653")
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
export const amount = (v: unknown): string => String(Math.round(num(v)));

// Rates "90/10-9/10" from a ledger's dara / akhar rate and commission
export const rateStr = (l: { daraRate: number | string; akharRate: number | string; commissionRate: number | string }): string => {
  const c = num(l.commissionRate);
  return `${num(l.daraRate)}/${c}-${num(l.akharRate)}/${c}`;
};

// Seconds -> "0 0:0:12" (days hours:minutes:seconds, as the live Staff Working list)
export const elapsed = (fromIso?: string | null, now = Date.now()): string => {
  if (!fromIso) return '0 0:0:0';
  const t = new Date(fromIso).getTime();
  if (isNaN(t)) return '0 0:0:0';
  let s = Math.max(0, Math.floor((now - t) / 1000));
  const days = Math.floor(s / 86400); s -= days * 86400;
  const hours = Math.floor(s / 3600); s -= hours * 3600;
  const mins = Math.floor(s / 60); s -= mins * 60;
  return `${days} ${hours}:${mins}:${s}`;
};
