'use strict';
// plsfollow.me: static client + WebSocket game server in one process.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./src/game');

const PORT = Number(process.env.PORT) || 8080;
const PUB = path.join(__dirname, 'public');
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 12;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
].join('; ');

const game = new Game();

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUB, path.normalize(rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(game.health()));
    return;
  }
  // Profile photos uploaded at join: /a/<boot>/<pid>. Boot id changes per process so caches never mix players.
  const am = pathname.match(/^\/a\/([0-9a-f]{8})\/(\d{1,10})$/);
  if (am) {
    const img = am[1] === game.boot && game.avatarOf(Number(am[2]));
    if (!img) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(img);
    return;
  }
  // Invite links like /@kirk.plays load the game with that friend prefilled
  if (/^\/@[A-Za-z0-9._-]{1,30}$/.test(pathname)) { serveStatic(req, res, '/'); return; }
  serveStatic(req, res, pathname);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
const perIp = new Map();

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://local');
  const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '?';
  const origin = req.headers.origin;
  let sameOrigin = true;
  try { if (origin) sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
  if (pathname !== '/ws' || !sameOrigin || (perIp.get(ip) || 0) >= MAX_CONN_PER_IP) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const c = game.connect(ws, ip);
    ws.on('message', (data, isBinary) => { if (!isBinary) game.onMessage(c, data.toString()); });
    ws.on('close', () => {
      game.disconnect(c);
      const n = (perIp.get(ip) || 1) - 1;
      if (n) perIp.set(ip, n); else perIp.delete(ip);
    });
    ws.on('error', () => {});
  });
});

server.listen(PORT, () => console.log(`plsfollow.me listening on http://localhost:${PORT}`));

function shutdown() { game.stop(); wss.clients.forEach(ws => ws.close(1012, 'restarting')); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
