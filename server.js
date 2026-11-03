'use strict';

// Static server plus the live-feed API for the Draftpad prototype. No dependencies.
// Railway sets PORT; locally it falls back to 3000.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createFeed, WINDOWS } = require('./feed');
const { createLauncher, metadataFor } = require('./launch');

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

// Reads a small JSON body. Resolves null when it is too large or not JSON.
function readJson(req, maxBytes) {
  return new Promise(resolve => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', c => {
      size += c.length;
      if (over) return; // keep draining so the client gets an answer, but stop storing
      if (size > maxBytes) { over = true; chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (err) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// The public address of this site, used inside token metadata links.
function baseUrlFor(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return '';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return proto + '://' + host;
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function createApp(opts) {
  const feed = opts.feed;
  const launcher = opts.launcher || null;

  return http.createServer((req, res) => {
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

    // The one POST route: asks the server to prepare an unsigned launch transaction.
    if (req.method === 'POST' && (pathname === '/api/launch/prepare' || pathname === '/api/launch/buy')) {
      const action = pathname === '/api/launch/buy' ? 'buy' : 'prepare';
      const noStore = Object.assign({}, JSON_TYPE, { 'Cache-Control': 'no-store', Connection: 'close' });
      if (!launcher) return send(res, 503, JSON.stringify({ error: 'launch_unavailable' }), noStore);
      readJson(req, 4096).then(body => {
        if (!body) return send(res, 400, JSON.stringify({ error: 'bad_request' }), noStore);
        return launcher[action](body, { ip: clientIp(req), baseUrl: baseUrlFor(req) })
          .then(r => send(res, r.status, JSON.stringify(r.body), noStore));
      }).catch(() => send(res, 500, JSON.stringify({ error: 'server_error' }), noStore));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', Object.assign({ Allow: 'GET, HEAD' }, TEXT_TYPE));
    }

    // Whether launching is switched on, so the page knows whether to offer it.
    if (pathname === '/api/launch/config') {
      const info = launcher ? launcher.info() : { enabled: false, cluster: 'devnet', presets: [] };
      return send(res, 200, JSON.stringify(info), Object.assign({}, JSON_TYPE, { 'Cache-Control': 'no-store' }));
    }

    // Read-only chain lookups for the page: did a transaction land, and where does a curve stand.
    if (pathname === '/api/launch/status' || pathname === '/api/launch/pool') {
      const noStore = Object.assign({}, JSON_TYPE, { 'Cache-Control': 'no-store' });
      if (!launcher) return send(res, 503, JSON.stringify({ error: 'launch_unavailable' }), noStore);
      const ctx = { ip: clientIp(req) };
      const run = pathname === '/api/launch/status' ? launcher.status(url.searchParams.get('sig'), ctx) : launcher.pool(url.searchParams.get('address'), ctx);
      run.then(r => send(res, r.status, req.method === 'HEAD' ? '' : JSON.stringify(r.body), noStore))
        .catch(() => send(res, 500, JSON.stringify({ error: 'server_error' }), noStore));
      return;
    }

    // Token metadata read by wallets and explorers. Built from the link, nothing stored.
    if (pathname === '/meta.json') {
      const meta = metadataFor(url.searchParams.get('n'), url.searchParams.get('s'));
      if (!meta) return send(res, 400, JSON.stringify({ error: 'bad_metadata' }), JSON_TYPE);
      return send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(meta), Object.assign({}, JSON_TYPE, { 'Cache-Control': 'public, max-age=86400' }));
    }

    // Health check for the host platform. Says whether the live feed has a key, never the key.
    if (pathname === '/healthz') {
      return send(res, 200, JSON.stringify({ ok: true, liveFeed: feed.configured }), JSON_TYPE);
    }

    // Trending tokens, cached server-side so the upstream API key stays private.
    if (pathname === '/api/trending') {
      const win = url.searchParams.get('window') || '1h';
      if (WINDOWS.indexOf(win) === -1) {
        return send(res, 400, JSON.stringify({ error: 'bad_window' }), JSON_TYPE);
      }
      feed.get(win).then(result => {
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
  const launcher = createLauncher({
    presetsFile: path.join(__dirname, 'devnet', 'presets.json'),
    rpcUrl: process.env.LAUNCH_RPC_URL || undefined
  });
  const server = createApp({ feed, launcher });
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Draftpad listening on port ' + PORT + (feed.configured ? ' (live feed on)' : ' (live feed off: set JUPITER_API_KEY)') +
      (launcher.info().enabled ? ' (devnet launch on)' : ' (devnet launch off: no devnet/presets.json)'));
  });
  // Railway stops containers with SIGTERM; close cleanly.
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}
