import { pgTable, serial, varchar, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorId: integer('actor_id').references(() => users.id).notNull(),
  action: varchar('action', { length: 50 }).notNull(), // CREATE, UPDATE, VOID, DECLARE, BLOCK_IP, UNBLOCK_IP
  entityType: varchar('entity_type', { length: 50 }).notNull(), // TRANSACTION, SHIFT, LEDGER, IP_BLOCK
  entityId: varchar('entity_id', { length: 50 }).notNull(),
  beforeData: jsonb('before_data'),
  afterData: jsonb('after_data'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId),
  actorIdx: index('audit_actor_idx').on(t.actorId),
  createdIdx: index('audit_created_idx').on(t.createdAt),
}));
