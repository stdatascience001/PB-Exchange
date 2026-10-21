import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableColumns, is } from 'drizzle-orm';
import { PgTable, PgTimestamp } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:Sss1234!@localhost:5434/pb_exchange';

// Connection client for queries
export const sql = postgres(connectionString, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema });
export type DB = typeof db;

// ---------------------------------------------------------------------------------------------
// TIMESTAMP (without time zone) columns hold wall-clock time — the DEFAULT now() writes it in the
// database's own TimeZone setting (IST on an "Asia/Calcutta" server: a slip saved at 10:33 PM is
// stored 22:33). Drizzle, though, reads that text as UTC (and writes Dates as UTC), so on an IST
// database a slip saved 21-10 10:33 PM came back as 22-10 04:03 AM in the lists. The columns are
// read and written in the database's TimeZone instead, so a stored 22:33 is 10:33 PM IST. On a UTC
// database nothing changes (that is exactly drizzle's own mapping).
// ---------------------------------------------------------------------------------------------
let dbTimeZone = 'UTC';
const isUtcZone = (tz: string) => /^(etc\/)?(utc|gmt|zulu|universal|uct)$/i.test(tz.trim());

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
// Offset (ms) of the zone from UTC at that instant
const zoneOffsetMs = (tz: string, instant: number): number => {
  let f = zoneFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    zoneFormatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(instant))) p[part.type] = part.value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(instant / 1000) * 1000;
};

// stored wall-clock text ("2026-10-21 22:33:07.68") -> the instant it means in the DB's zone
const fromDbWallClock = (value: string): Date => {
  const asUtc = new Date(value + '+0000'); // drizzle's own reading
  if (isUtcZone(dbTimeZone) || isNaN(asUtc.getTime())) return asUtc;
  const wall = asUtc.getTime();
  const first = zoneOffsetMs(dbTimeZone, wall);
  const offset = zoneOffsetMs(dbTimeZone, wall - first);
  return new Date(wall - offset);
};

// Date -> wall-clock text in the DB's zone ("2026-10-21 22:33:07.680")
const toDbWallClock = (value: Date): string => {
  if (isUtcZone(dbTimeZone)) return value.toISOString(); // drizzle's own writing
  const ms = value.getTime();
  return new Date(ms + zoneOffsetMs(dbTimeZone, ms)).toISOString().replace('T', ' ').replace('Z', '');
};

for (const table of Object.values(schema)) {
  if (!is(table, PgTable)) continue;
  for (const column of Object.values(getTableColumns(table))) {
    if (!is(column, PgTimestamp) || column.withTimezone) continue;
    column.mapFromDriverValue = (value: string) => fromDbWallClock(value);
    column.mapToDriverValue = (value: Date) => toDbWallClock(value);
  }
}

// Reads the database's TimeZone (DB_TIMEZONE in the environment overrides it). Run once at server
// start, before requests are served; until then (and in one-off scripts) timestamps stay UTC.
export async function initDbTimezone(): Promise<string> {
  try {
    let tz = (process.env.DB_TIMEZONE || '').trim();
    if (!tz) {
      const [row] = await sql<Array<{ TimeZone: string }>>`SHOW timezone`;
      tz = row?.TimeZone || 'UTC';
    }
    // an unknown zone name (e.g. a POSIX "<+0530>-0530") keeps drizzle's UTC mapping
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    dbTimeZone = tz;
  } catch (err) {
    console.warn('[DB] TimeZone not usable, timestamps stay UTC:', err);
    dbTimeZone = 'UTC';
  }
  return dbTimeZone;
}
