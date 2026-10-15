'use strict';
// plsfollow.me: static client + WebSocket game server in one process.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./src/game');
const { Stats } = require('./src/stats');

const PORT = Number(process.env.PORT) || 8080;
const PUB = path.join(__dirname, 'public');
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 12;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
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
const stats = new Stats(process.env.DATA_DIR);

// The page is served with versioned script URLs (app.js?v=<hash>), so every deploy reaches every
// browser immediately instead of some people running a cached older script.
const crypto = require('crypto');
const INDEX = (() => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  return html.replace(/src="\/(app|audio|boss)\.js"/g, (m, name) => {
    const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUB, `${name}.js`))).digest('hex').slice(0, 10);
    return `src="/${name}.js?v=${v}"`;
  });
})();
// Invite links (/@handle) show the same page; keep them out of search results so they don't compete
// with the home page (the page's canonical link points at https://plsfollow.me/ as well)
function serveIndex(req, res, noindex) {
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': CSP, ...(noindex ? { 'X-Robots-Tag': 'noindex, follow' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : INDEX);
}

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

// ---------- Paid bots: checkout, Stripe webhook, order status, admin ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end(JSON.stringify(obj)); };
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => { size += d.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const orderHits = new Map(); // ip -> [timestamps]: at most 10 checkouts started per hour per visitor
function tooMany(ip) {
  const now = Date.now(), list = (orderHits.get(ip) || []).filter(t => now - t < 3600000);
  list.push(now); orderHits.set(ip, list);
  return list.length > 10;
}
const hitTimes = new Map(); // ip -> [timestamps]: at most 60 beacons a minute per visitor
function hitLimited(ip) {
  const now = Date.now(), list = (hitTimes.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hitTimes.set(ip, list);
  if (hitTimes.size > 5000) for (const [k, v] of hitTimes) if (now - v[v.length - 1] > 60000) hitTimes.delete(k);
  return list.length > 60;
}
const esc = v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function statsPage(r, token) {
  const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '–');
  const table = (title, obj, n = 15) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]), total = rows.reduce((a, [, c]) => a + c, 0);
    return `<section><h2>${title}</h2>${rows.length ? `<table>${rows.slice(0, n).map(([k, c]) => `<tr><td>${esc(k)}</td><td class=n>${c}</td><td class=n>${pct(c, total)}</td><td class=bar><i style="width:${Math.round(c / rows[0][1] * 100)}%"></i></td></tr>`).join('')}${rows.length > n ? `<tr><td colspan=4 class=muted>+${rows.length - n} more</td></tr>` : ''}</table>` : '<p class=muted>Nothing yet</p>'}</section>`;
  };
  const s = r.sum, link = d => `<a href="?token=${encodeURIComponent(token)}&days=${d}"${d === r.days ? ' class=on' : ''}>${d === 1 ? 'Today' : d + ' days'}</a>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>plsfollow.me stats</title>
<style>:root{color-scheme:dark}body{margin:0;padding:20px 16px 40px;background:#0a1424;color:#e8eef7;font:14px/1.45 system-ui,sans-serif}main{max-width:1000px;margin:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#9fb2c8;margin:0 0 8px}.muted{color:#7d8ea3}
nav{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 18px}nav a{color:#e8eef7;text-decoration:none;padding:6px 12px;border-radius:999px;border:1px solid #2a3a52}nav a.on{background:#ff5fa2;border-color:#ff5fa2;color:#1a0610;font-weight:700}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}.card{background:#111e33;border:1px solid #22324a;border-radius:14px;padding:12px}.card b{display:block;font-size:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}section{background:#111e33;border:1px solid #22324a;border-radius:14px;padding:12px 14px;overflow-x:auto}
table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;text-align:left;white-space:nowrap}th{color:#9fb2c8;font-weight:600;font-size:12px}.n{text-align:right;font-variant-numeric:tabular-nums}
td.bar{width:30%}.bar i{display:block;height:6px;border-radius:3px;background:#ff5fa2}td:first-child{max-width:260px;overflow:hidden;text-overflow:ellipsis}</style></head><body><main>
<h1>plsfollow.me traffic</h1><div class=muted>Days run midnight to midnight ${esc(r.tz)} time. Visitors are counted once per day per browser; bots and crawlers are skipped.</div>
<nav>${[1, 7, 30, 90].map(link).join('')}</nav>
<div class=cards><div class=card><b>${s.visitors}</b>visitors</div><div class=card><b>${s.visits}</b>visits</div><div class=card><b>${pct(s.join, s.visitors)}</b>joined the game</div>
<div class=card><b>${pct(s.spectate, s.visitors)}</b>spectated</div><div class=card><b>${pct(s.bounced, s.visitors)}</b>left without playing</div><div class=card><b>${pct(s.returning, s.visitors)}</b>returning</div></div>
<div class=grid>${table('Where they came from', s.sources)}${table('Countries (from timezone)', s.countries)}${table('Campaigns (utm source / medium / campaign)', s.campaigns)}${table('Invite links', s.invites)}${table('Devices', s.devices)}${table('Languages', s.langs)}</div>
<section style="margin-top:14px"><h2>By day</h2><table><tr><th>Day</th><th class=n>Visitors</th><th class=n>Visits</th><th class=n>Joined</th><th class=n>Spectated</th><th class=n>Shared</th><th class=n>Opened “Become a bot”</th><th class=n>Left without playing</th><th class=n>Returning</th></tr>
${r.rows.map(d => `<tr><td>${d.day}</td><td class=n>${d.visitors}</td><td class=n>${d.visits}</td><td class=n>${d.join}</td><td class=n>${d.spectate}</td><td class=n>${d.share}</td><td class=n>${d.bot}</td><td class=n>${d.bounced}</td><td class=n>${d.returning}</td></tr>`).join('') || '<tr><td colspan=9 class=muted>No visits yet</td></tr>'}</table></section>
</main></body></html>`;
}
const adminOk = token => {
  const want = process.env.ADMIN_TOKEN || '';
  return !!want && typeof token === 'string' && token.length === want.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(want));
};
async function handleApi(req, res, url) {
  const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '?';
  const p = url.pathname;
  if (p === '/api/bot-info' && req.method === 'GET') return json(res, 200, { enabled: game.paid.enabled, price: 5, days: 30 });
  if (p === '/api/bot-order' && req.method === 'POST') {
    if (!game.paid.enabled) return json(res, 503, { error: "Payments aren't set up yet. Check back soon!" });
    if (tooMany(ip)) return json(res, 429, { error: 'Too many tries. Please wait a bit.' });
    let body; try { body = JSON.parse(await readBody(req, 90 * 1024)); } catch { return json(res, 400, { error: 'Bad request' }); }
    const prof = game.checkProfile(body || {});
    if (prof.error) return json(res, 400, { error: prof.error });
    const host = req.headers.host || 'plsfollow.me', origin = (/^localhost(:\d+)?$/.test(host) ? 'http://' : 'https://') + host;
    try { const { id, url: payUrl } = await game.paid.createCheckout(prof, origin); return json(res, 200, { id, url: payUrl }); }
    catch (e) { console.error('checkout failed:', e.message); return json(res, 502, { error: "Couldn't start the payment. Please try again." }); }
  }
  const sm = p.match(/^\/api\/bot-order\/([A-Za-z0-9_-]{6,20})$/);
  if (sm && req.method === 'GET') { const st = game.paid.status(sm[1]); return st ? json(res, 200, st) : json(res, 404, { error: 'Not found' }); }
  if (p === '/api/stripe-webhook' && req.method === 'POST') {
    let raw; try { raw = await readBody(req, 1024 * 1024); } catch { return json(res, 400, { error: 'too big' }); }
    try {
      const o = game.paid.handleWebhook(raw, req.headers['stripe-signature']);
      if (o) { game.house.addPaid(o); console.log(`paid bot active: @${o.handle} (${o.platform}) until ${new Date(o.expiresAt).toISOString()}`); }
      return json(res, 200, { received: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  // Traffic beacons from the page (sent with sendBeacon, so the body is plain text JSON)
  if (p === '/api/hit' && req.method === 'POST') {
    if (hitLimited(ip)) { res.writeHead(204); res.end(); return; }
    let body = null; try { body = JSON.parse(await readBody(req, 2048)); } catch { /* ignore junk */ }
    stats.hit(body, String(req.headers['user-agent'] || ''), String(req.headers.host || '').replace(/^www\./, '').replace(/:\d+$/, ''));
    res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return;
  }
  // Admin: /admin/stats?token=...&days=30 (add &format=json for raw numbers)
  if (p === '/admin/stats' && req.method === 'GET') {
    if (!adminOk(url.searchParams.get('token'))) return json(res, 403, { error: 'forbidden' });
    const r = stats.report(Math.max(1, Math.min(120, Number(url.searchParams.get('days')) || 30)));
    if (url.searchParams.get('format') === 'json') return json(res, 200, r);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
    res.end(statsPage(r, url.searchParams.get('token')));
    return;
  }
  // Admin: /admin/bots?token=... lists paid bots; add &remove=<id> to take one down
  if (p === '/admin/bots' && req.method === 'GET') {
    if (!adminOk(url.searchParams.get('token'))) return json(res, 403, { error: 'forbidden' });
    const rm = url.searchParams.get('remove');
    if (rm) { const o = game.paid.remove(rm); return json(res, o ? 200 : 404, o ? { removed: `@${o.handle}` } : { error: 'not found' }); }
    return json(res, 200, game.paid.active().map(o => ({ id: o.id, handle: o.handle, platform: o.platform, expires: new Date(o.expiresAt).toISOString(), paid: new Date(o.paidAt).toISOString() })));
  }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local'), { pathname } = url;
  // One address for search engines: www.plsfollow.me → plsfollow.me
  if (/^www\./i.test(req.headers.host || '')) { res.writeHead(301, { Location: 'https://' + req.headers.host.replace(/^www\./i, '') + req.url }); res.end(); return; }
  if (pathname.startsWith('/api/') || pathname.startsWith('/admin/')) { handleApi(req, res, url).catch(() => json(res, 500, { error: 'server error' })); return; }
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
  if (pathname === '/' || pathname === '/index.html') { serveIndex(req, res, false); return; }
  if (/^\/@[A-Za-z0-9._-]{1,30}$/.test(pathname)) { serveIndex(req, res, true); return; }
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

function shutdown() { stats.save(); game.stop(); wss.clients.forEach(ws => ws.close(1012, 'restarting')); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
