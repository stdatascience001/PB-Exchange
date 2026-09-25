import { drizzle } from 'drizzle-orm/postgres-js';
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
