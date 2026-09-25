import { pgTable, serial, integer, text, varchar, timestamp } from 'drizzle-orm/pg-core';
import { roles } from './auth.js';

export const roleMessages = pgTable('role_messages', {
  id: serial('id').primaryKey(),
  roleId: integer('role_id').references(() => roles.id).notNull().unique(),
  message: text('message').default('').notNull(),
  flashMessage: text('flash_message').default('').notNull(),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
