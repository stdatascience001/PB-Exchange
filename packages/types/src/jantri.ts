export interface JantriCell {
  number: string; // "00" through "99"
  totalAmount: number;
  liability: number;
  isMaxRisk?: boolean;
}

export interface HarufCell {
  digit: string; // "0" through "9"
  andarAmount: number;
  baharAmount: number;
}

export interface JantriViewDto {
  shiftId: number;
  shiftName: string;
  shiftDate: string;
  totalCollected: number;
  totalRisk: number;
  grid: JantriCell[]; // 100 items (00-99)
  haruf: HarufCell[]; // 10 items (0-9)
}

// --- Live / Declare Prediction ------------------------------------------------------------

export interface PredictionNumberRow {
  number: string;      // "00" through "99"
  sale: number;        // raw stake that would win on this number (DARA + matching haruf)
  liability: number;   // raw payout owed if this number wins
  profitLoss: number;  // NET book result if this number wins ("Amt" column)
}

export interface PredictionPartyRow {
  partyId: number;
  partyName: string;
  agentId: number | null;
  sale: number;        // raw gross sale for this party this cycle
  pnl: number;         // NET result for this party against the focused number
  lastWin: number;     // wins within the same 30-declaration window as "Result 30 Days"
}

export interface PredictionAgentGroupRow {
  agentName: string;
  sale: number;
  // The parties rolled up into this group — lets the Agent Groups popup ask the shared
  // collection endpoint for the whole group in one go, without a second lookup.
  partyIds: number[];
}

export interface PredictionDto {
  shiftId: number;
  shiftName: string;
  shiftDate: string;
  totalCollected: number; // raw gross
  netCollected: number;   // after Commission / Hissa / HP-linked Hissa
  focusNumber: string | null;
  numberPreview: PredictionNumberRow[]; // always 100 items (00-99)
  parties: PredictionPartyRow[];
  agentGroups: PredictionAgentGroupRow[];
  // Whether the result for THIS shift + date cycle has been declared — Declare Prediction
  // only shows data for declared cycles. (Additive; Live Prediction ignores it.)
  isCycleDeclared?: boolean;
}
