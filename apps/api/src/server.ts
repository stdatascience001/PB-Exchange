import { createApp } from './app.js';
import { env } from './config/env.js';
import { ensureReportIndexes } from './common/report-indexes.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`===============================================`);
  console.log(` PB EXCHANGE API SERVER RUNNING ON PORT ${env.PORT} `);
  console.log(` Environment: ${env.NODE_ENV}                  `);
  console.log(` Prefix:      ${env.API_PREFIX}                `);
  console.log(`===============================================`);
  // Report indexes (built once, in the background, without locking the tables)
  void ensureReportIndexes();
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
