'use strict';
// Authoritative simulation for plsfollow.me. One room, one loop, everyone gets the same state buffer.
const crypto = require('crypto');

const CFG = {
  TICK_MS: 50,
  LEAD_MS: 30000, // every head leads for exactly this long
  RACE_MS: 10000, // the last part of a turn is the race for next head
  SPEED: 190, TURN: 4.6, SPACING: 21, HIT: 22, SELF_SKIP: 10,
  GRACE_MS: 1500, STEAL_GRACE_MS: 800,
  BOOST_MS: 3000, BOOST: 1.6, BOLT_HIT: 28,
  BOT_FILL: 24, // grey ghosts keep the room from looking empty; one leaves per human
  AUTOPILOT_MS: 1000, AFK_MS: 8000,
  MIN_REACTION_MS: 120, GO_WARN_MS: 1200,
};
const BOT_BASE = 2 ** 31; // bot pids live above this, so clients can tell them apart
const PLATFORMS = new Set(['ig', 'tt', 'x', 'yt', 'tw']);
const HANDLE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const BANNED_RE = /(n[i1]gg|f[a@4]gg|r[a@4]pist|nazi|hitler|kys|cunt|whore|pedo)/i;
const MAX_IMG_B64 = 48000;

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const OPEN = 1; // WebSocket.OPEN

class Game {
  constructor() {
    this.boot = crypto.randomBytes(4).toString('hex');
    this.now = Date.now();
    this.players = new Map();
    this.clients = new Set();
    this.snakes = [];
    this.bolts = [];
    this.events = [];
    this.pidSeq = 1; this.botSeq = 0; this.sidSeq = 1;
    this.humans = 0; this.bots = 0;
    this.arenaR = this.radiusFor(CFG.BOT_FILL);
    this.perf = { sum: 0, n: 0, max: 0, avg: 0, peak: 0 };
    this.spawnLine(this.makeBots(16), 300, 0, Math.PI);
    this.spawnLine(this.makeBots(8), -250, 450, 0.3);
    this.timer = setInterval(() => this.tick(), CFG.TICK_MS);
    this.pinger = setInterval(() => this.ping(), 2000);
  }

  radiusFor(n) { return 800 + 30 * Math.sqrt(n); }

  // ---------- Players and snakes ----------
  makeBots(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = { pid: BOT_BASE + (this.botSeq++ % BOT_BASE), bot: true, x: 0, y: 0, angle: 0, target: 0, wob: 0, lastInput: 0, lastSteer: 0 };
      this.players.set(p.pid, p); out.push(p);
    }
    this.bots += n;
    return out;
  }
  makeSnake(members) {
    const id = this.sidSeq; this.sidSeq = (this.sidSeq % 65535) + 1;
    const s = { id, members, grace: this.now + CFG.GRACE_MS, turn: 0, leaderSince: 0, boostUntil: 0, race: null };
    this.snakes.push(s); this.promote(s);
    return s;
  }
  spawnLine(members, x, y, ang) {
    members.forEach((p, i) => { p.x = x - Math.cos(ang) * i * CFG.SPACING; p.y = y - Math.sin(ang) * i * CFG.SPACING; });
    members[0].angle = members[0].target = ang;
    return this.makeSnake(members);
  }
  snakeOf(p) { return this.snakes.find(s => s.members.includes(p)); }
  biggest() { return this.snakes.reduce((a, b) => (!a || b.members.length > a.members.length ? b : a), null); }
  hasHuman(s) { return s.members.some(p => !p.bot); }
  active(p) { return !p.bot && this.now - p.lastInput < CFG.AFK_MS; }

  promote(s) {
    const h = s.members[0], n = s.members[1];
    if (n) h.angle = Math.atan2(h.y - n.y, h.x - n.x);
    h.target = h.angle;
    s.leaderSince = this.now; s.boostUntil = 0; s.turn = (s.turn + 1) & 255;
    s.race = { entries: new Map(), goAt: this.now + CFG.LEAD_MS - CFG.RACE_MS + rand(1500, 5500), warned: false, dirty: false };
  }

  endTurn(s, why) {
    const m = s.members, old = m[0];
    if (m.length < 2) { this.promote(s); return; }
    const win = this.raceWinner(s);
    m.shift(); m.push(old);
    // Race winner leads. Otherwise the next active human in line; bots only lead bot-only snakes.
    let next = win ? win.p : m.find(p => this.active(p)) || m.find(p => !p.bot) || m[0];
    if (next !== m[0]) { m.splice(m.indexOf(next), 1); m.unshift(next); }
    this.promote(s);
    this.event({ k: 'turn', sid: s.id, head: m[0].pid, prev: old.pid, ms: win ? win.ms : 0, why });
  }

  raceWinner(s) {
    let best = null;
    for (const e of s.race.entries.values()) {
      if (e.ms > 0 && (!best || e.ms < best.ms) && e.p !== s.members[0] && s.members.includes(e.p)) best = e;
    }
    return best;
  }

  removePlayer(p) {
    this.players.delete(p.pid);
    if (p.bot) this.bots--; else this.humans--;
    const s = this.snakeOf(p); if (!s) return;
    const i = s.members.indexOf(p);
    s.members.splice(i, 1);
    if (!s.members.length) { this.snakes.splice(this.snakes.indexOf(s), 1); return; }
    if (i === 0) { this.promote(s); this.event({ k: 'turn', sid: s.id, head: s.members[0].pid, prev: p.pid, ms: 0, why: 'left' }); }
  }

  balanceBots() {
    const want = Math.max(0, CFG.BOT_FILL - this.humans);
    // A few per tick, so the world changes gradually
    for (let i = 0; i < 3 && this.bots < want; i++) {
      const s = this.biggest(), [b] = this.makeBots(1);
      if (!s) { this.spawnLine([b], rand(-300, 300), rand(-300, 300), rand(0, TAU)); continue; }
      const t = s.members[s.members.length - 1]; b.x = t.x; b.y = t.y; s.members.push(b);
    }
    for (let i = 0; i < 3 && this.bots > want; i++) {
      let victim = null;
      for (const s of [...this.snakes].sort((a, b) => b.members.length - a.members.length)) {
        for (let k = s.members.length - 1; k >= 0 && !victim; k--) if (s.members[k].bot) victim = s.members[k];
        if (victim) break;
      }
      if (!victim) break;
      this.removePlayer(victim);
    }
  }

  // ---------- Loop ----------
  tick() {
    const t0 = process.hrtime.bigint();
    const prev = this.now; this.now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (this.now - prev) / 1000));
    this.balanceBots();
    let segs = 0; for (const s of this.snakes) segs += s.members.length;
    this.arenaR += (this.radiusFor(segs) - this.arenaR) * 0.01;
    const wantBolts = Math.min(30, 6 + Math.floor(Math.sqrt(segs)));
    while (this.bolts.length < wantBolts) this.bolts.push(this.spawnBolt());
    if (this.bolts.length > wantBolts) this.bolts.length = wantBolts;

    for (const s of this.snakes.slice()) this.leadership(s);
    for (const s of this.snakes) this.move(s, dt);
    this.collide();
    this.flushRaceBoards();
    this.broadcast();

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const pf = this.perf; pf.sum += ms; pf.n++; pf.max = Math.max(pf.max, ms);
    if (pf.n >= 200) { pf.avg = pf.sum / pf.n; pf.peak = pf.max; pf.sum = pf.n = pf.max = 0; }
  }

  leadership(s) {
    const h = s.members[0];
    if (h.bot && this.hasHuman(s)) { this.endTurn(s, 'human'); return; }
    if (!h.bot && s.members.length > 1 && this.now - h.lastInput > CFG.AFK_MS && s.members.some(p => p !== h && this.active(p))) { this.endTurn(s, 'afk'); return; }
    if (this.now - s.leaderSince >= CFG.LEAD_MS) { this.endTurn(s, 'time'); return; }
    const r = s.race;
    if (!r.warned && this.now >= r.goAt - CFG.GO_WARN_MS) {
      r.warned = true;
      // The green moment goes out shortly before it happens, so everyone's pad turns green together
      const msg = JSON.stringify({ t: 'go', sid: s.id, turn: s.turn, at: r.goAt });
      for (let i = 1; i < s.members.length; i++) { const c = s.members[i].client; if (c) this.sendRaw(c, msg); }
    }
  }

  spawnBolt() {
    const a = rand(0, TAU), r = Math.sqrt(Math.random()) * this.arenaR * 0.85;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  wander(h) {
    h.wob = h.wob * 0.96 + (Math.random() - 0.5) * 0.35;
    h.target = h.angle + h.wob;
    let best = null, bd = 340;
    for (const b of this.bolts) { const d = Math.hypot(b.x - h.x, b.y - h.y); if (d < bd) { bd = d; best = b; } }
    if (best) h.target = Math.atan2(best.y - h.y, best.x - h.x) + h.wob * 0.3;
    if (Math.hypot(h.x, h.y) > this.arenaR * 0.72) h.target = Math.atan2(-h.y, -h.x) + h.wob * 0.3;
  }

  move(s, dt) {
    const m = s.members, h = m[0], sp = CFG.SPEED * (this.now < s.boostUntil ? CFG.BOOST : 1);
    // Humans steer; a head with no recent input (tab hidden, dropped) goes on autopilot
    if (h.bot || this.now - h.lastSteer > CFG.AUTOPILOT_MS) this.wander(h);
    let d = h.target - h.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
    const mt = CFG.TURN * dt; h.angle += Math.max(-mt, Math.min(mt, d));
    h.x += Math.cos(h.angle) * sp * dt; h.y += Math.sin(h.angle) * sp * dt;
    const r = Math.hypot(h.x, h.y);
    if (r > this.arenaR) { h.x *= this.arenaR / r; h.y *= this.arenaR / r; }
    for (let i = 1; i < m.length; i++) {
      const a = m[i - 1], p = m[i], dx = a.x - p.x, dy = a.y - p.y, dist = Math.hypot(dx, dy);
      if (dist > CFG.SPACING) { const mv = Math.min(dist - CFG.SPACING, CFG.SPEED * 2.5 * dt); p.x += dx / dist * mv; p.y += dy / dist * mv; }
    }
    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i];
      if (Math.abs(b.x - h.x) < CFG.BOLT_HIT && Math.abs(b.y - h.y) < CFG.BOLT_HIT && Math.hypot(b.x - h.x, b.y - h.y) < CFG.BOLT_HIT) {
        this.event({ k: 'boost', sid: s.id, x: Math.round(b.x), y: Math.round(b.y) });
        s.boostUntil = this.now + CFG.BOOST_MS; this.bolts[i] = this.spawnBolt();
      }
    }
  }

  collide() {
    const touched = new Set(), HIT = CFG.HIT;
    for (const s of this.snakes.slice()) {
      if (touched.has(s) || this.now < s.grace || !s.members.length) continue;
      const h = s.members[0];
      let hit = null;
      for (const t of this.snakes) {
        if (touched.has(t) || (t !== s && this.now < t.grace)) continue;
        const m = t.members;
        for (let k = t === s ? CFG.SELF_SKIP : 0; k < m.length; k++) {
          const q = m[k];
          if (Math.abs(q.x - h.x) < HIT && Math.abs(q.y - h.y) < HIT && Math.hypot(q.x - h.x, q.y - h.y) < HIT) { hit = { t, k }; break; }
        }
        if (hit) break;
      }
      if (!hit) continue;
      touched.add(s); touched.add(hit.t);
      const t = hit.t, at = t.members[hit.k], x = Math.round(at.x), y = Math.round(at.y);
      if (t === s) {
        // Self-bite: everything from the bite point becomes a new snake
        const tail = s.members.splice(hit.k);
        s.grace = this.now + CFG.GRACE_MS;
        const ns = this.makeSnake(tail);
        this.event({ k: 'bite', sid: s.id, nsid: ns.id, k2: hit.k, n: tail.length, x, y });
      } else if (hit.k === 0) {
        // Head-on: the bigger snake captures the other head
        const [win, lose] = s.members.length >= t.members.length ? [s, t] : [t, s];
        const victim = lose.members.shift();
        win.members.push(victim);
        win.grace = lose.grace = this.now + CFG.GRACE_MS;
        if (lose.members.length) this.promote(lose);
        this.event({ k: 'clash', win: win.id, lose: lose.id, victim: victim.pid, x: Math.round(h.x), y: Math.round(h.y) });
      } else {
        // Steal: everyone from the hit point to the tail joins the attacker
        const tail = t.members.splice(hit.k);
        s.members.push(...tail);
        s.grace = this.now + CFG.STEAL_GRACE_MS;
        this.event({ k: 'steal', thief: s.id, victim: t.id, k2: hit.k, n: tail.length, x, y });
      }
    }
    for (let i = this.snakes.length - 1; i >= 0; i--) if (!this.snakes[i].members.length) this.snakes.splice(i, 1);
  }

  // ---------- Race ----------
  tap(c, m) {
    const p = c.player; if (!p) return;
    const s = this.snakeOf(p);
    const reply = (ok, extra) => this.send(c, { t: 'tapr', ok, ...extra });
    if (!s || s.members[0] === p || s.id !== m.sid || s.turn !== m.turn) return reply(false, { why: 'turn' });
    const r = s.race;
    if (r.entries.has(p.pid) || this.now < s.leaderSince + CFG.LEAD_MS - CFG.RACE_MS) return reply(false, { why: 'closed' });
    const ms = Math.round(Number(m.ms));
    if (!Number.isFinite(ms)) return;
    if (ms < 0 || this.now < r.goAt - 300) { r.entries.set(p.pid, { p, ms: -1 }); return reply(false, { why: 'early' }); }
    // Each client times its own reaction. The claimed time must fit when the tap actually arrived.
    const lag = this.now - r.goAt - ms;
    if (ms < CFG.MIN_REACTION_MS || lag < -400 || lag > (c.rtt || 300) + 500) { r.entries.set(p.pid, { p, ms: -1 }); return reply(false, { why: 'invalid' }); }
    r.entries.set(p.pid, { p, ms }); r.dirty = true;
    let rank = 1; for (const e of r.entries.values()) if (e.ms > 0 && e.ms < ms) rank++;
    reply(true, { ms, rank });
  }

  flushRaceBoards() {
    for (const s of this.snakes) {
      const r = s.race; if (!r.dirty) continue; r.dirty = false;
      const top = [...r.entries.values()].filter(e => e.ms > 0 && s.members.includes(e.p)).sort((a, b) => a.ms - b.ms).slice(0, 3).map(e => [e.p.pid, e.ms]);
      const msg = JSON.stringify({ t: 'race', sid: s.id, turn: s.turn, top, n: r.entries.size });
      for (const p of s.members) if (p.client) this.sendRaw(p.client, msg);
    }
  }

  // ---------- Networking ----------
  connect(ws) {
    const c = { ws, player: null, rtt: 300, pingAt: 0, alive: true, opened: new Set(), bucket: 40, bucketAt: Date.now() };
    this.clients.add(c);
    this.send(c, { t: 'hello', boot: this.boot, now: Date.now(), cfg: { LEAD_MS: CFG.LEAD_MS, RACE_MS: CFG.RACE_MS, TICK_MS: CFG.TICK_MS } });
    const l = []; for (const p of this.players.values()) if (!p.bot) l.push(this.profileRow(p));
    if (l.length) this.send(c, { t: 'prof', l });
    ws.on('pong', () => { c.alive = true; if (c.pingAt) c.rtt = Date.now() - c.pingAt; });
    return c;
  }

  disconnect(c) {
    this.clients.delete(c);
    const p = c.player; if (!p) return;
    c.player = null; p.client = null;
    this.removePlayer(p);
    this.broadcastJson({ t: 'bye', pid: p.pid });
  }

  ping() {
    for (const c of this.clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false; c.pingAt = Date.now();
      try { c.ws.ping(); } catch { /* closing */ }
    }
  }

  onMessage(c, raw) {
    // Token bucket: 40 messages per second, bursts up to 40
    const t = Date.now();
    c.bucket = Math.min(40, c.bucket + (t - c.bucketAt) * 0.04); c.bucketAt = t;
    if (c.bucket < 1) return; c.bucket--;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (c.player) c.player.lastInput = this.now;
    switch (m.t) {
      case 'join': return this.join(c, m);
      case 'a': {
        const p = c.player, a = Number(m.a);
        if (p && Number.isFinite(a)) { p.target = a; p.lastSteer = this.now; }
        return;
      }
      case 'tap': return this.tap(c, m);
      case 'open': return this.open(c, m);
      case 'sync': return this.send(c, { t: 'sync', c: Number(m.c) || 0, s: Date.now() });
      default: return; // 'hb' and unknown messages only count as activity
    }
  }

  join(c, m) {
    if (c.player) return;
    let handle = typeof m.handle === 'string' ? m.handle.trim().replace(/^@+/, '') : '';
    if (handle && (!HANDLE_RE.test(handle) || BANNED_RE.test(handle))) return this.send(c, { t: 'err', msg: "That handle can't be used. Letters, numbers, . _ and - only." });
    const platform = PLATFORMS.has(m.platform) ? m.platform : 'ig';
    let img = null;
    if (typeof m.img === 'string' && m.img.length <= MAX_IMG_B64) {
      const buf = Buffer.from(m.img, 'base64');
      if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) img = buf; // JPEG only
    }
    const p = { pid: this.pidSeq++, bot: false, handle: handle || null, platform, img, client: c, x: 0, y: 0, angle: 0, target: 0, wob: 0, lastInput: this.now, lastSteer: 0 };
    this.players.set(p.pid, p); this.humans++;
    c.player = p;
    // New people join the tail of the biggest snake
    const s = this.biggest();
    if (s) { const t = s.members[s.members.length - 1]; p.x = t.x + rand(-2, 2); p.y = t.y + rand(-2, 2); s.members.push(p); }
    else this.spawnLine([p], rand(-200, 200), rand(-200, 200), rand(0, TAU));
    this.send(c, { t: 'you', pid: p.pid });
    this.broadcastJson({ t: 'prof', l: [this.profileRow(p)] });
  }

  open(c, m) {
    const p = this.players.get(Number(m.pid));
    if (!c.player || !p || p.bot || !p.handle || p === c.player || c.opened.has(p.pid)) return;
    c.opened.add(p.pid); // one count per viewer per profile
    if (p.client) this.send(p.client, { t: 'opened', n: 1 });
  }

  profileRow(p) { return [p.pid, p.handle, p.platform, p.img ? 1 : 0]; }
  avatarOf(pid) { const p = this.players.get(pid); return p && p.img; }

  event(e) { this.events.push(e); }

  send(c, obj) { this.sendRaw(c, JSON.stringify(obj)); }
  sendRaw(c, str) { if (c.ws.readyState === OPEN) c.ws.send(str); }
  broadcastJson(obj) { const s = JSON.stringify(obj); for (const c of this.clients) this.sendRaw(c, s); }

  broadcast() {
    if (this.events.length) { this.broadcastJson({ t: 'ev', l: this.events }); this.events = []; }
    const buf = this.encode();
    for (const c of this.clients) {
      // Slow connections skip frames instead of stalling the loop
      if (c.ws.readyState === OPEN && c.ws.bufferedAmount < 1 << 20) c.ws.send(buf);
    }
  }

  // Binary state, little-endian:
  //   u8 type=1 | f64 serverTime | u16 arenaR | u16 humans | u8 boltCount | (i16 x, i16 y)*bolts | u16 snakeCount
  //   per snake: u16 id | u16 len | u16 leadLeft(10ms units) | u8 flags(bit0 boost) | u8 turn | i16 angle*5000
  //   per seg:   i16 x | i16 y | u32 pid
  encode() {
    let segs = 0; for (const s of this.snakes) segs += s.members.length;
    const nb = Math.min(255, this.bolts.length);
    const buf = Buffer.allocUnsafe(16 + nb * 4 + this.snakes.length * 10 + segs * 8);
    const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
    let o = 0;
    o = buf.writeUInt8(1, o); o = buf.writeDoubleLE(this.now, o);
    o = buf.writeUInt16LE(Math.min(65535, Math.round(this.arenaR)), o); o = buf.writeUInt16LE(Math.min(65535, this.humans), o);
    o = buf.writeUInt8(nb, o);
    for (let i = 0; i < nb; i++) { o = buf.writeInt16LE(i16(this.bolts[i].x), o); o = buf.writeInt16LE(i16(this.bolts[i].y), o); }
    o = buf.writeUInt16LE(this.snakes.length, o);
    for (const s of this.snakes) {
      const left = Math.max(0, CFG.LEAD_MS - (this.now - s.leaderSince));
      o = buf.writeUInt16LE(s.id, o); o = buf.writeUInt16LE(s.members.length, o);
      o = buf.writeUInt16LE(Math.min(65535, Math.ceil(left / 10)), o);
      o = buf.writeUInt8(this.now < s.boostUntil ? 1 : 0, o); o = buf.writeUInt8(s.turn, o);
      const a = Math.atan2(Math.sin(s.members[0].angle), Math.cos(s.members[0].angle));
      o = buf.writeInt16LE(Math.round(a * 5000), o);
      for (const p of s.members) { o = buf.writeInt16LE(i16(p.x), o); o = buf.writeInt16LE(i16(p.y), o); o = buf.writeUInt32LE(p.pid, o); }
    }
    return buf;
  }

  health() {
    return { ok: true, humans: this.humans, bots: this.bots, snakes: this.snakes.length, clients: this.clients.size, tickAvgMs: +this.perf.avg.toFixed(2), tickPeakMs: +this.perf.peak.toFixed(2) };
  }

  stop() { clearInterval(this.timer); clearInterval(this.pinger); }
}

module.exports = { Game, CFG, BOT_BASE };
