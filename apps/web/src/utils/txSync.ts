// Slip entry opens in its own tab (Live / Declare Transactions → Add (F2) / Edit use
// window.open). When a slip is saved there — or that tab is closed with its back arrow — the
// list still open in the first tab is told, so it reloads instead of showing the old rows until
// Search (F5) is pressed. Same-browser only (BroadcastChannel); nothing leaves the machine.
const CHANNEL = 'pb-transactions';

export function notifyTransactionsChanged(shiftIds: Array<number | string | null | undefined> = []) {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: 'changed', shiftIds: shiftIds.filter(v => v != null && v !== '').map(String) });
    bc.close();
  } catch {
    // BroadcastChannel not available — the list keeps its usual Search (F5) reload
  }
}

// Calls back with the shift ids that changed (empty = unknown, reload anyway). Returns the
// unsubscribe function for a useEffect cleanup.
export function onTransactionsChanged(cb: (shiftIds: string[]) => void): () => void {
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e: MessageEvent) => {
      const ids = Array.isArray(e.data?.shiftIds) ? e.data.shiftIds.map(String) : [];
      cb(ids);
    };
  } catch {
    bc = null;
  }
  return () => bc?.close();
}
