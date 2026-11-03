'use strict';

// Static server plus the live-feed API for the Draftpad prototype. No dependencies.
// Railway sets PORT; locally it falls back to 3000.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createFeed, CATEGORIES } = require('./feed');

const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};
const JSON_TYPE = { 'Content-Type': 'application/json; charset=utf-8' };
const TEXT_TYPE = { 'Content-Type': 'text/plain; charset=utf-8' };

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
}

function createApp(opts) {
  const feed = opts.feed;

  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', Object.assign({ Allow: 'GET, HEAD' }, TEXT_TYPE));
    }

    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch (err) {
      return send(res, 400, 'Bad request', TEXT_TYPE);
    }
    if (pathname.indexOf('\0') !== -1) {
      return send(res, 400, 'Bad request', TEXT_TYPE);
    }

    // Health check for the host platform. Says whether the live feed has a key, never the key.
    if (pathname === '/healthz') {
      return send(res, 200, JSON.stringify({ ok: true, liveFeed: feed.configured }), JSON_TYPE);
    }

    // Trending tokens, cached server-side so the upstream API key stays private.
    if (pathname === '/api/trending') {
      const category = url.searchParams.get('category') || 'toptrending';
      if (CATEGORIES.indexOf(category) === -1) {
        return send(res, 400, JSON.stringify({ error: 'bad_category' }), JSON_TYPE);
      }
      feed.get(category).then(result => {
        const headers = Object.assign({}, JSON_TYPE, { 'Cache-Control': result.status === 200 ? 'public, max-age=30' : 'no-store' });
        send(res, result.status, req.method === 'HEAD' ? '' : JSON.stringify(result.body), headers);
      }).catch(() => {
        send(res, 500, JSON.stringify({ error: 'server_error' }), Object.assign({}, JSON_TYPE, { 'Cache-Control': 'no-store' }));
      });
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(PUBLIC_DIR, pathname);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      return send(res, 403, 'Forbidden', TEXT_TYPE);
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        return send(res, 404, 'Not found', TEXT_TYPE);
      }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      send(res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    });
  });
}

module.exports = { createApp };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const feed = createFeed({
    apiKey: process.env.JUPITER_API_KEY || '',
    base: process.env.JUPITER_BASE || undefined,
    ttlMs: (Number(process.env.FEED_TTL_SECONDS) || 300) * 1000
  });
  const server = createApp({ feed });
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Draftpad listening on port ' + PORT + (feed.configured ? ' (live feed on)' : ' (live feed off: set JUPITER_API_KEY)'));
  });
  // Railway stops containers with SIGTERM; close cleanly.
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}
