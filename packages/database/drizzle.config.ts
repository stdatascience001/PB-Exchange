import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Points at the compiled output (run `npm run build` first) rather than ./src — drizzle-kit's
// loader does a plain CJS require() and can't resolve the NodeNext-style ".js" relative
// imports used across the TypeScript source files in ./src/schema.
export default defineConfig({
  schema: './dist/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pb_exchange',
  },
});
