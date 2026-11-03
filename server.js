'use strict';

// Minimal static server for the Draftpad prototype. No dependencies.
// Railway sets PORT; locally it falls back to 3000.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
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

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (pathname.indexOf('\0') !== -1) {
    return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  // Health check for the host platform.
  if (pathname === '/healthz') {
    return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(PUBLIC_DIR, pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Draftpad listening on port ' + PORT);
});

// Railway stops containers with SIGTERM; close cleanly.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
