import type { Server } from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { ensureReportIndexes } from './common/report-indexes.js';
import { initDbTimezone } from '@pb/database';

const app = createApp();

let server: Server | undefined;

// Timestamps are read / written in the database's own TimeZone (see @pb/database client) — known
// before the first request is served
void initDbTimezone().then((dbTimeZone) => {
  console.log(`[DB] TimeZone: ${dbTimeZone}`);
  server = app.listen(env.PORT, () => {
    console.log(`===============================================`);
    console.log(` PB EXCHANGE API SERVER RUNNING ON PORT ${env.PORT} `);
    console.log(` Environment: ${env.NODE_ENV}                  `);
    console.log(` Prefix:      ${env.API_PREFIX}                `);
    console.log(`===============================================`);
    // Report indexes (built once, in the background, without locking the tables)
    void ensureReportIndexes();
  });
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server?.close(() => {
    console.log('HTTP server closed');
  });
});
