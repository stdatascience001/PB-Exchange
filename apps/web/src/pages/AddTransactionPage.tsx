import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShiftDto, LedgerDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { displayNumber, harufOf } from '../utils/entryDisplay.js';
import { toast } from 'react-toastify';
import { ArrowLeft, X, Check, Search, Plus, Shuffle, Calendar, Clock } from 'lucide-react';

interface EntryRow {
  numberValue: string;
  amount: number;
  entryType: 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR';
}

// NUMBER box accepts only: 1-100 (1 or 01 ... 9 or 09, 10-99, 100 or 00), Bahar haruf
// 111 ... 999 / 000, and Andar haruf 1111 ... 9999 / 0000. Returns the value the grid shows
// (1 -> "01", 00 -> "100"), or null for anything else.
const normalizeTypedNumber = (raw: string): string | null => {
  const v = raw.trim();
  if (/^\d{1,2}$/.test(v)) {
    if (v === '00') return '100';
    const n = parseInt(v, 10);
    return n >= 1 && n <= 99 ? String(n).padStart(2, '0') : null;
  }
  if (v === '100') return '100';
  if (/^(\d)\1{2}$/.test(v) || /^(\d)\1{3}$/.test(v)) return v;
  return null;
};

// A-/B- prefixed haruf tokens (A5, B-3) keep their existing handling and aren't checked here.
const isPrefixedHaruf = (token: string) => /^[AB]/i.test(token.trim());

// Every NUMBER-box token valid? Covers "12 34", "5=100" / "5*100", and "1-10" ranges.
const allTypedNumbersValid = (rawInput: string): boolean => {
  const tokens = rawInput.trim().split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => {
    if (isPrefixedHaruf(token)) return true;
    const numPart = token.split(/[=*]/)[0];
    if (numPart.includes('-')) {
      const [a, b] = numPart.split('-');
      return normalizeTypedNumber(a || '') !== null && normalizeTypedNumber(b || '') !== null
        && /^\d{1,3}$/.test(a) && /^\d{1,3}$/.test(b)
        && parseInt(a, 10) >= 1 && parseInt(b, 10) <= 100 && parseInt(a, 10) <= parseInt(b, 10);
    }
    return normalizeTypedNumber(numPart) !== null;
  });
};

const showInvalidNumberToast = () => {
  toast.error(
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">Please enter a valid Number!</div>
    </div>,
    { toastId: 'invalid-number' }
  );
};

// Main NUMBER box's wrong-number toast, worded as on the live page ("Invalid Amount" /
// "Please enter a valid Amount!"). The popups keep showInvalidNumberToast above.
const showInvalidEntryToast = () => {
  toast.error(
    <div>
      <div className="font-bold text-base">Invalid Amount</div>
      <div className="text-sm mt-0.5">Please enter a valid Amount!</div>
    </div>,
    { toastId: 'invalid-entry-number' }
  );
};

// Jantri number 100 is stored as "00" (results are declared 00-99 and payout / Jantri match
// on "00"); the grid shows it as 100.
const toStoredNumber = (e: { numberValue: string; entryType: string }) =>
  e.entryType === 'DARA' && e.numberValue.trim() === '100' ? '00' : e.numberValue;

// F12 Jantri View cell key of an entry: "N1".."N100" for numbers (00 = 100), "B0".."B9" for
// Bahar haruf (111 / B1), "A0".."A9" for Andar haruf (1111 / A1), or null.
const jantriKeyOf = (e: { numberValue: string; entryType: string }): string | null => {
  const h = harufOf(e);
  if (h) return `${h.side}${h.digit}`;
  const v = e.numberValue.trim();
  if (!/^\d{1,3}$/.test(v)) return null;
  const n = v === '00' ? 100 : parseInt(v, 10);
  return n >= 1 && n <= 100 ? `N${n}` : null;
};

// Row value written back for a cell typed in the Jantri View — the same form the NUMBER box
// produces (01 ... 100, 111 for Bahar 1, 1111 for Andar 1).
const numberForJantriKey = (key: string): string => {
  const kind = key[0];
  const rest = key.slice(1);
  if (kind === 'B') return rest.repeat(3);
  if (kind === 'A') return rest.repeat(4);
  const n = parseInt(rest, 10);
  return n === 100 ? '100' : String(n).padStart(2, '0');
};

// Cross popup ANDER / BAHAR box: digits only, each digit at most once (a repeat is dropped,
// the first one kept), and no more than 8 digits.
const cleanCrossDigits = (raw: string): string => {
  let out = '';
  for (const ch of raw.replace(/\D/g, '')) {
    if (out.includes(ch)) continue;
    out += ch;
    if (out.length === 8) break;
  }
  return out;
};

// Palti = the number reversed. A single digit is padded first, so "2" -> "02" -> "20", and
// reversing "10" yields "01" which the live list shows as "1" (the leading zero is dropped
// for display; normalizeNumberValue pads it back server-side on save, so the stored value is
// unchanged either way). Twin digits such as "11" reverse to themselves and get no palti row.
// Shared by the Random (F4) and From-To (F7) popups so both follow one rule.
const paltiOfNumber = (num: string): string | null => {
  const cleaned = num.trim();
  let reversed: string | null = null;
  if (cleaned.length === 2 && cleaned[0] !== cleaned[1]) reversed = cleaned[1] + cleaned[0];
  else if (cleaned.length === 1) reversed = `${cleaned}0`;
  return reversed === null ? null : reversed.replace(/^0+(?=\d)/, '');
};

interface AddTransactionPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
  onSelectShift?: (shift: ShiftDto) => void;
  onNavigate?: (page: string, param?: string) => void;
  transactionId?: string;
  // Edit mode — reached via /transaction_edit/:shiftId/:txId (Transaction List's "Edit" button).
  // Distinct from `transactionId` above (which only resolves the shift/party, not the full
  // entry grid) so the ambiguous add-flow resume behavior is left untouched.
  editShiftId?: string;
  editTransactionId?: string;
  // Declare edit — /declare_transaction_edit/:shiftId/:txId (Declare Transactions' "Edit"):
  // the same edit grid, allowed on an already declared shift. Header reads "<SHIFT> [DECLARE]",
  // Time Left sits at 00:00:00, no copy-to-shift panel, and Save Now goes to
  // PATCH /transactions/:id/declare-entries. Every other mode is unchanged.
  declareEdit?: boolean;
  user?: UserSession | null;
}

export const AddTransactionPage: React.FC<AddTransactionPageProps> = ({
  shifts,
  activeShift,
  onSelectShift,
  onNavigate,
  transactionId,
  editShiftId,
  editTransactionId,
  declareEdit = false,
  user,
}) => {
  // When set, Save Now updates this existing transaction's entries instead of creating a new one.
  const [editingTxNumericId, setEditingTxNumericId] = useState<number | null>(null);
  // Declare edit: the slip's own entry date (its cycle), shown on the Date badge
  const [editTxDate, setEditTxDate] = useState<string | null>(null);
  // Party state
  const [parties, setParties] = useState<LedgerDto[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [selectedParty, setSelectedParty] = useState<LedgerDto | null>(null);
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);
  const [activePartyIndex, setActivePartyIndex] = useState(0);

  // Active shift resolution based on transactionId or props
  const [resolvedShift, setResolvedShift] = useState<ShiftDto | null>(activeShift || null);
  const [allShifts, setAllShifts] = useState<ShiftDto[]>(shifts);

  // Slips / Entries
  const [entriesList, setEntriesList] = useState<EntryRow[]>([]);
  const [inputNumber, setInputNumber] = useState('');
  const [inputAmount, setInputAmount] = useState('');

  // Right column: Copy transaction to other shifts & narration
  const [selectedCopyShiftIds, setSelectedCopyShiftIds] = useState<number[]>([]);
  const [copyToAll, setCopyToAll] = useState(false);
  const [narration, setNarration] = useState('');
  // Applied Narration list: one row per Cross / From-To popup saved into this slip, newest
  // first — "Cross | 1234 x 1235 / 10 / Y", "P-From-To | 1 x 10 / 10 /" (live panel).
  const [appliedNarrations, setAppliedNarrations] = useState<{ label: string; value: string }[]>([]);

  // Countdown to THIS shift's cut-off for the logged-in user's role — the time set per role
  // on Shift Manage's Time tab. Seeded from the shift's own timeRemainingSeconds (the API
  // already works it out as closeTime minus now for the caller's role, the same figure the
  // dashboard cards use) and then ticked locally so it runs smoothly between refreshes.
  // It used to start from a hardcoded 2h 22m 51s that had nothing to do with the shift.
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(0);

  // Feedback states
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Generator Modals
  // Cross (F6) — ANDER digits crossed against BAHAR digits, with a JODA Y/N switch that
  // decides whether the doubles (11, 22, ...) that a cross throws up are kept or dropped.
  const [showCrossModal, setShowCrossModal] = useState(false);
  const [crossAnder, setCrossAnder] = useState('');
  const [crossBahar, setCrossBahar] = useState('');
  const [crossAmountStr, setCrossAmountStr] = useState('');
  const [crossJoda, setCrossJoda] = useState<'Y' | 'N'>('Y');

  // Random (F8) — three sections keyed as unseparated digit runs: Dara in 2-digit pairs,
  // Akhar Bahar and Akhar Andar one digit each, every section with its own Amount.
  const [showRandom8Modal, setShowRandom8Modal] = useState(false);
  const [r8Dara, setR8Dara] = useState('');
  const [r8DaraAmt, setR8DaraAmt] = useState('');
  const [r8Bahar, setR8Bahar] = useState('');
  const [r8BaharAmt, setR8BaharAmt] = useState('');
  const [r8Andar, setR8Andar] = useState('');
  const [r8AndarAmt, setR8AndarAmt] = useState('');
  // Random (F8) validation toasts go through the app's react-toastify container (top-right,
  // red, X to close, auto-hides) — every error shows each time it happens; null clears them.
  const setR8Toast = (t: { title: string; body: string } | null) => {
    if (!t) {
      ['Invalid Amount', 'Invalid Number Pair', 'Invalid Number'].forEach(title => toast.dismiss(`r8-${title}`));
      return;
    }
    toast.error(
      <div>
        <div className="font-bold text-base">{t.title}</div>
        <div className="text-sm mt-0.5">{t.body}</div>
      </div>,
      { toastId: `r8-${t.title}` }
    );
  };

  // From-To (F7) — every number in the From..To range at AMOUNT, plus (when a PLT-AMOUNT is
  // given) each one's palti at that second amount.
  const [showFromToModal, setShowFromToModal] = useState(false);
  const [fromNumStr, setFromNumStr] = useState('');
  const [toNumStr, setToNumStr] = useState('');
  const [fromToAmountStr, setFromToAmountStr] = useState('');
  const [fromToPltAmountStr, setFromToPltAmountStr] = useState('');

  const [showRandomModal, setShowRandomModal] = useState(false);
  const [randomNumbers, setRandomNumbers] = useState<string[]>(['']);
  const [randomAmountStr, setRandomAmountStr] = useState<string>('');
  const [randomPltAmountStr, setRandomPltAmountStr] = useState<string>('');
  const [activeRandomFocus, setActiveRandomFocus] = useState<string>('num-0');

  const [showJantriModal, setShowJantriModal] = useState(false);

  // DOM Refs for fast keyboard navigation
  const partyInputRef = useRef<HTMLInputElement>(null);
  // First open of the page: cursor starts in the Party box
  useEffect(() => {
    const id = requestAnimationFrame(() => partyInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const numberInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  // Enter presses in a row on an empty NUMBER + AMOUNT row: the 2nd one moves focus to (and
  // highlights) Save Now, and the 3rd — pressed on the focused button — clicks it.
  const emptyEnterStreakRef = useRef(0);
  const saveNowBtnRef = useRef<HTMLButtonElement>(null);
  // true = this Enter was handled here (Save Now focused)
  const trackEmptyEnter = (key: string): boolean => {
    if (key !== 'Enter' || inputNumber.trim() !== '' || inputAmount.trim() !== '') {
      emptyEnterStreakRef.current = 0;
      return false;
    }
    emptyEnterStreakRef.current += 1;
    if (emptyEnterStreakRef.current < 2) return false;
    emptyEnterStreakRef.current = 0;
    const btn = saveNowBtnRef.current;
    if (!btn || btn.disabled) return false;
    btn.focus();
    return true;
  };

  // 1. Fetch parties & shifts on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          apiRequest<LedgerDto[]>('/ledgers'),
          apiRequest<ShiftDto[]>('/shifts'),
        ]);

        if (sRes.data && sRes.data.length > 0) {
          setAllShifts(sRes.data);
        }

        if (pRes.data) {
          setParties(pRes.data);
        }

        // Edit mode: /transaction_edit/:shiftId/:txId — resolve the shift directly (no
        // guessing needed, unlike the transactionId branch below) and load the existing
        // transaction's full entry grid so it can be edited in place.
        if (editShiftId && editTransactionId) {
          const shiftIdNum = parseInt(editShiftId, 10);
          const txIdNum = parseInt(editTransactionId, 10);

          const shiftMatch = sRes.data?.find((s: ShiftDto) => s.id === shiftIdNum);
          if (shiftMatch) {
            setResolvedShift(shiftMatch);
            if (onSelectShift) onSelectShift(shiftMatch);
          }

          if (!isNaN(txIdNum)) {
            try {
              const txRes = await apiRequest<any>(`/transactions/${txIdNum}`);
              if (txRes.data) {
                setEditingTxNumericId(txRes.data.id);
                if (typeof txRes.data.createdAt === 'string') {
                  const d = new Date(txRes.data.createdAt);
                  if (!isNaN(d.getTime())) {
                    setEditTxDate(`${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`);
                  }
                }

                if (txRes.data.partyName && pRes.data) {
                  const matchingParty = pRes.data.find((p: LedgerDto) =>
                    p.partyName.toLowerCase() === txRes.data.partyName.toLowerCase()
                  );
                  if (matchingParty) {
                    setSelectedParty(matchingParty);
                    setPartySearch(matchingParty.partyName);
                  }
                }

                if (Array.isArray(txRes.data.entries)) {
                  setEntriesList(txRes.data.entries.map((e: any) => ({
                    // Stored "00" is jantri number 100; a single digit shows as "01"
                    numberValue: (e.entryType === 'DARA' || !e.entryType) && /^\d{1,2}$/.test(String(e.numberValue).trim())
                      ? (normalizeTypedNumber(String(e.numberValue)) ?? displayNumber(e))
                      : displayNumber(e),
                    amount: parseFloat(e.amount),
                    entryType: e.entryType,
                  })));
                }
              }
            } catch (err) {
              console.warn('Failed to load transaction for editing:', err);
            }
          }
          return;
        }

        // Check transactionId to load shift or party
        if (transactionId) {
          const numId = parseInt(transactionId, 10);
          if (!isNaN(numId)) {
            // 1. Direct Shift match (e.g. /transaction_add/85 where 85 is shift ID)
            const shiftMatch = sRes.data?.find((s: ShiftDto) => s.id === numId);
            if (shiftMatch) {
              setResolvedShift(shiftMatch);
              if (onSelectShift) onSelectShift(shiftMatch);
            } else {
              // 2. If not a direct shift match, check if it's a transaction ID to load
              try {
                const txRes = await apiRequest<any>(`/transactions/${numId}`);
                if (txRes.data) {
                  if (txRes.data.shiftId && sRes.data) {
                    const matchFromTx = sRes.data.find((s: ShiftDto) => s.id === txRes.data.shiftId);
                    if (matchFromTx) {
                      setResolvedShift(matchFromTx);
                      if (onSelectShift) onSelectShift(matchFromTx);
                    }
                  }
                  if (txRes.data.partyName && pRes.data) {
                    const matchingParty = pRes.data.find((p: LedgerDto) =>
                      p.partyName.toLowerCase() === txRes.data.partyName.toLowerCase()
                    );
                    if (matchingParty) {
                      setSelectedParty(matchingParty);
                      setPartySearch(matchingParty.partyName);
                    }
                  }
                }
              } catch (err) {}
            }
          }
        } else if (activeShift) {
          setResolvedShift(activeShift);
        }
      } catch (err) {
        console.warn('Failed to load initial add-transaction data:', err);
      }
    };

    loadInitialData();
  }, [transactionId, editShiftId, editTransactionId]);

  // Sync activeShift prop if provided and no specific route ID was given
  useEffect(() => {
    if (!transactionId && activeShift && !resolvedShift) {
      setResolvedShift(activeShift);
    }
  }, [activeShift, transactionId, resolvedShift]);

  // Re-seed whenever the resolved shift changes, and again each time the shifts list refreshes
  // with a new figure — that keeps the badge honest instead of letting a purely local tick
  // drift away from the server's clock over a long session. Also picks up a cut-off edited on
  // Shift Manage without needing a page reload.
  const shiftRemainingSeconds = resolvedShift?.timeRemainingSeconds;
  useEffect(() => {
    if (typeof shiftRemainingSeconds === 'number') {
      setTimeLeftSeconds(Math.max(0, shiftRemainingSeconds));
    }
  }, [shiftRemainingSeconds, resolvedShift?.id]);

  // Countdown timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeftSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimeLeft = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // The Date badge shows the shift's own open_date (its live cycle) — an undeclared shift keeps
  // its date past midnight, so today's calendar date would mislabel which cycle entries go into.
  // Falls back to today only until the shift has loaded.
  const formatDate = () => {
    if (declareEdit && editTxDate) return editTxDate;
    const openDate = resolvedShift?.openDate || activeShift?.openDate;
    if (openDate && /^\d{4}-\d{2}-\d{2}$/.test(openDate)) {
      const [year, month, day] = openDate.split('-');
      return `${day}-${month}-${year}`;
    }
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  // Filtered parties based on input
  const filteredParties = useMemo(() => {
    // Only Active accounts are offered — a party whose Account Status is Deactive (Ledgers ->
    // Account tab) is left out of the search (the API refuses its new slips too)
    const activeParties = parties.filter(p => (p as { accountActive?: boolean }).accountActive !== false);
    // The list only appears once something is typed (an empty box shows no list, as live)
    if (!partySearch.trim()) return [];
    return activeParties.filter(p =>
      p.partyName.toLowerCase().includes(partySearch.trim().toLowerCase())
    );
  }, [parties, partySearch]);

  const handleSelectParty = (p: LedgerDto) => {
    setSelectedParty(p);
    setPartySearch(p.partyName);
    setShowPartyDropdown(false);
    numberInputRef.current?.focus();
  };

  // Grand Total calculation
  const grandTotal = useMemo(() => {
    return entriesList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [entriesList]);

  // F12 Jantri View: amount per cell, summed over every entry of that number / haruf
  const jantriTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entriesList) {
      const k = jantriKeyOf(e);
      if (k) m.set(k, (m.get(k) || 0) + (Number(e.amount) || 0));
    }
    return m;
  }, [entriesList]);
  const jantriCell = (key: string) => jantriTotals.get(key) || 0;

  // Typing in a Jantri View cell sets that number's amount: its rows collapse into one row
  // (kept where the first one was) carrying the typed amount; clearing the cell removes them.
  const setJantriCell = (key: string, raw: string) => {
    const amt = parseFloat(raw.replace(/[^\d.]/g, '')) || 0;
    setEntriesList(prev => {
      const firstIdx = prev.findIndex(e => jantriKeyOf(e) === key);
      const rest = prev.filter(e => jantriKeyOf(e) !== key);
      if (amt <= 0) return rest;
      const row: EntryRow = { numberValue: numberForJantriKey(key), amount: amt, entryType: 'DARA' };
      if (firstIdx === -1) return [row, ...rest];
      const out = [...rest];
      out.splice(Math.min(firstIdx, out.length), 0, row);
      return out;
    });
  };

  // Jantri View cell order for Enter / arrow navigation: 1..100, then B1..B0, then A1..A0
  const JANTRI_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const jantriOrder = useMemo(() => [
    ...Array.from({ length: 100 }, (_, i) => `N${i + 1}`),
    ...JANTRI_DIGITS.map(d => `B${d}`),
    ...JANTRI_DIGITS.map(d => `A${d}`),
  ], []);
  const focusJantriCell = (idx: number) => {
    const key = jantriOrder[Math.max(0, Math.min(jantriOrder.length - 1, idx))];
    const el = document.getElementById(`jantri-cell-${key}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };
  const closeJantriView = () => {
    setShowJantriModal(false);
    requestAnimationFrame(() => numberInputRef.current?.focus());
  };
  useEffect(() => {
    if (!showJantriModal) return;
    const id = requestAnimationFrame(() => focusJantriCell(0));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showJantriModal]);

  // Add new entry (supports single entry or multiple entries separated by spaces/commas/ranges/equal)
  const handleAddEntry = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawNum = inputNumber.trim();
    const defaultAmt = parseFloat(inputAmount.trim());

    if (!rawNum) {
      numberInputRef.current?.focus();
      return;
    }

    if (!allTypedNumbersValid(rawNum)) {
      showInvalidEntryToast();
      // Wrong number stays selected in NUMBER so the next one typed replaces it
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
      return;
    }

    // Split on commas, spaces, semicolons or newlines
    const tokens = rawNum.split(/[\s,;]+/).filter(Boolean);
    const newEntries: EntryRow[] = [];

    for (const token of tokens) {
      // Check for inline pair format: "number=amount" or "number*amount"
      if (token.includes('=') || token.includes('*')) {
        const parts = token.split(/[=*]/);
        const numPart = parts[0].trim();
        const amtPart = parseFloat(parts[1].trim());
        if (numPart && !isNaN(amtPart) && amtPart > 0) {
          let entryType: 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR' = 'DARA';
          if (numPart.toUpperCase().startsWith('A')) entryType = 'HARUF_ANDAR';
          else if (numPart.toUpperCase().startsWith('B')) entryType = 'HARUF_BAHAR';
          const shown = entryType === 'DARA' ? (normalizeTypedNumber(numPart) ?? numPart) : numPart;
          newEntries.push({ numberValue: shown, amount: amtPart, entryType });
          continue;
        }
      }

      // Check for range format like "1-10"
      if (token.includes('-') && !token.toUpperCase().startsWith('A-') && !token.toUpperCase().startsWith('B-')) {
        const parts = token.split('-');
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        if (!isNaN(start) && !isNaN(end) && start <= end && !isNaN(defaultAmt) && defaultAmt > 0) {
          for (let n = start; n <= end; n++) {
            newEntries.push({ numberValue: normalizeTypedNumber(String(n)) ?? String(n), amount: defaultAmt, entryType: 'DARA' });
          }
          continue;
        }
      }

      // Standard entry requiring default amount
      if (isNaN(defaultAmt) || defaultAmt <= 0) {
        amountInputRef.current?.focus();
        return;
      }

      let entryType: 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR' = 'DARA';
      if (token.toUpperCase().startsWith('A')) entryType = 'HARUF_ANDAR';
      else if (token.toUpperCase().startsWith('B')) entryType = 'HARUF_BAHAR';
      const shownToken = entryType === 'DARA' ? (normalizeTypedNumber(token) ?? token) : token;
      newEntries.push({ numberValue: shownToken, amount: defaultAmt, entryType });
    }

    if (newEntries.length > 0) {
      // Newest entry on top, as on the live list (entered 1, 20, 30 lists 30, 20, 1). Several
      // numbers keyed at once land as if entered one by one, so the last one is on top.
      setEntriesList(prev => [...[...newEntries].reverse(), ...prev]);
      setInputNumber('');
      setInputAmount('');
      numberInputRef.current?.focus();
    } else if (isNaN(defaultAmt) || defaultAmt <= 0) {
      amountInputRef.current?.focus();
    }
  };

  // Remove single entry
  const handleRemoveEntry = (index: number) => {
    setEntriesList(prev => prev.filter((_, i) => i !== index));
  };

  // Clear all
  const handleClear = () => {
    setEntriesList([]);
    setInputNumber('');
    setInputAmount('');
    setNarration('');
    setAppliedNarrations([]);
    setSelectedCopyShiftIds([]);
    setCopyToAll(false);
    setErrorMsg(null);
    setSuccessMsg(null);
    numberInputRef.current?.focus();
  };

  // Declared status of resolved shift
  const isShiftDeclared = !!(resolvedShift?.declaredNumber || resolvedShift?.status === 'DECLARED' || resolvedShift?.status === 'AUDITED');

  // The Edit Shift popup's Time tab sets each role's own cut-off — once it's passed for the
  // current user's role (and they don't have a Declare Trans Permission override), the backend
  // already rejects new entries (ShiftService.assertShiftOpenForRole); this mirrors that same
  // check on the frontend so the page visibly blocks it instead of only failing on Save.
  // DEVELOPER/SUPER ADMIN are exempt on the backend too, so `isEntryAllowedForRole` (computed
  // per-role in ShiftService.listShifts) already comes back true for them regardless of time.
  const isCutoffBlocked = !declareEdit && resolvedShift?.isEntryAllowedForRole === false;
  // Declare edit exists precisely to change a declared shift's slip, so "declared" only
  // blocks Save in the other modes.
  const isDeclaredBlocked = isShiftDeclared && !declareEdit;

  // Directly opening (or refreshing) this page's URL once the role's entry window has already
  // closed shouldn't leave the user stranded on a page they can't do anything on — send them
  // back to the dashboard. The "[ENTRY CLOSED]" banner/disabled Save button above are left
  // exactly as they were; this just adds a redirect on top once that same state is detected.
  useEffect(() => {
    if (isCutoffBlocked && onNavigate) {
      onNavigate('dashboard');
    }
  }, [isCutoffBlocked, onNavigate]);

  // Copy shift toggling - only non-declared shifts can be copied to
  const currentShiftName = resolvedShift?.name || activeShift?.name || 'GHAZIABAD';
  // "Tick Shift for Copy Transaction" offers the shifts a slip could actually be copied INTO:
  // active, not yet declared, and never the shift being worked on. The live panel bears that
  // out — on HYDRABAD NIGHT it lists a short set of still-running markets, with the current
  // shift absent and every declared one absent.
  //
  // The isActive guard is what was missing: a disabled shift (Shift Manage's Enable/Disable
  // tab) has no live cycle to copy into, yet all 18 disabled rows were being listed, which is
  // why the local panel showed a long scroll of markets the live one never offers. Same guard
  // the Live Prediction, Jantri and Daily Report shift pickers already apply.
  const otherShifts = useMemo(() => {
    const currentId = resolvedShift?.id ?? activeShift?.id;
    return allShifts.filter(s =>
      s.isActive !== false &&
      // Matched on id when one is resolved (a name compare would also knock out a same-named
      // shift, and currentShiftName falls back to a hardcoded label before one resolves).
      (currentId != null
        ? s.id !== currentId
        : s.name.toUpperCase() !== currentShiftName.toUpperCase()) &&
      !s.declaredNumber &&
      s.status !== 'DECLARED' &&
      s.status !== 'AUDITED'
    );
  }, [allShifts, currentShiftName, resolvedShift?.id, activeShift?.id]);

  const toggleCopyShift = (shiftId: number) => {
    setSelectedCopyShiftIds(prev =>
      prev.includes(shiftId) ? prev.filter(id => id !== shiftId) : [...prev, shiftId]
    );
  };

  const toggleCopyAll = () => {
    if (copyToAll) {
      setSelectedCopyShiftIds([]);
      setCopyToAll(false);
    } else {
      setSelectedCopyShiftIds(otherShifts.map(s => s.id));
      setCopyToAll(true);
    }
  };

  // Save Now (F2)
  const handleSaveNow = async () => {
    // Pressed from the Enter flow (Save focused): hand focus back to NUMBER so the button's
    // highlight doesn't linger after the save or its error. Checks below that focus a
    // specific field (party, number) still do so afterwards.
    if (saveNowBtnRef.current && document.activeElement === saveNowBtnRef.current) {
      saveNowBtnRef.current.blur();
      numberInputRef.current?.focus();
    }
    if (isDeclaredBlocked) {
      setErrorMsg(`Shift "${currentShiftName}" result is already declared (${resolvedShift?.declaredNumber || 'DECLARED'}). Transactions are closed.`);
      return;
    }
    if (isCutoffBlocked) {
      setErrorMsg(`Entry window closed for your role on "${currentShiftName}". New transactions are no longer allowed.`);
      return;
    }
    // Shift's time is over (Time Left reached 00:00:00) — entries stay in the grid, the slip
    // just isn't saved. The API flag covers a page opened after the cut-off; the local
    // countdown covers the cut-off passing while the page is already open.
    const isTimeOver = !declareEdit && !resolvedShift?.hasTimeOverride && (
      resolvedShift?.isTransactionTimeOver === true ||
      (resolvedShift?.isTransactionTimeOver === false && timeLeftSeconds <= 0)
    );
    if (isTimeOver) {
      // Top-right "Message" toast (react-toastify), same as the live panel. A fixed toastId
      // keeps repeated F2 presses from stacking duplicates.
      toast.error(
        <div>
          <div className="font-bold text-base">Message</div>
          <div className="text-sm mt-0.5">Transaction time has been over!</div>
        </div>,
        { toastId: 'transaction-time-over' }
      );
      return;
    }
    if (!selectedParty) {
      setErrorMsg('Please select a party first.');
      partyInputRef.current?.focus();
      return;
    }
    if (entriesList.length === 0) {
      setErrorMsg('Please add at least one number entry.');
      numberInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Edit mode: replace the existing transaction's entries instead of creating a new slip.
      if (editingTxNumericId) {
        await apiRequest(`/transactions/${editingTxNumericId}/${declareEdit ? 'declare-entries' : 'entries'}`, {
          method: 'PATCH',
          body: JSON.stringify({
            entries: entriesList.map(e => ({
              entryType: e.entryType,
              numberValue: toStoredNumber(e),
              amount: e.amount,
            })),
          }),
        });
        setSuccessMsg('Transaction updated successfully!');
        setSubmitting(false);
        // Edit from Live Transactions: once saved, go back to Transaction List opened on this
        // slip's shift, so the updated slip is listed straight away. (Declare edits stay put.)
        if (!declareEdit && onNavigate) {
          const backShiftId = editShiftId || (resolvedShift ? String(resolvedShift.id) : undefined);
          toast.success(
            <div>
              <div className="font-bold text-base">Success</div>
              <div className="text-sm mt-0.5">Transaction updated successfully!</div>
            </div>,
            { toastId: `tx-updated-${editingTxNumericId}` }
          );
          onNavigate('transaction-list', backShiftId);
        }
        return;
      }

      const shiftIdToUse = resolvedShift?.id || activeShift?.id || (allShifts[0]?.id) || 3;
      const payload = {
        shiftId: shiftIdToUse,
        partyId: selectedParty.id,
        entries: entriesList.map(e => ({
          entryType: e.entryType,
          numberValue: toStoredNumber(e),
          amount: e.amount,
        })),
        narration: narration.trim() || undefined,
      };

      const res = await apiRequest('/transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // If copy shifts were selected, replicate to those shifts as well
      if (selectedCopyShiftIds.length > 0) {
        for (const cShiftId of selectedCopyShiftIds) {
          try {
            await apiRequest('/transactions', {
              method: 'POST',
              body: JSON.stringify({ ...payload, shiftId: cShiftId }),
            });
          } catch (err) {}
        }
      }

      setSuccessMsg('Transaction slip saved successfully!');
      setTimeout(() => {
        handleClear();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save transaction slip');
    } finally {
      setSubmitting(false);
    }
  };

  // Generator Handlers
  // Random (F4), Cross (F6), From-To (F7) and Random (F8) all add their rows at the TOP of
  // the entry list, the same as a typed entry. Each popup already builds its rows in the
  // order they should read from the top, so that block goes in ahead of the existing rows.

  // Cross builds every ANDER-digit x BAHAR-digit pair. Confirmed against the live popup:
  //   ANDER 12345 x BAHAR 12346, JODA "Y" -> 5 x 5 = 25 numbers, amount 10 -> TOTAL 250
  //   the same pair with JODA "N"         -> 21, because the four doubles the cross produces
  //                                          (11, 22, 33, 44 — the digits common to both
  //                                          sides) are dropped, and 25 - 4 = 21.
  // Rule 2 printed in the popup: both numbers blank with JODA "Y" generates only the ten
  // 00-99 jodas. That path is gated on an amount having been entered, because the live popup
  // still reads TOTAL CROSS COUNT : 0 while all three boxes are empty.
  const buildCrossEntries = (): EntryRow[] => {
    const amt = parseFloat(crossAmountStr) || 0;
    const anderDigits = crossAnder.replace(/\D/g, '').split('');
    const baharDigits = crossBahar.replace(/\D/g, '').split('');
    const withJoda = crossJoda === 'Y';

    if (anderDigits.length === 0 && baharDigits.length === 0) {
      if (!withJoda || amt <= 0) return [];
      return Array.from({ length: 10 }, (_, d) => ({
        numberValue: `${d}${d}`,
        amount: amt,
        entryType: 'DARA' as const,
      })).reverse();
    }

    const out: EntryRow[] = [];
    for (const a of anderDigits) {
      for (const b of baharDigits) {
        if (!withJoda && a === b) continue;
        out.push({ numberValue: `${a}${b}`, amount: amt, entryType: 'DARA' });
      }
    }
    // The live list shows the batch in the reverse of the order the cross walks the digits:
    // ANDER 123 x BAHAR 124 with JODA "N" builds 12,14,21,24,31,32,34 and the live entry list
    // reads 34,32,31,24,21,14,12. That is what you get by prepending each generated row to the
    // top of the list — the same thing the Random popup's output does — so the batch is
    // reversed once here instead. Count and totals are unaffected.
    return out.reverse();
  };

  // The two live counters read straight off the same builder Save uses, so what the popup
  // promises and what it adds can never drift apart.
  const crossEntries = useMemo(
    buildCrossEntries,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crossAnder, crossBahar, crossAmountStr, crossJoda]
  );
  const crossCount = crossEntries.length;
  const crossTotalAmount = crossCount * (parseFloat(crossAmountStr) || 0);

  const resetCrossForm = () => {
    setCrossAnder('');
    setCrossBahar('');
    setCrossAmountStr('');
    setCrossJoda('Y');
  };

  const openCrossModal = () => {
    resetCrossForm();
    setShowCrossModal(true);
  };

  // Once a generator popup has gone, put the cursor back in the main NUMBER box
  const focusNumberAfterPopup = () => {
    requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
  };

  const closeCrossModal = () => {
    setShowCrossModal(false);
    resetCrossForm();
    // Every way out of the popup (Save, Cancel/Close, X, Esc, outside click) leaves the
    // cursor in the main NUMBER box for the next entry
    focusNumberAfterPopup();
  };

  const handleSaveCross = () => {
    if (crossEntries.length > 0) {
      setEntriesList(prev => [...crossEntries, ...prev]);
      setAppliedNarrations(prev => [
        { label: 'Cross', value: `${crossAnder.trim()} x ${crossBahar.trim()} / ${crossAmountStr.trim()} / ${crossJoda}` },
        ...prev,
      ]);
    }
    closeCrossModal();
    // Live: after Save the rows are listed and the cursor is back in the main NUMBER box,
    // ready for the next entry (once the popup has gone)
    requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
  };

  // --- Random (F8) -----------------------------------------------------------------------
  // Each section takes a run of digits with no separators (the popup says so in its two NOTE
  // lines) and slices it into fixed-width numbers: Dara 2 at a time, the two Akhar sections 1
  // at a time. Confirmed against the live popup: Dara "2323" @10 shows 20 beside its Amount,
  // Akhar Bahar "123" @10 shows 30, Akhar Andar "2" @10 shows 10.
  // The Dara box groups what you type into pairs as you go — the live field shows
  // "32 42 34 23 43 24 23 4" for a run keyed in with no separators at all. Purely a display
  // aid: every reader below strips non-digits first, so the spaces never reach the parsing.
  const formatDaraPairs = (raw: string) =>
    raw.replace(/\D/g, '').replace(/(\d{2})(?=\d)/g, '$1 ');

  const sliceR8 = (raw: string, size: number) => {
    const digits = raw.replace(/\D/g, '');
    const chunks: string[] = [];
    for (let i = 0; i < digits.length; i += size) chunks.push(digits.slice(i, i + size));
    return { digits, chunks };
  };

  // A section is only "invalid" once it has an amount to go with it — an untouched popup
  // shows no complaint at all (live screenshot 1 sits blank with TOTAL AMOUNT : 0).
  //   'PAIR'  -> Dara digits don't divide into 2s  -> "Number should be pair of 2 digit!"
  //   'EMPTY' -> an amount was given with no number -> "Please enter a valid number!"
  const r8SectionState = (raw: string, amountStr: string, size: number) => {
    const amt = parseFloat(amountStr) || 0;
    const { digits, chunks } = sliceR8(raw, size);
    // Nothing is flagged until the section has an Amount against it: the live field happily
    // holds an odd run like "32 42 34 23 43 24 23 4" with a blank Amount and shows no
    // complaint, while every screenshot that does read "Invalid No." has an Amount filled in.
    // A section with no Amount contributes nothing on Save either, so there is nothing to warn about.
    let error: 'PAIR' | 'EMPTY' | null = null;
    if (amt > 0) {
      if (size === 2 && digits.length % 2 !== 0) error = 'PAIR';
      else if (digits.length === 0) error = 'EMPTY';
    }
    return { chunks: error ? [] : chunks, amt, error, total: error ? 0 : chunks.length * amt };
  };

  const r8DaraState = r8SectionState(r8Dara, r8DaraAmt, 2);
  const r8BaharState = r8SectionState(r8Bahar, r8BaharAmt, 1);
  const r8AndarState = r8SectionState(r8Andar, r8AndarAmt, 1);
  // A section with digits but no Amount yet ("Invalid Amount" on Enter / Save) — not shown as
  // "Invalid No." beside the Amount, but it holds TOTAL AMOUNT at 0 like the other errors
  const r8NeedsAmount = (raw: string, amountStr: string) =>
    raw.replace(/\D/g, '').length > 0 && !((parseFloat(amountStr) || 0) > 0);
  const r8HasError = !!(r8DaraState.error || r8BaharState.error || r8AndarState.error)
    || r8NeedsAmount(r8Dara, r8DaraAmt) || r8NeedsAmount(r8Bahar, r8BaharAmt) || r8NeedsAmount(r8Andar, r8AndarAmt);
  // Live screenshots 2 and 3 both read TOTAL AMOUNT : 0 while one section is flagged, even
  // though the other two sections show their own figures — so any error zeroes the total.
  const r8TotalAmount = r8HasError ? 0 : r8DaraState.total + r8BaharState.total + r8AndarState.total;

  const r8ErrorToast = (error: 'PAIR' | 'EMPTY') =>
    error === 'PAIR'
      ? { title: 'Invalid Number Pair', body: 'Number should be pair of 2 digit!' }
      : { title: 'Invalid Number', body: 'Please enter a valid number!' };

  // An Akhar entry is written in this app's wider form — the page's own Utar Mode
  // Instructions say Bahar Akhar runs 000-999 and Andar Akhar 0000-9999 — so a single Bahar
  // digit 1 becomes "111" and a single Andar digit 5 becomes "5555". Live screenshot 5 shows
  // exactly that: Dara 2323 + Bahar 1 + Andar 5 lands as 5555, 111, 23, 23.
  const buildRandom8Entries = (): EntryRow[] => {
    if (r8HasError) return [];
    const out: EntryRow[] = [];
    if (r8DaraState.amt > 0) {
      for (const n of r8DaraState.chunks) {
        out.push({ numberValue: n, amount: r8DaraState.amt, entryType: 'DARA' });
      }
    }
    if (r8BaharState.amt > 0) {
      for (const d of r8BaharState.chunks) {
        out.push({ numberValue: d.repeat(3), amount: r8BaharState.amt, entryType: 'HARUF_BAHAR' });
      }
    }
    if (r8AndarState.amt > 0) {
      for (const d of r8AndarState.chunks) {
        out.push({ numberValue: d.repeat(4), amount: r8AndarState.amt, entryType: 'HARUF_ANDAR' });
      }
    }
    // Reversed for the same reason as the other generators — the live list reads
    // 5555, 111, 23, 23, i.e. each generated row prepended to the top.
    return out.reverse();
  };

  const resetRandom8Form = () => {
    setR8Dara(''); setR8DaraAmt('');
    setR8Bahar(''); setR8BaharAmt('');
    setR8Andar(''); setR8AndarAmt('');
    setR8Toast(null);
  };

  const openRandom8Modal = () => {
    resetRandom8Form();
    setShowRandom8Modal(true);
  };

  const closeRandom8Modal = () => {
    setShowRandom8Modal(false);
    resetRandom8Form();
    // Every way out of the popup (Save, Cancel/Close, X, Esc, outside click) leaves the
    // cursor in the main NUMBER box for the next entry
    focusNumberAfterPopup();
  };

  // Live flow: the popup opens with the cursor in Dara; Enter walks Dara -> Amount ->
  // Akhar Bahar -> Amount -> Akhar Andar -> Amount -> Save (Enter on Save saves).
  const R8_ENTER_ORDER = ['r8-dara', 'r8-dara-amt', 'r8-bahar', 'r8-bahar-amt', 'r8-andar', 'r8-andar-amt', 'r8-save-btn'];
  // Live checks, in this order, for one section:
  //   number typed, Amount blank/0   -> "Invalid Amount" (cursor stays on that Amount)
  //   Dara digits not in pairs       -> "Invalid Number Pair" (cursor back on the number, selected)
  //   Amount given, number blank     -> "Invalid Number" (cursor back on the number)
  const r8CheckSection = (key: 'dara' | 'bahar' | 'andar'): boolean => {
    const raw = key === 'dara' ? r8Dara : key === 'bahar' ? r8Bahar : r8Andar;
    const amt = key === 'dara' ? r8DaraAmt : key === 'bahar' ? r8BaharAmt : r8AndarAmt;
    const state = key === 'dara' ? r8DaraState : key === 'bahar' ? r8BaharState : r8AndarState;
    const focusSel = (id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      el?.focus();
      el?.select();
    };
    if (r8NeedsAmount(raw, amt)) {
      setR8Toast({ title: 'Invalid Amount', body: 'Please enter a valid amount!' });
      focusSel(`r8-${key}-amt`);
      return false;
    }
    if (state.error) {
      setR8Toast(r8ErrorToast(state.error));
      focusSel(`r8-${key}`);
      return false;
    }
    return true;
  };

  const r8EnterNext = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter on an Amount box checks its section first; a problem keeps the cursor there
    const amtMatch = id.match(/^r8-(dara|bahar|andar)-amt$/);
    if (amtMatch && !r8CheckSection(amtMatch[1] as 'dara' | 'bahar' | 'andar')) return;
    // Enter in Dara with an odd digit run (e.g. "45 65 6") says so straight away and keeps
    // the cursor in Dara with the text selected — Amount or not
    if (id === 'r8-dara' && r8Dara.replace(/\D/g, '').length % 2 !== 0) {
      setR8Toast(r8ErrorToast('PAIR'));
      const el = document.getElementById('r8-dara') as HTMLTextAreaElement | null;
      el?.focus();
      el?.select();
      return;
    }
    setR8Toast(null);
    const next = R8_ENTER_ORDER[R8_ENTER_ORDER.indexOf(id) + 1];
    const el = next ? document.getElementById(next) : null;
    el?.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
  };
  useEffect(() => {
    if (!showRandom8Modal) return;
    const id = requestAnimationFrame(() => document.getElementById('r8-dara')?.focus());
    return () => cancelAnimationFrame(id);
  }, [showRandom8Modal]);

  const handleSaveRandom8 = () => {
    // Same checks as Enter, Dara -> Bahar -> Andar; the first problem keeps the popup open
    // with the cursor on the box to fix
    for (const key of ['dara', 'bahar', 'andar'] as const) {
      if (!r8CheckSection(key)) return;
    }
    const entries = buildRandom8Entries();
    if (entries.length > 0) setEntriesList(prev => [...entries, ...prev]);
    closeRandom8Modal();
    // Back to the main NUMBER box for the next entry, as after the other popups' Save
    requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
  };

  // Confirmed against the live popup: From 1 / To 5 / AMOUNT 10 reads TOTAL AMOUNT 50, and
  // adding PLT-AMOUNT 10 takes it to 100 — i.e. the range contributes 5 x 10 and the paltis
  // another 5 x 10. The resulting entry list reads 50,40,30,20,10,5,4,3,2,1: every palti
  // first then every plain number, each block in reverse, which is what prepending each
  // generated row to the top of the list produces (same shape as Random's and Cross's output).
  const buildFromToEntries = (): EntryRow[] => {
    const from = parseInt(fromNumStr, 10);
    const to = parseInt(toNumStr, 10);
    const amt = parseFloat(fromToAmountStr) || 0;
    const pltAmt = parseFloat(fromToPltAmountStr) || 0;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return [];

    const numbers: string[] = [];
    for (let n = from; n <= to; n++) numbers.push(String(n));

    const originals: EntryRow[] = amt > 0
      ? numbers.map(n => ({ numberValue: n, amount: amt, entryType: 'DARA' as const }))
      : [];

    const paltis: EntryRow[] = [];
    if (pltAmt > 0) {
      for (const n of numbers) {
        const palti = paltiOfNumber(n);
        if (palti !== null) paltis.push({ numberValue: palti, amount: pltAmt, entryType: 'DARA' });
      }
    }

    return [...originals, ...paltis].reverse();
  };

  const fromToEntries = useMemo(
    buildFromToEntries,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromNumStr, toNumStr, fromToAmountStr, fromToPltAmountStr]
  );
  // Summed off the built rows rather than recomputed, so the figure the popup promises is
  // exactly what Save adds.
  const fromToTotalAmount = fromToEntries.reduce((sum, e) => sum + e.amount, 0);

  const resetFromToForm = () => {
    setFromNumStr('');
    setToNumStr('');
    setFromToAmountStr('');
    setFromToPltAmountStr('');
  };

  const openFromToModal = () => {
    resetFromToForm();
    setShowFromToModal(true);
  };

  const closeFromToModal = () => {
    setShowFromToModal(false);
    resetFromToForm();
    // Every way out of the popup (Save, Close, X, Esc, outside click) leaves the cursor in
    // the main NUMBER box for the next entry
    focusNumberAfterPopup();
  };

  // From-To popup: From must be 1-99, To 1-100 (whole numbers), and From not above To.
  const isValidFromNum = (v: string) => /^\d+$/.test(v.trim()) && parseInt(v, 10) >= 1 && parseInt(v, 10) <= 99;
  const isValidToNum = (v: string) => /^\d+$/.test(v.trim()) && parseInt(v, 10) >= 1 && parseInt(v, 10) <= 100;
  const focusFromToField = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };

  const handleSaveFromTo = () => {
    // Anything typed in From / To must be valid; an invalid one keeps the popup open on it.
    // Both left blank still just closes, as before.
    if (fromNumStr.trim() !== '' || toNumStr.trim() !== '') {
      if (!isValidFromNum(fromNumStr)) {
        showInvalidNumberToast();
        focusFromToField('fromto-from-input');
        return;
      }
      if (!isValidToNum(toNumStr) || parseInt(fromNumStr, 10) > parseInt(toNumStr, 10)) {
        showInvalidNumberToast();
        focusFromToField('fromto-to-input');
        return;
      }
    }
    if (fromToEntries.length > 0) {
      setEntriesList(prev => [...fromToEntries, ...prev]);
      // "P-" when paltis were added too; the amount shown is the plain AMOUNT, as live
      const hasPalti = (parseFloat(fromToPltAmountStr) || 0) > 0;
      setAppliedNarrations(prev => [
        { label: hasPalti ? 'P-From-To' : 'From-To', value: `${fromNumStr.trim()} x ${toNumStr.trim()} / ${fromToAmountStr.trim()} /` },
        ...prev,
      ]);
    }
    closeFromToModal();
    // Live: after Save the rows are listed and the cursor is back in the main NUMBER box,
    // ready for the next entry (once the popup has gone)
    requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
  };

  const handleRandomNumberChange = (index: number, val: string) => {
    setRandomNumbers(prev => {
      const updated = [...prev];
      updated[index] = val;
      if (index === updated.length - 1 && val.trim() !== '') {
        updated.push('');
      }
      return updated;
    });
  };

  // The Random popup keeps its typed values in component state, which outlives the dialog.
  // Cancel and the X button used to only flip `showRandomModal` off, so the next F4 reopened
  // the popup still holding the previous numbers/amounts. Every open and every close now goes
  // through these two helpers, so the dialog is always blank on the way in and on the way out.
  const resetRandomForm = () => {
    setRandomNumbers(['']);
    setRandomAmountStr('');
    setRandomPltAmountStr('');
    setActiveRandomFocus('num-0');
  };

  const openRandomModal = () => {
    resetRandomForm();
    setShowRandomModal(true);
  };

  // Opening the Random popup (F4 / F5 / button) puts the cursor in its first NUMBER box.
  useEffect(() => {
    if (!showRandomModal) return;
    const id = requestAnimationFrame(() => {
      (document.getElementById('random-number-0') as HTMLInputElement | null)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [showRandomModal]);

  const closeRandomModal = () => {
    setShowRandomModal(false);
    resetRandomForm();
    // Every way out of the popup (Save, Cancel/Close, X, Esc, outside click) leaves the
    // cursor in the main NUMBER box for the next entry
    focusNumberAfterPopup();
  };

  // Esc (or a click on the dimmed area outside the box) closes whichever generator popup is
  // open — Random (F4), Cross (F6), From-To (F7), Random (F8) — like its Close button, and
  // the cursor goes back to the main NUMBER box. (Shift+Esc still exits the page.)
  const closeOpenPopup = () => {
    if (showRandomModal) closeRandomModal();
    else if (showCrossModal) closeCrossModal();
    else if (showFromToModal) closeFromToModal();
    else if (showRandom8Modal) closeRandom8Modal();
    else return;
    requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
  };
  const closeOpenPopupRef = useRef(closeOpenPopup);
  closeOpenPopupRef.current = closeOpenPopup;
  const anyPopupOpen = showRandomModal || showCrossModal || showFromToModal || showRandom8Modal;
  useEffect(() => {
    if (!anyPopupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.shiftKey) return;
      e.preventDefault();
      closeOpenPopupRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyPopupOpen]);
  // Backdrop click: only a press that starts AND ends on the dimmed area itself, so a drag
  // that begins inside the box (e.g. selecting text) doesn't close it.
  const backdropDownRef = useRef(false);
  const backdropProps = {
    onMouseDown: (e: React.MouseEvent) => { backdropDownRef.current = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => {
      if (backdropDownRef.current && e.target === e.currentTarget) closeOpenPopup();
      backdropDownRef.current = false;
    },
  };

  const randomTotalAmount = useMemo(() => {
    const amt = parseFloat(randomAmountStr) || 0;
    const pltAmt = parseFloat(randomPltAmountStr) || 0;
    let total = 0;

    const validNumbers: string[] = [];
    for (const val of randomNumbers) {
      const parts = val.split(/[\s,;]+/).filter(Boolean);
      validNumbers.push(...parts);
    }

    for (const num of validNumbers) {
      if (amt > 0) total += amt;
      if (pltAmt > 0) {
        const cleaned = num.trim();
        if (cleaned.length === 2 && cleaned[0] !== cleaned[1]) {
          total += pltAmt;
        } else if (cleaned.length === 1) {
          total += pltAmt;
        }
      }
    }
    return total;
  }, [randomNumbers, randomAmountStr, randomPltAmountStr]);

  const handleSaveRandom = () => {
    const amt = parseFloat(randomAmountStr) || 0;
    const pltAmt = parseFloat(randomPltAmountStr) || 0;

    const validNumbers: string[] = [];
    for (const val of randomNumbers) {
      const parts = val.split(/[\s,;]+/).filter(Boolean);
      validNumbers.push(...parts);
    }

    if (validNumbers.length === 0) {
      closeRandomModal();
      return;
    }

    // Same number rule as the main NUMBER box: an invalid one keeps the popup open on that box.
    const badIdx = randomNumbers.findIndex(v => v.trim() !== '' && !allTypedNumbersValid(v));
    if (badIdx !== -1) {
      showInvalidNumberToast();
      const el = document.getElementById(`random-number-${badIdx}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
      return;
    }
    // 1 -> 01, 00 -> 100 for the rows added (palti still worked out from what was typed)
    const shownNumber = (num: string) => (isPrefixedHaruf(num) ? num : (normalizeTypedNumber(num) ?? num));

    const entryTypeOf = (num: string): 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR' => {
      if (num.toUpperCase().startsWith('A')) return 'HARUF_ANDAR';
      if (num.toUpperCase().startsWith('B')) return 'HARUF_BAHAR';
      return 'DARA';
    };

    // The live list groups by KIND, not by number: every palti row first, then every plain
    // number row, and each block runs in reverse of the order the numbers were keyed in.
    // NUMBER 1 / NUMBER 2 / AMOUNT 10 / PLT-AMOUNT 5 lists exactly:
    //   20 -> 5 , 10 -> 5 , 2 -> 10 , 1 -> 10
    // (which is also what you get by prepending each generated row to the top of the list,
    // originals generated first, then paltis).
    const ordered = [...validNumbers].reverse();
    const newEntries: EntryRow[] = [];

    if (pltAmt > 0) {
      for (const num of ordered) {
        const palti = paltiOfNumber(num);
        if (palti !== null) {
          newEntries.push({ numberValue: shownNumber(palti), amount: pltAmt, entryType: entryTypeOf(num) });
        }
      }
    }

    if (amt > 0) {
      for (const num of ordered) {
        newEntries.push({ numberValue: shownNumber(num), amount: amt, entryType: entryTypeOf(num) });
      }
    }

    if (newEntries.length > 0) {
      setEntriesList(prev => [...newEntries, ...prev]);
    }

    closeRandomModal();
    // Live: after Save the rows are listed and the cursor is back in the main NUMBER box,
    // ready for the next entry (once the popup has gone)
    requestAnimationFrame(() => {
      numberInputRef.current?.focus();
      numberInputRef.current?.select();
    });
  };

  // A tab opened from the Dashboard's shift card goes on to Transaction List (on this shift)
  // when exited, instead of closing; tabs opened from the transaction lists still just close
  // back to the list they came from.
  const openedFromDashboard = () => {
    try {
      const path = (window.opener?.location?.pathname || '').toLowerCase().replace(/\/$/, '');
      return path === '' || path === '/dashboard';
    } catch {
      return false;
    }
  };

  // Keyboard Shortcuts: F2, F4, F6, F7, F8, F12, ~, Shift+Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Escape') {
        e.preventDefault();
        if (window.opener && !openedFromDashboard()) {
          window.close();
        } else if (onNavigate) {
          onNavigate(declareEdit ? 'declare-transactions' : 'transaction-list', declareEdit ? undefined : (resolvedShift ? String(resolvedShift.id) : undefined));
        } else {
          window.location.href = declareEdit ? '/declare_transaction_list' : '/transaction_list';
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        handleSaveNow();
      } else if (e.key === 'F4') {
        e.preventDefault();
        openRandomModal();
      } else if (e.key === 'F8') {
        e.preventDefault();
        openRandom8Modal();
      } else if (e.key === 'F6') {
        e.preventDefault();
        openCrossModal();
      } else if (e.key === 'F7') {
        e.preventDefault();
        openFromToModal();
      } else if (e.key === 'F12') {
        e.preventDefault();
        // F12 opens the Jantri View; pressed again it returns to the entry list
        setShowJantriModal(v => {
          if (v) requestAnimationFrame(() => numberInputRef.current?.focus());
          return !v;
        });
      } else if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        numberInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entriesList, selectedParty, selectedCopyShiftIds, narration, resolvedShift]);

  // Rate string display
  const partyDaraRate = selectedParty?.daraRate ? Math.round(Number(selectedParty.daraRate)) : 0;
  const partyAkharRate = selectedParty?.akharRate ? Math.round(Number(selectedParty.akharRate)) : 0;

  return (
    <div
      className="no-number-spin h-screen w-screen flex flex-col bg-[#eaedf2] text-slate-900 overflow-hidden font-sans select-none"
      // No negative numbers in any number field on this page (entry row and the generator
      // popups): "-" can't be typed or pasted, and ArrowDown stops at 0. Capture phase, so each
      // field's own onKeyDown (Enter to add, etc.) still runs exactly as before.
      onKeyDownCapture={(e) => {
        const el = e.target as HTMLInputElement;
        if (el.tagName !== 'INPUT' || el.type !== 'number') return;
        // Also e / E / + — a number input accepts them for exponents, but amounts never use them
        if (e.key === '-' || e.key === 'Subtract' || e.key === 'e' || e.key === 'E' || e.key === '+') {
          e.preventDefault();
        } else if (e.key === 'ArrowDown' && (parseFloat(el.value) || 0) - (parseFloat(el.step) || 1) < 0) {
          e.preventDefault();
        }
      }}
      onPasteCapture={(e) => {
        const el = e.target as HTMLInputElement;
        if (el.tagName !== 'INPUT' || el.type !== 'number') return;
        if (/[-+eE]/.test(e.clipboardData.getData('text'))) e.preventDefault();
      }}
    >
      {/* 1. TOP BAR matching Screenshot 2, 3, 5 */}
      <div className="bg-white border-b border-slate-300 px-3 py-2 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        {/* Left Side: Back Arrow, Party Input, Rate, Limit, Capping, Bracket */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              if (window.opener && !openedFromDashboard()) {
                window.close();
              } else if (onNavigate) {
                onNavigate(declareEdit ? 'declare-transactions' : 'transaction-list', declareEdit ? undefined : (resolvedShift ? String(resolvedShift.id) : undefined));
              } else {
                window.location.href = declareEdit ? '/declare_transaction_list' : '/transaction_list';
              }
            }}
            title="Exit / Back (Shift + Esc)"
            className="p-1 text-slate-800 hover:text-black hover:bg-slate-100 rounded transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 font-bold" />
          </button>

          <span className="font-bold text-slate-800 text-xs sm:text-sm">Party</span>

          {/* Party Autocomplete Input Container */}
          <div className="relative">
            <input
              ref={partyInputRef}
              type="text"
              value={partySearch}
              onChange={(e) => {
                setPartySearch(e.target.value);
                setShowPartyDropdown(true);
                setActivePartyIndex(0);
              }}
              onFocus={() => setShowPartyDropdown(true)}
              onBlur={() => setTimeout(() => setShowPartyDropdown(false), 200)}
              placeholder="Search party..."
              className="bg-[#fef08a] border border-amber-400 font-bold text-slate-900 px-3 py-1 text-xs rounded-xs w-52 sm:w-64 focus:outline-none focus:ring-1 focus:ring-amber-500 uppercase"
              onKeyDown={(e) => {
                if (showPartyDropdown && filteredParties.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActivePartyIndex(prev => (prev + 1) % filteredParties.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActivePartyIndex(prev => (prev - 1 + filteredParties.length) % filteredParties.length);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSelectParty(filteredParties[activePartyIndex]);
                  }
                }
              }}
            />

            {/* Dropdown Menu matching Screenshot 2 */}
            {/* No list while the box just holds the party already chosen (e.g. an Edit slip
                opened with its party filled in) — it opens again as soon as the text is changed */}
            {showPartyDropdown && filteredParties.length > 0
              && !(selectedParty && partySearch.trim().toUpperCase() === selectedParty.partyName.toUpperCase()) && (
              <div className="absolute top-full left-0 mt-1 w-64 sm:w-72 bg-white border border-slate-300 shadow-2xl rounded-xs z-50 max-h-60 overflow-y-auto pbmax-table-scrollbar divide-y divide-slate-100">
                {filteredParties.map((p, idx) => {
                  const isHighlighted = idx === activePartyIndex;
                  return (
                    <div
                      key={p.id}
                      onMouseDown={() => handleSelectParty(p)}
                      className={`px-3 py-1.5 text-xs uppercase cursor-pointer transition-colors ${
                        isHighlighted
                          ? 'bg-[#eab308] text-white font-bold'
                          : 'bg-white hover:bg-amber-50 text-slate-800 font-semibold'
                      }`}
                    >
                      {p.partyName}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Rate Pill */}
          <div className="bg-[#f97316] text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-xs">
            Rate: {partyDaraRate ? `${partyDaraRate}/10-${partyAkharRate}/10` : '0/0-0/0'}
          </div>

          {/* Limit Pill */}
          <div className="bg-[#f97316] text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-xs">
            Limit: {selectedParty?.betLimit ? Number(selectedParty.betLimit).toLocaleString('en-IN') : 0}
          </div>

          {/* Capping Pill */}
          <div className="bg-[#ef4444] text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-xs">
            Capping: 0
          </div>

          {/* Bracket Pill */}
          <div className="bg-[#f97316] text-white text-xs font-bold px-2.5 py-1 rounded-full cursor-pointer shadow-xs select-none">
            [ ]
          </div>
        </div>

        {/* Right Side: Date & Time Left */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="bg-[#ef4444] text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-xs">
            Date: {formatDate()}
          </div>
          <div className={`${declareEdit ? 'bg-[#ef4444]' : 'bg-[#16a34a]'} text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-xs font-mono`}>
            Time Left: {formatTimeLeft(declareEdit ? 0 : timeLeftSeconds)}
          </div>
        </div>
      </div>

      {/* Success / Error Toast Notification */}
      {successMsg && (
        <div className="bg-emerald-600 text-white text-xs font-bold py-1.5 px-4 text-center animate-in fade-in flex-shrink-0">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="bg-rose-600 text-white text-xs font-bold py-1.5 px-4 text-center animate-in fade-in flex-shrink-0">
          {errorMsg}
        </div>
      )}

      {/* 2. MAIN WORKSPACE (3 Columns) matching Screenshot 2 & 3 */}
      <div className="flex-1 flex overflow-hidden bg-white">
        {/* F12 Jantri View takes the place of columns 1 + 2 (right column stays) */}
        {!showJantriModal ? (<>
        {/* COLUMN 1: Left - Entry Input & Table matching Screenshot 1 & 2 */}
        <div className="w-64 sm:w-72 flex flex-col border-r border-slate-300 bg-white flex-shrink-0">
          {/* Top Form Header with NUMBER, AMOUNT, and + */}
          <form
            onSubmit={handleAddEntry}
            className="flex items-center gap-1.5 p-2 flex-shrink-0"
          >
            <input
              ref={numberInputRef}
              type="text"
              value={inputNumber}
              // Digits only — letters and symbols are dropped as they're typed or pasted. Haruf
              // is keyed as 111 / 1111 (or a digit then + / -, handled in onKeyDown).
              inputMode="numeric"
              onChange={(e) => setInputNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="NUMBER"
              className="flex-1 min-w-0 h-8 bg-[#fef08a] border-2 border-[#1b3258] text-center font-bold text-xs text-slate-900 outline-none uppercase placeholder:text-slate-400 rounded-xs"
              onKeyDown={(e) => {
                if (trackEmptyEnter(e.key)) {
                  e.preventDefault();
                  return;
                }
                // Haruf shortcut: a single digit then "+" makes Bahar (3 -> 333), "-" makes
                // Andar (3 -> 3333), and the cursor moves on to AMOUNT. Anything else typed
                // before + / - (e.g. "10-20" ranges) keeps its existing handling.
                if ((e.key === '+' || e.key === '-') && /^\d$/.test(inputNumber.trim())) {
                  e.preventDefault();
                  const d = inputNumber.trim();
                  setInputNumber(e.key === '+' ? d.repeat(3) : d.repeat(4));
                  amountInputRef.current?.focus();
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (inputNumber.trim() && !allTypedNumbersValid(inputNumber)) {
                    showInvalidEntryToast();
                    // Wrong number stays selected so the next one typed replaces it
                    numberInputRef.current?.select();
                    return;
                  }
                  amountInputRef.current?.focus();
                }
              }}
            />
            <input
              ref={amountInputRef}
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="AMOUNT"
              className="flex-1 min-w-0 h-8 bg-white border-2 border-[#1b3258] text-center font-bold text-xs text-slate-900 outline-none placeholder:text-slate-400 rounded-xs"
              onKeyDown={(e) => {
                if (trackEmptyEnter(e.key)) {
                  e.preventDefault();
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddEntry();
                }
              }}
            />
            <button
              type="submit"
              title="Add Entry (+)"
              className="w-8 h-8 flex-shrink-0 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white flex items-center justify-center font-bold text-lg border-2 border-[#1b3258] rounded-xs cursor-pointer shadow-xs transition-colors"
            >
              +
            </button>
          </form>

          {/* Table Rows matching Screenshot 2 & 3 */}
          <div className="flex-1 overflow-y-auto pbmax-table-scrollbar px-2">
            <table className="w-full text-xs font-mono border-collapse">
              <tbody>
                {entriesList.map((entry, idx) => (
                  <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="py-1 px-2 font-bold text-center text-slate-900 text-xs w-[44%] border-r border-slate-100">
                      {entry.numberValue}
                    </td>
                    <td className="py-1 px-2 font-bold text-center text-slate-900 text-xs w-[44%] border-r border-slate-100">
                      {entry.amount}
                    </td>
                    <td className="py-1 px-1 text-center w-[12%] min-w-[34px]">
                      <button
                        type="button"
                        onClick={() => handleRemoveEntry(idx)}
                        className="w-7 h-6 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[11px] font-bold rounded-xs cursor-pointer shadow-xs flex items-center justify-center mx-auto"
                        title="Delete"
                      >
                        x
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* COLUMN 2: Center - Instructions & Total Count */}
        <div className="flex-1 flex flex-col border-r border-slate-300 bg-white overflow-y-auto">
          {/* Header matching Screenshot 2 */}
          <div className="bg-[#1b3258] text-white font-bold text-xs py-2 px-3 tracking-wide flex-shrink-0">
            Utar Mode Instructions
          </div>

          {/* Instructions List */}
          <div className="p-4 text-xs text-slate-800 space-y-3 font-medium flex-shrink-0">
            <div>1. Dara Number: should be 1 to 100</div>
            <div>2. Bahar Akhar Number: should be 000 to 999</div>
            <div>3. Andar Akhar Number: should be 0000 to 9999</div>
            <div>4. Press F12 for Jantri View</div>
            <div>5. Press &apos;~&apos; for Re-Focus</div>
          </div>

          {/* Center Prominent Indicator: Total Count matching Screenshot 2 & 3 */}
          <div className="flex-1 flex items-center justify-center my-12 sm:my-20">
            <div className="text-sm sm:text-base font-bold text-slate-800 tracking-wide">
              Total Count : {entriesList.length}
            </div>
          </div>
        </div>

        </>) : (
          <div
            className="flex-1 min-w-0 overflow-auto border-r border-slate-300 bg-white p-1"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                closeJantriView();
              }
            }}
          >
            {(() => {
              const cellInput = (key: string, label: string) => {
                const idx = jantriOrder.indexOf(key);
                const val = jantriCell(key);
                return (
                  <td key={key} className="relative border border-slate-200 p-0 h-9 min-w-[64px]">
                    <span className="absolute top-0.5 left-0.5 text-[8px] leading-none font-bold px-1 py-0.5 rounded-xs bg-[#fcd34d] text-slate-800 pointer-events-none">
                      {label}
                    </span>
                    <input
                      id={`jantri-cell-${key}`}
                      type="text"
                      inputMode="numeric"
                      value={val ? String(val) : ''}
                      onChange={(e) => setJantriCell(key, e.target.value)}
                      onKeyDown={(e) => {
                        let next: number | null = null;
                        if (e.key === 'Enter' || e.key === 'ArrowRight') next = idx + 1;
                        else if (e.key === 'ArrowLeft') next = idx - 1;
                        else if (e.key === 'ArrowDown') next = idx + 10;
                        else if (e.key === 'ArrowUp') next = idx - 10;
                        if (next !== null) {
                          e.preventDefault();
                          focusJantriCell(next);
                        }
                      }}
                      className="w-full h-full pt-3 pr-2 text-right font-bold text-sm text-slate-900 bg-transparent outline-none focus:bg-[#fde68a]"
                    />
                  </td>
                );
              };
              const rowTotal = (keys: string[]) => keys.reduce((sum, k) => sum + jantriCell(k), 0);
              const numberKeys = Array.from({ length: 100 }, (_, i) => `N${i + 1}`);
              const colTotal = (c: number) => Array.from({ length: 10 }, (_, r) => jantriCell(`N${r * 10 + c}`)).reduce((a, b) => a + b, 0);
              const totalCell = (v: number, extra = '') => (
                <td className={`bg-[#1b3258] text-white font-bold text-right px-2 text-xs border border-[#294979] ${extra}`}>{v}</td>
              );
              return (
                <table className="w-full border-collapse font-mono text-xs select-none">
                  <thead>
                    <tr className="bg-[#1b3258] text-white">
                      {Array.from({ length: 10 }, (_, c) => (
                        <th key={c} className="py-1.5 font-bold text-center border border-[#294979]">{c + 1}</th>
                      ))}
                      <th className="py-1.5 px-2 font-bold text-center border border-[#294979] w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 10 }, (_, r) => {
                      const keys = Array.from({ length: 10 }, (_, c) => `N${r * 10 + c + 1}`);
                      return (
                        <tr key={r}>
                          {keys.map((k) => cellInput(k, k.slice(1)))}
                          {totalCell(rowTotal(keys))}
                        </tr>
                      );
                    })}
                    <tr>
                      {Array.from({ length: 10 }, (_, c) => (
                        <React.Fragment key={c}>{totalCell(colTotal(c + 1), 'py-1')}</React.Fragment>
                      ))}
                      {totalCell(rowTotal(numberKeys), 'py-1')}
                    </tr>
                    <tr>
                      {JANTRI_DIGITS.map((d) => cellInput(`B${d}`, `B${d}`))}
                      {totalCell(rowTotal(JANTRI_DIGITS.map(d => `B${d}`)))}
                    </tr>
                    <tr>
                      {JANTRI_DIGITS.map((d) => cellInput(`A${d}`, `A${d}`))}
                      {totalCell(rowTotal(JANTRI_DIGITS.map(d => `A${d}`)))}
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}

        {/* COLUMN 3: Right - Shift Copy, Narration, Grand Total */}
        <div className="w-72 sm:w-80 flex flex-col bg-white flex-shrink-0">
          {/* Header matching Screenshot 2 (green for LIVE, pink for DECLARED, amber for cutoff-closed) */}
          {declareEdit ? (
            <div className="bg-[#dc2626] text-white font-bold text-center py-2 text-base uppercase tracking-wide flex-shrink-0 shadow-xs">
              {currentShiftName} [DECLARE]
            </div>
          ) : (
          <div className={`${isShiftDeclared ? 'bg-[#ec135d]' : isCutoffBlocked ? 'bg-[#d97706]' : 'bg-[#22c55e]'} text-white font-bold text-center py-2 text-sm uppercase tracking-wide flex-shrink-0 shadow-xs`}>
            {currentShiftName} {isShiftDeclared ? `[RESULT: ${resolvedShift?.declaredNumber || 'DECLARED'}]` : isCutoffBlocked ? '[ENTRY CLOSED]' : '[LIVE]'}
          </div>
          )}

          {/* Tick Shift for Copy Transaction Header (not on declare edit — live shows none) */}
          {!declareEdit && (<>
          <div className="bg-[#1b3258] text-white text-xs font-bold py-1.5 px-3 flex items-center gap-2 flex-shrink-0">
            <input
              type="checkbox"
              id="tick-all"
              checked={copyToAll}
              onChange={toggleCopyAll}
              className="rounded cursor-pointer"
            />
            <label htmlFor="tick-all" className="cursor-pointer">
              Tick Shift for Copy Transaction
            </label>
          </div>

          {/* Copy Shifts Checkboxes matching Screenshot 2 */}
          <div className="divide-y divide-slate-200 border-b border-slate-300">
            {otherShifts.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-slate-800 uppercase hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedCopyShiftIds.includes(s.id)}
                  onChange={() => toggleCopyShift(s.id)}
                  className="rounded cursor-pointer"
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>

          </>)}

          {/* Applied Narration Header */}
          <div className="bg-[#1b3258] text-white text-xs font-bold py-1.5 px-3 flex-shrink-0">
            Applied Narration
          </div>

          {/* Applied Cross / From-To calculations */}
          {appliedNarrations.length > 0 && (
            <div className="border-b border-slate-300 max-h-40 overflow-y-auto pbmax-table-scrollbar">
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {appliedNarrations.map((n, i) => (
                    <tr key={i} className="border-b border-slate-200 last:border-b-0">
                      <td className="py-2 px-2.5 font-bold text-slate-800 w-[30%] border-r border-slate-200">{n.label}</td>
                      <td className="py-2 px-2.5 font-bold text-slate-800 font-mono">{n.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Narration Textarea */}
          <div className="p-2 border-b border-slate-300">
            <textarea
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              rows={3}
              placeholder="Remarks / Narration..."
              className="w-full p-2 text-xs border border-slate-300 rounded-xs focus:outline-none focus:border-blue-500 font-mono resize-none"
            />
          </div>

          {/* Spacer */}
          <div className="flex-1 bg-white"></div>

          {/* Grand Total Red Banner matching Screenshot 2 & 3 */}
          <div className="bg-[#dc2626] text-white font-bold text-center py-2.5 text-base tracking-wide flex-shrink-0 shadow-sm">
            Grand Total: {grandTotal}
          </div>
        </div>
      </div>

      {/* 3. BOTTOM ACTION BAR matching Screenshot 2 & 3 */}
      <div className="bg-[#152847] px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-400 flex-shrink-0">
        {/* Left: Need Help? & Shift + Esc */}
        <div className="flex items-center gap-3">
          <span className="text-[#fde047] font-bold text-xs cursor-pointer hover:underline">
            Need Help?
          </span>
          <span className="text-white text-xs font-mono">
            [ shift + esc = Exit ]
          </span>
        </div>

        {/* Right: Generator & Save Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openRandomModal}
            className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white text-xs font-bold px-3 py-1.5 rounded cursor-pointer transition-colors shadow-xs"
          >
            Random (F4)
          </button>
          <button
            type="button"
            onClick={openCrossModal}
            className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white text-xs font-bold px-3 py-1.5 rounded cursor-pointer transition-colors shadow-xs"
          >
            Cross (F6)
          </button>
          <button
            type="button"
            onClick={openFromToModal}
            className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white text-xs font-bold px-3 py-1.5 rounded cursor-pointer transition-colors shadow-xs"
          >
            From-To (F7)
          </button>
          <button
            type="button"
            onClick={openRandom8Modal}
            className="bg-[#1d4ed8] hover:bg-[#1e40af] text-white text-xs font-bold px-3 py-1.5 rounded cursor-pointer transition-colors shadow-xs"
          >
            Random (F8)
          </button>
          <button
            type="button"
            ref={saveNowBtnRef}
            disabled={submitting || isDeclaredBlocked || isCutoffBlocked}
            onClick={handleSaveNow}
            className={`text-white text-xs font-bold px-4 py-1.5 rounded transition-colors shadow-xs outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#1b3258] focus:ring-[#dc2626] ${
              isDeclaredBlocked || isCutoffBlocked
                ? 'bg-slate-500 cursor-not-allowed opacity-75'
                : 'bg-[#00897b] hover:bg-[#00796b] cursor-pointer'
            } disabled:opacity-50`}
          >
            {submitting ? 'Saving...' : isDeclaredBlocked ? 'Result Declared' : isCutoffBlocked ? 'Entry Closed' : 'Save Now (F2)'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="bg-[#eab308] hover:bg-[#ca8a04] text-white text-xs font-bold px-4 py-1.5 rounded cursor-pointer transition-colors shadow-xs"
          >
            Clear
          </button>
        </div>
      </div>

      {/* GENERATOR MODAL 1: Cross Generator (F6) */}
      {showCrossModal && (
        <div {...backdropProps} className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xs shadow-2xl w-full max-w-[520px] border border-slate-300">
            {/* Header */}
            <div className="bg-[#24497e] text-white px-4 py-2.5 flex items-center justify-between rounded-t-xs">
              <h3 className="text-sm font-bold tracking-wide">Cross</h3>
              <button
                type="button"
                onClick={closeCrossModal}
                className="text-white/80 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4 font-bold" />
              </button>
            </div>

            <div className="p-4">
              {/* ANDER / BAHAR / AMOUNT / JODA row */}
              <table className="w-full border-collapse table-fixed">
                <colgroup><col /><col /><col /><col className="w-16" /></colgroup>
                <thead>
                  <tr className="bg-[#24497e] text-white text-xs font-bold">
                    <th className="py-1.5 px-2 border border-[#24497e]">ANDER</th>
                    <th className="py-1.5 px-2 border border-[#24497e]">BAHAR</th>
                    <th className="py-1.5 px-2 border border-[#24497e]">AMOUNT</th>
                    <th className="py-1.5 px-2 border border-[#24497e]">JODA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="cross-ander-input"
                        type="text"
                        value={crossAnder}
                        onChange={(e) => setCrossAnder(cleanCrossDigits(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          document.getElementById('cross-bahar-input')?.focus();
                        }}
                        placeholder="NUMBER 1"
                        autoFocus
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="cross-bahar-input"
                        type="text"
                        value={crossBahar}
                        onChange={(e) => setCrossBahar(cleanCrossDigits(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          document.getElementById('cross-amount-input')?.focus();
                        }}
                        placeholder="NUMBER 2"
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="cross-amount-input"
                        type="number"
                        value={crossAmountStr}
                        onChange={(e) => setCrossAmountStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          document.getElementById('cross-joda-input')?.focus();
                        }}
                        placeholder="AMT"
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      {/* Typing Y/N sets it; clicking flips it — both land on the same state. */}
                      <input
                        id="cross-joda-input"
                        type="text"
                        value={crossJoda}
                        readOnly
                        onClick={() => setCrossJoda(prev => (prev === 'Y' ? 'N' : 'Y'))}
                        onKeyDown={(e) => {
                          const k = e.key.toUpperCase();
                          if (k === 'Y' || k === 'N') {
                            e.preventDefault();
                            setCrossJoda(k as 'Y' | 'N');
                          } else if (e.key === 'Enter') {
                            // Enter moves to (and highlights) Save; the next Enter, on the
                            // focused button, saves — same as Random's PLT-AMOUNT.
                            e.preventDefault();
                            document.getElementById('cross-save-btn')?.focus();
                          }
                        }}
                        title="Click or press Y / N to switch"
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none cursor-pointer bg-white focus:bg-[#fde68a]"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Live counters */}
              <div className="mt-3 font-bold text-sm text-slate-900">TOTAL CROSS COUNT : {crossCount}</div>
              <div className="font-bold text-sm text-slate-900">TOTAL AMOUNT : {crossTotalAmount}</div>

              {/* The two rules the live popup prints, verbatim */}
              <ol className="mt-2 text-xs text-slate-800 space-y-0.5 list-decimal list-inside">
                <li>अगर JODA "Y" है तो 00-99 JODA की ENTRY होगी</li>
                <li>अगर BOTH NUMBER BLANK है और JODA "Y" है तो सिर्फ 00-99 JODA की ENTRY होगी</li>
              </ol>

              <div className="mt-4 flex items-center justify-end gap-4">
                <button
                  type="button"
                  id="cross-save-btn"
                  onClick={handleSaveCross}
                  className="bg-[#24497e] hover:bg-[#1a355c] focus:bg-[#1a355c] text-white font-bold text-xs px-6 py-1.5 rounded-xs transition-colors shadow-xs cursor-pointer outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#24497e]"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={closeCrossModal}
                  className="text-slate-700 hover:text-black font-bold text-xs px-3 py-1.5 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GENERATOR MODAL 2: From-To Generator (F7) */}
      {showFromToModal && (
        <div {...backdropProps} className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xs shadow-2xl w-full max-w-[480px] border border-slate-300">
            {/* Header */}
            <div className="bg-[#24497e] text-white px-4 py-2.5 flex items-center justify-between rounded-t-xs">
              <h3 className="text-sm font-bold tracking-wide">From-To</h3>
              <button
                type="button"
                onClick={closeFromToModal}
                className="text-white/80 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4 font-bold" />
              </button>
            </div>

            <div className="p-4">
              <table className="w-full border-collapse table-fixed">
                <colgroup><col /><col /><col className="w-1/2" /></colgroup>
                <thead>
                  <tr className="bg-[#24497e] text-white text-xs font-bold">
                    <th className="py-1.5 px-2 border border-[#24497e]">From</th>
                    <th className="py-1.5 px-2 border border-[#24497e]">To</th>
                    <th className="py-1.5 px-2 border border-[#24497e]">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="fromto-from-input"
                        type="number"
                        value={fromNumStr}
                        onChange={(e) => setFromNumStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (fromNumStr.trim() !== '' && !isValidFromNum(fromNumStr)) {
                            showInvalidNumberToast();
                            (e.currentTarget as HTMLInputElement).select();
                            return;
                          }
                          document.getElementById('fromto-to-input')?.focus();
                        }}
                        placeholder="FROM"
                        autoFocus
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="fromto-to-input"
                        type="number"
                        value={toNumStr}
                        onChange={(e) => setToNumStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (toNumStr.trim() !== '' && !isValidToNum(toNumStr)) {
                            showInvalidNumberToast();
                            (e.currentTarget as HTMLInputElement).select();
                            return;
                          }
                          document.getElementById('fromto-amount-input')?.focus();
                        }}
                        placeholder="TO"
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="fromto-amount-input"
                        type="number"
                        value={fromToAmountStr}
                        onChange={(e) => setFromToAmountStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          document.getElementById('fromto-plt-amount-input')?.focus();
                        }}
                        placeholder="AMOUNT"
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                  </tr>
                  <tr>
                    {/* PALT SECTION spans the From + To columns, exactly as the live popup lays it out */}
                    <td colSpan={2} className="bg-[#24497e] text-white text-xs font-bold text-center py-1.5 px-2 border border-[#24497e]">
                      PALT SECTION
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        id="fromto-plt-amount-input"
                        type="number"
                        value={fromToPltAmountStr}
                        onChange={(e) => setFromToPltAmountStr(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          handleSaveFromTo();
                        }}
                        placeholder="PLT-AMOUNT"
                        className="w-full h-8 px-2 text-center font-bold text-sm font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-3 font-bold text-base text-slate-900">TOTAL AMOUNT : {fromToTotalAmount}</div>

              <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={handleSaveFromTo}
                  className="bg-[#24497e] hover:bg-[#1a355c] text-white font-bold text-xs px-6 py-1.5 rounded-xs transition-colors shadow-xs cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={closeFromToModal}
                  className="text-slate-700 hover:text-black font-bold text-xs px-3 py-1.5 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Random (F8) — Dara / Akhar Bahar / Akhar Andar, each with its own Amount */}
      {showRandom8Modal && (
        <div {...backdropProps} className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">

          <div className="bg-white rounded-xs shadow-2xl w-full max-w-[500px] border border-slate-300">
            <div className="bg-[#24497e] text-white px-4 py-2.5 flex items-center justify-between rounded-t-xs">
              <h3 className="text-sm font-bold tracking-wide">Random</h3>
              <button
                type="button"
                onClick={closeRandom8Modal}
                className="text-white/80 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4 font-bold" />
              </button>
            </div>

            <div className="p-4">
              <p className="text-xs text-slate-800">NOTE: Dara number should be 2 digit without any separator.</p>
              <p className="text-xs text-slate-800 mb-3">NOTE: Akhar number should be 1 digit without any separator.</p>

              {[
                {
                  key: 'dara', label: 'Dara', placeholder: 'NUMBERS, EG: 01 AND 89 LIKE: 0189',
                  value: r8Dara, setValue: setR8Dara, amount: r8DaraAmt, setAmount: setR8DaraAmt,
                  state: r8DaraState, multiline: true, format: formatDaraPairs,
                },
                {
                  key: 'bahar', label: 'Akhar Bahar', placeholder: 'NUMBERS, EG: 1 AND 2 LIKE: 12',
                  value: r8Bahar, setValue: setR8Bahar, amount: r8BaharAmt, setAmount: setR8BaharAmt,
                  state: r8BaharState, multiline: false, format: (v: string) => v.replace(/\D/g, ''),
                },
                {
                  key: 'andar', label: 'Akhar Andar', placeholder: 'NUMBERS, EG: 1 AND 2 LIKE: 12',
                  value: r8Andar, setValue: setR8Andar, amount: r8AndarAmt, setAmount: setR8AndarAmt,
                  state: r8AndarState, multiline: false, format: (v: string) => v.replace(/\D/g, ''),
                },
              ].map((sec) => (
                <div key={sec.key} className="flex gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-slate-700 mb-1">{sec.label}</label>
                    {sec.multiline ? (
                      <textarea
                        id={`r8-${sec.key}`}
                        onKeyDown={r8EnterNext(`r8-${sec.key}`)}
                        value={sec.value}
                        onChange={(e) => sec.setValue(sec.format(e.target.value))}
                        onBlur={() => { if (sec.state.error) setR8Toast(r8ErrorToast(sec.state.error)); }}
                        placeholder={sec.placeholder}
                        rows={3}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-xs text-sm font-bold font-mono outline-none resize-y bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal placeholder:text-xs"
                      />
                    ) : (
                      <input
                        id={`r8-${sec.key}`}
                        onKeyDown={r8EnterNext(`r8-${sec.key}`)}
                        type="text"
                        value={sec.value}
                        onChange={(e) => sec.setValue(sec.format(e.target.value))}
                        onBlur={() => { if (sec.state.error) setR8Toast(r8ErrorToast(sec.state.error)); }}
                        placeholder={sec.placeholder}
                        className="w-full h-9 px-2 border border-slate-300 rounded-xs text-sm font-bold font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal placeholder:text-xs"
                      />
                    )}
                  </div>
                  <div className="w-36 flex-shrink-0">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs text-slate-700">Amount</span>
                      <span className="text-xs font-bold text-emerald-700">
                        {sec.state.error ? 'Invalid No.' : (sec.state.total > 0 ? sec.state.total : '')}
                      </span>
                    </div>
                    <input
                      id={`r8-${sec.key}-amt`}
                      onKeyDown={r8EnterNext(`r8-${sec.key}-amt`)}
                      type="number"
                      value={sec.amount}
                      onChange={(e) => sec.setAmount(e.target.value)}
                      placeholder="AMOUNT"
                      className="w-full h-9 px-2 text-center border border-slate-300 rounded-xs text-sm font-bold font-mono outline-none bg-white focus:bg-[#fde68a] placeholder:text-slate-300 placeholder:font-normal placeholder:text-xs"
                    />
                  </div>
                </div>
              ))}

              <div className="text-center font-bold text-sm text-slate-900 my-3">
                TOTAL AMOUNT : {r8TotalAmount}
              </div>

              <div className="border-t border-slate-200 pt-3 flex items-center justify-end gap-4">
                <button
                  type="button"
                  id="r8-save-btn"
                  onClick={handleSaveRandom8}
                  className="bg-[#24497e] hover:bg-[#1a355c] text-white font-bold text-xs px-6 py-1.5 rounded-xs transition-colors shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#24497e]/40 focus:ring-offset-1"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={closeRandom8Modal}
                  className="text-slate-700 hover:text-black font-bold text-xs px-3 py-1.5 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GENERATOR MODAL 3: Random Generator matching Screenshot 1 & 3 */}
      {showRandomModal && (
        <div {...backdropProps} className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xs shadow-2xl w-full max-w-[340px] overflow-hidden border border-slate-300">
            {/* Header */}
            <div className="bg-[#24497e] text-white px-4 py-2.5 flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide">Random</h3>
              <button
                type="button"
                onClick={closeRandomModal}
                className="text-white/80 hover:text-white p-0.5 cursor-pointer"
              >
                <X className="w-4 h-4 font-bold" />
              </button>
            </div>

            <div className="p-4">
              {/* Scrollable Fields matching Screenshot 1 & 3 */}
              <div className="max-h-56 overflow-y-auto pr-1 pbmax-table-scrollbar space-y-2">
                {/* Dynamic NUMBER inputs */}
                {randomNumbers.map((numVal, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3">
                    <label className="font-bold text-xs text-slate-800 uppercase tracking-wider w-28 text-right">
                      NUMBER
                    </label>
                    <input
                      id={`random-number-${idx}`}
                      type="text"
                      value={numVal}
                      // Digits only in the Random popup's NUMBER boxes
                      inputMode="numeric"
                      onChange={(e) => handleRandomNumberChange(idx, e.target.value.replace(/\D/g, ''))}
                      onFocus={() => setActiveRandomFocus(`num-${idx}`)}
                      className={`w-32 h-7 text-center font-bold text-sm border border-slate-300 rounded-xs outline-none uppercase font-mono transition-colors ${
                        activeRandomFocus === `num-${idx}` ? 'bg-[#fde68a] border-amber-400' : 'bg-white'
                      }`}
                      placeholder=""
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();

                        // An empty box means there is nothing left to key in here, so Enter
                        // drops down to AMOUNT — the behaviour this field already had.
                        if (numVal.trim() === '') {
                          document.getElementById('random-amount-input')?.focus();
                          return;
                        }

                        // Invalid number: toast and stay on this box
                        if (!allTypedNumbersValid(numVal)) {
                          showInvalidNumberToast();
                          (e.currentTarget as HTMLInputElement).select();
                          return;
                        }

                        // A filled box steps to the NEXT number box. Typing in the last box
                        // already appended a fresh empty one (handleRandomNumberChange), so
                        // the target usually exists by now; the rAF retry covers the render
                        // not having flushed yet.
                        const focusNext = () => {
                          const el = document.getElementById(`random-number-${idx + 1}`) as HTMLInputElement | null;
                          if (!el) return false;
                          el.focus();
                          el.select();
                          return true;
                        };
                        if (!focusNext()) requestAnimationFrame(focusNext);
                      }}
                    />
                  </div>
                ))}

                {/* AMOUNT input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="font-bold text-xs text-slate-800 uppercase tracking-wider w-28 text-right">
                    AMOUNT
                  </label>
                  <input
                    id="random-amount-input"
                    type="number"
                    value={randomAmountStr}
                    onChange={(e) => setRandomAmountStr(e.target.value)}
                    onFocus={() => setActiveRandomFocus('amount')}
                    onKeyDown={(e) => {
                      // Enter carries on down the form, same as it does between the NUMBER
                      // boxes above: AMOUNT -> PLT-AMOUNT.
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      const el = document.getElementById('random-plt-amount-input') as HTMLInputElement | null;
                      el?.focus();
                      el?.select();
                    }}
                    placeholder="AMOUNT"
                    className={`w-32 h-7 text-center font-bold text-sm border border-slate-300 rounded-xs outline-none font-mono placeholder:text-slate-300 placeholder:text-xs uppercase transition-colors ${
                      activeRandomFocus === 'amount' ? 'bg-[#fde68a] border-amber-400' : 'bg-white'
                    }`}
                  />
                </div>

                {/* PLT-AMOUNT input */}
                <div className="flex items-center justify-between gap-3">
                  <label className="font-bold text-xs text-slate-800 uppercase tracking-wider w-28 text-right">
                    PLT-AMOUNT
                  </label>
                  <input
                    id="random-plt-amount-input"
                    type="number"
                    value={randomPltAmountStr}
                    onChange={(e) => setRandomPltAmountStr(e.target.value)}
                    onFocus={() => setActiveRandomFocus('plt-amount')}
                    // Enter moves to Save; the second Enter then presses the focused Save button.
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      document.getElementById('random-save-btn')?.focus();
                    }}
                    placeholder="PLT-AMOUNT"
                    className={`w-32 h-7 text-center font-bold text-sm border border-slate-300 rounded-xs outline-none font-mono placeholder:text-slate-300 placeholder:text-xs uppercase transition-colors ${
                      activeRandomFocus === 'plt-amount' ? 'bg-[#fde68a] border-amber-400' : 'bg-white'
                    }`}
                  />
                </div>
              </div>

              {/* TOTAL AMOUNT matching Screenshot 1 & 3 */}
              <div className="text-center font-bold text-xs text-slate-800 my-3 tracking-wide">
                TOTAL AMOUNT : {randomTotalAmount}
              </div>

              {/* Bottom Buttons matching Screenshot 1 & 3 */}
              <div className="border-t border-slate-200 pt-3 flex items-center justify-center gap-4">
                <button
                  type="button"
                  id="random-save-btn"
                  onClick={handleSaveRandom}
                  className="bg-[#24497e] hover:bg-[#1a355c] text-white font-bold text-xs px-6 py-1.5 rounded-xs transition-colors shadow-xs cursor-pointer outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#24497e]"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={closeRandomModal}
                  className="text-slate-700 hover:text-black font-bold text-xs px-3 py-1.5 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
