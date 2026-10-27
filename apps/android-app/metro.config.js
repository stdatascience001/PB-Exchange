// Expo SDK 52 detects the npm workspace (monorepo) on its own. Additions here:
//  1. the old web copy kept for reference (_web-copy-backup, a Vite app) stays out of the bundle;
//  2. web build only (`expo start --web`): requests to /api/* on the dev server are forwarded to the
//     API in EXPO_PUBLIC_API_URL — the browser then calls its own origin, so the API's CORS setting
//     (which allows only the web app's address) is not in the way. Android / iOS call the API directly.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const http = require('http');
const https = require('https');

const config = getDefaultConfig(__dirname);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const backupDir = path.resolve(__dirname, '_web-copy-backup');
// matches the folder with either path separator (Windows / macOS / Linux)
const pattern = escape(backupDir).replace(/\\\\|\//g, '[\\\\/]');
config.resolver.blockList = [new RegExp(`^${pattern}[\\\\/].*`)];

// ---- /api proxy for the web build --------------------------------------------------------------
let apiTarget = null;
try {
  apiTarget = new URL(process.env.EXPO_PUBLIC_API_URL || 'https://punjabking.supremetechnologiesindia.com/api/v1');
} catch {
  apiTarget = null;
}

if (apiTarget) {
  const client = apiTarget.protocol === 'https:' ? https : http;
  config.server = {
    ...config.server,
    enhanceMiddleware: (middleware) => (req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return middleware(req, res, next);
      const headers = { ...req.headers, host: apiTarget.host };
      delete headers.origin;
      delete headers.referer;
      const upstream = client.request(
        {
          protocol: apiTarget.protocol,
          hostname: apiTarget.hostname,
          port: apiTarget.port || (apiTarget.protocol === 'https:' ? 443 : 80),
          path: req.url,
          method: req.method,
          headers,
        },
        (up) => {
          const outHeaders = { ...up.headers };
          // The dev server gzips responses, which holds a stream back until it ends — an SSE feed
          // (the dashboard) is marked no-transform so it is passed through as it comes
          if (String(outHeaders['content-type'] || '').includes('text/event-stream')) {
            outHeaders['cache-control'] = 'no-cache, no-transform';
          }
          res.writeHead(up.statusCode || 502, outHeaders);
          if (typeof res.flushHeaders === 'function') res.flushHeaders();
          up.pipe(res); // streams too (the dashboard SSE feed)
        },
      );
      upstream.on('error', (err) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { code: 'PROXY', message: `API not reachable: ${err.message}` } }));
      });
      // the browser went away (e.g. a closed SSE stream): drop the upstream call too. (Not req
      // 'close' — that fires as soon as a GET's empty body is read and would cut every call.)
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
    },
  };
}

module.exports = config;
