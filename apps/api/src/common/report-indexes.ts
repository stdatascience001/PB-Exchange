import { sql as pgSql } from '@pb/database';

// Indexes the balance / month-end reports lean on (Trail Balance, OutStanding, Admin Cash, Cash
// Report, HVS Process, Hawa Patti, Vapsi): every one of them joins voucher_entries on its voucher
// and ledger and filters vouchers / transactions by date, which without these is a full scan of
// each table on every load. Same definitions as migrate.ts; built here once at start-up with
// CONCURRENTLY so a live database keeps taking slips and vouchers while they build. Best-effort:
// a failure is logged and the reports keep working, only slower.
const REPORT_INDEXES = [
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS voucher_entries_ledger_idx ON voucher_entries(ledger_id, voucher_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS voucher_entries_voucher_idx ON voucher_entries(voucher_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS vouchers_type_date_idx ON vouchers(voucher_type, created_at)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS trans_party_date_idx ON transactions(party_id, created_at)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS trans_entries_tx_type_idx ON transaction_entries(transaction_id, entry_type)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS shift_cycles_shift_date_status_idx ON shift_cycles(shift_id, cycle_date, status)',
  // Productivity Report: each operator's slips in a date range
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS trans_created_by_date_idx ON transactions(created_by, created_at)',
  // Productivity Audit: the verdicts (audit_logs AUDIT) in a date range
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_action_date_idx ON audit_logs(action, created_at)',
];

export async function ensureReportIndexes(): Promise<void> {
  for (const ddl of REPORT_INDEXES) {
    try {
      await pgSql.unsafe(ddl);
    } catch (err) {
      console.warn(`[report-indexes] skipped: ${ddl} —`, (err as Error)?.message || err);
    }
  }
}
