'use strict';
// Authoritative simulation for plsfollow.me. One room, one loop, everyone gets the same state buffer.
const crypto = require('crypto');
const { Fame } = require('./fame');
const { House } = require('./house');

const CFG = {
  TICK_MS: 50,
  LEAD_MS: 30000, // every head leads for exactly this long
  RACE_MS: 10000, // the last part of a turn is the race for next head
  SPEED: 190, TURN: 4.6, SPACING: 34, HIT: 30, SELF_SKIP: 4, // a head can bite its own body from the 5th segment back // tails are ~80% of the head's size
  TURN_HUMAN: 6.2, // players turn a bit faster than the bots (TURN)
  KNOCK_SPEED: 520, KNOCK_STUN_MS: 450, // getting your tail stolen shoves your head away
  SOLO_MS: 30000, BUMP_COST_MS: 5000, // a head with no tail has 30s to get one; head bumps between two of them cost 5s each
  GRACE_MS: 1500, STEAL_GRACE_MS: 800,
  BOOST_MS: 3000, BOOST: 1.6, BOLT_HIT: 32,
  // Eight trolls wander the map at random, keeping apart. Head bump: the leader loses time.
  // Body hit: the snake breaks. A head with no tail gets knocked out.
  TROLL_COUNT: 8, TROLL_APART: 0.45, // keep at least this fraction of the arena radius between trolls
  CHAT_MAX: 80, CHAT_GAP_MS: 1200,
  TROLL_SPEED: 90, TROLL_TURN: 2,
  TROLL_HEAD_HIT: 36, TROLL_BODY_HIT: 31, TROLL_COOL_MS: 4000, TROLL_TIME_COST_MS: 5000,
  AUTOPILOT_MS: 1000, AFK_MS: 8000,
  TAP_RATE: 13, TAP_BURST: 5, // tap race: at most ~13 taps a second count (a fast human; autoclickers get no edge)
  SOLO_SPAWN_CHANCE: 0.1, // a new player sometimes starts as their own lone head instead of joining a tail
};
const PLATFORMS = new Set(['ig', 'tt', 'x', 'th', 'yt', 'tw']);
const HANDLE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const BANNED_RE = /(n[i1]gg|f[a@4]gg|r[a@4]pist|nazi|hitler|kys|cunt|whore|pedo)/i;
const MAX_IMG_B64 = 48000;

// Fail fast if a setting above is missing or mistyped (a stray comment once swallowed a few of them)
for (const [k, v] of Object.entries(CFG)) if (!Number.isFinite(v)) throw new Error(`CFG.${k} is not a number: ${v}`);
for (const k of ['SPACING', 'HIT', 'SELF_SKIP', 'TURN', 'TURN_HUMAN', 'SPEED', 'SOLO_MS']) if (!(k in CFG)) throw new Error(`CFG.${k} is missing`);

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
    this.trolls = [];
    this.pidSeq = 1; this.sidSeq = 1;
    this.humans = 0;
    this.arenaR = this.radiusFor(0);
    this.perf = { sum: 0, n: 0, max: 0, avg: 0, peak: 0 };
    this.fame = new Fame(process.env.DATA_DIR);
    this.house = new House(this);
    this.fameSent = -1;
    this.fameTimer = setInterval(() => this.flushFame(), 5000);
    this.timer = setInterval(() => this.tick(), CFG.TICK_MS);
    this.pinger = setInterval(() => this.ping(), 2000);
  }

  radiusFor(n) { return 850 + 45 * Math.sqrt(n); }

  // ---------- Players and snakes ----------
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
  active(p) { return this.now - p.lastInput < CFG.AFK_MS; }

  promote(s) {
    const h = s.members[0], n = s.members[1];
    if (n) h.angle = Math.atan2(h.y - n.y, h.x - n.x);
    h.target = h.angle;
    s.leaderSince = this.now; s.boostUntil = 0; s.turn = (s.turn + 1) & 255;
    s.path = null; // new head: the trail starts again from the body as it is now
    // Leading real people counts toward the hall of fame
    if (h.handle && s.members.length > 1) this.fame.led(h.handle, h.platform, s.members.length);
    // The tap race runs for the whole turn: everyone behind the head can tap, including people who
    // arrive mid-turn (they start from zero). Counts reset with every new leader.
    s.race = { entries: new Map(), dirty: true };
  }

  endTurn(s, why) {
    const m = s.members, old = m[0];
    if (m.length < 2) { this.promote(s); return; }
    const win = this.raceWinner(s);
    m.shift(); m.push(old);
    // Race winner leads. Otherwise the next active person in line.
    let next = win ? win.p : m.find(p => this.active(p)) || m[0];
    if (next !== m[0]) { m.splice(m.indexOf(next), 1); m.unshift(next); }
    this.promote(s);
    this.event({ k: 'turn', sid: s.id, head: m[0].pid, prev: old.pid, taps: win ? win.n : 0, why });
  }

  // Most taps wins; a tie goes to whoever got there first
  raceWinner(s) {
    let best = null;
    for (const e of s.race.entries.values()) {
      if (e.n > 0 && (!best || e.n > best.n || (e.n === best.n && e.at < best.at)) && e.p !== s.members[0] && s.members.includes(e.p)) best = e;
    }
    return best;
  }

  removePlayer(p) {
    this.players.delete(p.pid);
    if (!p.bot) this.humans--;
    const s = this.snakeOf(p); if (!s) return;
    const i = s.members.indexOf(p);
    s.members.splice(i, 1);
    if (!s.members.length) { this.snakes.splice(this.snakes.indexOf(s), 1); return; }
    if (i === 0) { this.promote(s); this.event({ k: 'turn', sid: s.id, head: s.members[0].pid, prev: p.pid, ms: 0, why: 'left' }); }
  }

  // ---------- Heads with no tail ----------
  // A lone head has SOLO_MS to get a tail (steal some, or win a head-on with a bigger snake). The clock
  // pauses while nobody else is in the arena, since there'd be no one to get a tail from.
  soloClock(s) {
    const h = s.members[0];
    if (!s.soloSince) { s.soloSince = this.now; s.leaderSince = this.now; s.bumpedBy = 0; }
    if (this.snakes.length < 2) { s.leaderSince = this.now; return; }
    if (this.now - s.leaderSince < CFG.SOLO_MS) return;
    // Out of time. If another player bumped you this time around, you join their tail instead.
    const by = s.bumpedBy && this.players.get(s.bumpedBy), bs = by && this.snakeOf(by);
    if (bs && bs !== s) {
      s.members.length = 0; this.snakes.splice(this.snakes.indexOf(s), 1);
      const t = bs.members[bs.members.length - 1];
      h.x = t.x; h.y = t.y; bs.members.push(h);
      bs.grace = Math.max(bs.grace, this.now + CFG.STEAL_GRACE_MS);
      this.event({ k: 'absorb', victim: h.pid, by: by.pid, sid: bs.id, x: Math.round(h.x), y: Math.round(h.y) });
    } else {
      this.event({ k: 'out', sid: s.id, pid: h.pid, x: Math.round(h.x), y: Math.round(h.y) });
      this.eliminate(h, 'time');
    }
  }

  // Two heads with no tails bump: both lose time and bounce apart
  bump(s, t) {
    const a = s.members[0], b = t.members[0];
    for (const [me, other] of [[s, b], [t, a]]) {
      if (!me.soloSince) { me.soloSince = this.now; }
      me.leaderSince -= CFG.BUMP_COST_MS; me.bumpedBy = other.pid;
      me.grace = this.now + CFG.GRACE_MS;
    }
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    a.angle = a.target = ang + Math.PI; b.angle = b.target = ang;
    a.x -= Math.cos(ang) * 12; a.y -= Math.sin(ang) * 12; b.x += Math.cos(ang) * 12; b.y += Math.sin(ang) * 12;
    a.lastSteer = b.lastSteer = this.now - CFG.AUTOPILOT_MS + 400; // a short moment before steering takes over again
    this.event({ k: 'bump', a: a.pid, b: b.pid, ms: CFG.BUMP_COST_MS, x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    // Whoever this pushed past zero joins the other's tail; if both, the one with less time left does
    const left = x => CFG.SOLO_MS - (this.now - x.leaderSince);
    const out = [s, t].filter(x => left(x) <= 0).sort((x, y) => left(x) - left(y));
    if (out.length) out[0].leaderSince = this.now - CFG.SOLO_MS; // settles on the next tick via soloClock
    if (out.length === 2) out[1].leaderSince = this.now - CFG.SOLO_MS + 1500; // survives just long enough to receive the other
  }

  // ---------- Trolls ----------
  spawnTroll() {
    // The spot farthest from the other trolls and from every head
    let best = null;
    for (let tries = 0; tries < 24; tries++) {
      const a = rand(0, TAU), r = rand(0.35, 0.75) * this.arenaR, x = Math.cos(a) * r, y = Math.sin(a) * r;
      const d = Math.min(Infinity,
        ...this.trolls.map(t => Math.hypot(t.x - x, t.y - y)),
        ...this.snakes.map(s => Math.hypot(s.members[0].x - x, s.members[0].y - y) * 1.5));
      if (!best || d > best.d) best = { x, y, d };
    }
    return { x: best.x, y: best.y, angle: rand(0, TAU), wob: 0, coolUntil: this.now + 1500 };
  }

  balanceTrolls() {
    while (this.trolls.length < CFG.TROLL_COUNT) this.trolls.push(this.spawnTroll());
    if (this.trolls.length > CFG.TROLL_COUNT) this.trolls.length = CFG.TROLL_COUNT;
  }

  moveTrolls(dt) {
    const apart = this.arenaR * CFG.TROLL_APART;
    for (const t of this.trolls) {
      // Random wandering; they don't chase anyone
      t.wob = t.wob * 0.97 + (Math.random() - 0.5) * 0.25;
      let want = t.angle + t.wob;
      // Steer away from any troll that gets too close, so they stay spread over the map
      let px = 0, py = 0;
      for (const o of this.trolls) {
        if (o === t) continue;
        const dx = t.x - o.x, dy = t.y - o.y, d = Math.hypot(dx, dy);
        if (d < apart && d > 0) { const w = (apart - d) / apart; px += dx / d * w; py += dy / d * w; }
      }
      if (px || py) want = Math.atan2(py, px);
      if (Math.hypot(t.x, t.y) > this.arenaR * 0.85) want = Math.atan2(-t.y, -t.x);
      let d = want - t.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
      const mt = CFG.TROLL_TURN * dt; t.angle += Math.max(-mt, Math.min(mt, d));
      t.x += Math.cos(t.angle) * CFG.TROLL_SPEED * dt; t.y += Math.sin(t.angle) * CFG.TROLL_SPEED * dt;
    }
  }

  trollHits() {
    for (const t of this.trolls) {
      if (this.now < t.coolUntil) continue;
      for (const s of this.snakes.slice()) {
        if (this.now < s.grace) continue;
        const m = s.members, h = m[0];
        if (Math.hypot(h.x - t.x, h.y - t.y) < CFG.TROLL_HEAD_HIT) {
          t.coolUntil = this.now + CFG.TROLL_COOL_MS;
          if (m.length === 1) {
            // A head with nobody behind it has nothing to protect it: the troll knocks them out
            this.event({ k: 'out', sid: s.id, pid: h.pid, x: Math.round(h.x), y: Math.round(h.y) });
            this.eliminate(h, 'troll');
            break;
          }
          // Head bump: the leader's turn gets shorter, so the race comes sooner
          s.leaderSince -= CFG.TROLL_TIME_COST_MS;
          s.grace = this.now + 600;
          this.event({ k: 'troll', sid: s.id, head: h.pid, ms: CFG.TROLL_TIME_COST_MS, x: Math.round(h.x), y: Math.round(h.y) });
          break;
        }
        let k = -1;
        for (let i = 1; i < m.length; i++) {
          const q = m[i];
          if (Math.abs(q.x - t.x) < CFG.TROLL_BODY_HIT && Math.abs(q.y - t.y) < CFG.TROLL_BODY_HIT && Math.hypot(q.x - t.x, q.y - t.y) < CFG.TROLL_BODY_HIT) { k = i; break; }
        }
        if (k < 0) continue;
        // Body hit: the snake breaks, and everyone from the hit point back becomes a new snake
        const at = m[k], tail = m.splice(k);
        s.grace = this.now + CFG.GRACE_MS;
        const ns = this.makeSnake(tail);
        t.coolUntil = this.now + CFG.TROLL_COOL_MS;
        this.event({ k: 'break', sid: s.id, nsid: ns.id, k2: k, n: tail.length, x: Math.round(at.x), y: Math.round(at.y) });
        break;
      }
    }
  }

  // ---------- Loop ----------
  tick() {
    const t0 = process.hrtime.bigint();
    const prev = this.now; this.now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (this.now - prev) / 1000));
    this.balanceTrolls();
    this.house.tick();
    let segs = 0; for (const s of this.snakes) segs += s.members.length;
    this.arenaR += (this.radiusFor(segs) - this.arenaR) * 0.01;
    const wantBolts = Math.min(33, 9 + Math.floor(Math.sqrt(segs))); // ⚡ boosts on the map
    while (this.bolts.length < wantBolts) this.bolts.push(this.spawnBolt());
    if (this.bolts.length > wantBolts) this.bolts.length = wantBolts;

    for (const s of this.snakes.slice()) this.leadership(s);
    for (const s of this.snakes) this.purgeRace(s);
    for (const s of this.snakes) this.move(s, dt);
    this.moveTrolls(dt);
    this.collide();
    this.trollHits();
    this.flushRaceBoards();
    this.broadcast();

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const pf = this.perf; pf.sum += ms; pf.n++; pf.max = Math.max(pf.max, ms);
    if (pf.n >= 200) { pf.avg = pf.sum / pf.n; pf.peak = pf.max; pf.sum = pf.n = pf.max = 0; }
  }

  leadership(s) {
    const h = s.members[0];
    if (s.members.length === 1) { this.soloClock(s); return; }
    if (s.soloSince) { s.soloSince = 0; s.bumpedBy = 0; } // got a tail: back to a normal turn
    if (s.members.length > 1 && this.now - h.lastInput > CFG.AFK_MS && s.members.some(p => p !== h && this.active(p))) { this.endTurn(s, 'afk'); return; }
    if (this.now - s.leaderSince >= CFG.LEAD_MS) { this.endTurn(s, 'time'); return; }
  }

  // Anyone who left a snake (stolen, captured, absorbed) loses their taps there; coming back starts at zero
  purgeRace(s) {
    const r = s.race;
    if (!r || !r.entries.size) return;
    const here = new Set(s.members.map(p => p.pid));
    for (const pid of r.entries.keys()) if (!here.has(pid)) { r.entries.delete(pid); r.dirty = true; }
  }

  // Trail following: the snake remembers where its head has been, and every segment rides that
  // trail at a fixed distance behind the head. Tight loops keep the whole body moving along the
  // exact same curve. Segments that just arrived (stolen, joined) glide onto the trail; any segment
  // past the end of the remembered trail falls back to following the one in front of it.
  follow(s, dt) {
    const m = s.members, h = m[0];
    // Trail is stored oldest-first; seeded from the current body when a snake forms or changes head
    if (!s.path) { s.path = []; for (let i = m.length - 1; i >= 0; i--) s.path.push({ x: m[i].x, y: m[i].y }); }
    const P = s.path, last = P[P.length - 1];
    if (!last || Math.hypot(h.x - last.x, h.y - last.y) >= 3) P.push({ x: h.x, y: h.y });
    else { last.x = h.x; last.y = h.y; }
    const glide = CFG.SPEED * 3 * dt, first = CFG.SPACING + 20; // first follower sits further back so the head never hides them
    let j = P.length - 1, acc = 0, px = h.x, py = h.y;
    for (let i = 1; i < m.length; i++) {
      const want = first + (i - 1) * CFG.SPACING, p = m[i];
      while (j >= 0) {
        const q = P[j], seg = Math.hypot(q.x - px, q.y - py);
        if (acc + seg >= want) break;
        acc += seg; px = q.x; py = q.y; j--;
      }
      let tx, ty;
      if (j >= 0) {
        const q = P[j], seg = Math.hypot(q.x - px, q.y - py) || 1, f = (want - acc) / seg;
        tx = px + (q.x - px) * f; ty = py + (q.y - py) * f;
      } else {
        // Off the end of the trail: keep a link's distance from the segment in front
        const a = m[i - 1], dx = a.x - p.x, dy = a.y - p.y, dist = Math.hypot(dx, dy), gap = i === 1 ? first : CFG.SPACING;
        if (dist > gap) { const mv = Math.min(dist - gap, glide); p.x += dx / dist * mv; p.y += dy / dist * mv; }
        continue;
      }
      const dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
      if (dist <= glide) { p.x = tx; p.y = ty; } else { p.x += dx / dist * glide; p.y += dy / dist * glide; }
    }
    // Forget trail older than the body needs
    if (j > 8) P.splice(0, j - 4);
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
    if (h.bot) this.house.steer(s, h);
    else if (this.now - h.lastSteer > CFG.AUTOPILOT_MS) this.wander(h);
    // Keys say "keep turning left/right" (or "go straight"), applied against the live angle here,
    // so network lag can't make the client aim at where the head used to be
    else if (h.steerMode === 'k') h.target = h.angle + h.turnDir * 2;
    if (this.now < (h.stunUntil || 0)) h.target = h.angle; // knocked back: no steering for a moment
    if (h.kx || h.ky) {
      h.x += h.kx * dt; h.y += h.ky * dt;
      const decay = Math.pow(0.004, dt); h.kx *= decay; h.ky *= decay;
      if (Math.hypot(h.kx, h.ky) < 8) h.kx = h.ky = 0;
    }
    let d = h.target - h.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
    const mt = (h.bot ? CFG.TURN : CFG.TURN_HUMAN) * dt; h.angle += Math.max(-mt, Math.min(mt, d));
    h.x += Math.cos(h.angle) * sp * dt; h.y += Math.sin(h.angle) * sp * dt;
    const r = Math.hypot(h.x, h.y);
    if (r > this.arenaR) { h.x *= this.arenaR / r; h.y *= this.arenaR / r; }
    this.follow(s, dt);
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
      } else if (hit.k === 0 && s.members.length === 1 && t.members.length === 1) {
        this.bump(s, t);
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
        // Knockback: the robbed snake's head gets shoved away from the thief and briefly can't steer
        const vh = t.members[0];
        let kx = 0, ky = 0;
        if (vh) {
          let dir = Math.atan2(vh.y - h.y, vh.x - h.x);
          if (Math.hypot(vh.x - h.x, vh.y - h.y) < 1) dir = h.angle + Math.PI / 2;
          kx = Math.cos(dir) * CFG.KNOCK_SPEED; ky = Math.sin(dir) * CFG.KNOCK_SPEED;
          vh.kx = kx; vh.ky = ky; vh.stunUntil = this.now + CFG.KNOCK_STUN_MS;
          vh.angle = vh.target = Math.atan2(Math.sin(vh.angle) + Math.sin(dir), Math.cos(vh.angle) + Math.cos(dir)); // spun toward the shove
          t.grace = Math.max(t.grace, this.now + 600);
        }
        this.event({ k: 'steal', thief: s.id, victim: t.id, k2: hit.k, n: tail.length, x, y, hx: vh ? Math.round(vh.x) : x, hy: vh ? Math.round(vh.y) : y });
      }
    }
    for (let i = this.snakes.length - 1; i >= 0; i--) if (!this.snakes[i].members.length) this.snakes.splice(i, 1);
  }

  // ---------- Race ----------
  // Tap race: clients send how many taps they made since the last message. The server only counts
  // what a human hand could do (a refilling budget of TAP_RATE per second).
  taps(c, m) {
    const p = c.player; if (!p) return;
    const s = this.snakeOf(p);
    if (!s || s.members[0] === p || s.id !== m.sid || s.turn !== m.turn) return;
    const n = Math.floor(Number(m.n));
    if (!Number.isFinite(n) || n < 1) return;
    this.addTaps(p, s, n);
  }

  // Count taps for a racer, within what a human hand could do (a refilling budget of TAP_RATE/s)
  addTaps(p, s, n) {
    const r = s.race;
    let e = r.entries.get(p.pid);
    if (!e) { e = { p, n: 0, at: 0, budget: CFG.TAP_BURST, last: this.now }; r.entries.set(p.pid, e); }
    e.budget = Math.min(CFG.TAP_BURST, e.budget + (this.now - e.last) / 1000 * CFG.TAP_RATE); e.last = this.now;
    const add = Math.min(n, Math.floor(e.budget));
    if (add <= 0) return;
    e.budget -= add; e.n += add; e.at = this.now; r.dirty = true;
  }

  flushRaceBoards() {
    for (const s of this.snakes) {
      const r = s.race; if (!r.dirty || this.now - (r.flushAt || 0) < 200) continue; r.dirty = false; r.flushAt = this.now;
      const top = [...r.entries.values()].filter(e => e.n > 0).sort((a, b) => b.n - a.n || a.at - b.at).slice(0, 3).map(e => [e.p.pid, e.n]);
      const msg = JSON.stringify({ t: 'race', sid: s.id, turn: s.turn, top, n: r.entries.size });
      for (const p of s.members) if (p.client) {
        // each racer also learns their own count as the server sees it
        const e = r.entries.get(p.pid);
        this.sendRaw(p.client, e ? msg.slice(0, -1) + `,"mine":${e.n}}` : msg);
      }
    }
  }

  // ---------- Networking ----------
  connect(ws, ip) {
    const c = { ws, ip: ip || '?', player: null, rtt: 300, pingAt: 0, alive: true, opened: new Set(), bucket: 40, bucketAt: Date.now() };
    this.clients.add(c);
    this.send(c, { t: 'hello', boot: this.boot, now: Date.now(), cfg: { LEAD_MS: CFG.LEAD_MS, RACE_MS: CFG.RACE_MS, TICK_MS: CFG.TICK_MS } });
    const l = []; for (const p of this.players.values()) l.push(this.profileRow(p));
    if (l.length) this.send(c, { t: 'prof', l });
    this.send(c, { t: 'fame', day: this.fame.day, top: this.fame.top() });
    ws.on('pong', () => { c.alive = true; if (c.pingAt) c.rtt = Date.now() - c.pingAt; });
    return c;
  }

  // Knocked out of the game: back to the main screen, free to join again on the same connection
  eliminate(p, why) {
    const c = p.client;
    this.removePlayer(p);
    this.broadcastJson({ t: 'bye', pid: p.pid });
    if (c) { c.player = null; p.client = null; this.send(c, { t: 'out', why }); }
  }

  // Somewhere away from the trolls, for a player who starts a brand-new snake
  safeSpot() {
    let best = null;
    for (let i = 0; i < 12; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * this.arenaR * 0.6, x = Math.cos(a) * r, y = Math.sin(a) * r;
      const d = Math.min(Infinity, ...this.trolls.map(t => Math.hypot(t.x - x, t.y - y)));
      if (!best || d > best.d) best = { x, y, d };
    }
    return best;
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
        if (p && Number.isFinite(a)) { p.target = a; p.steerMode = 'a'; p.lastSteer = this.now; }
        return;
      }
      case 'k': {
        const p = c.player, d = Number(m.d);
        if (p && (d === -1 || d === 0 || d === 1)) { p.turnDir = d; p.steerMode = 'k'; p.lastSteer = this.now; }
        return;
      }
      case 'taps': return this.taps(c, m);
      case 'open': return this.open(c, m);
      case 'fameOpen': return this.fameOpen(c, m);
      case 'chat': return this.chat(c, m);
      case 'sync': return this.send(c, { t: 'sync', c: Number(m.c) || 0, s: Date.now() });
      default: return; // 'hb' and unknown messages only count as activity
    }
  }

  join(c, m) {
    if (c.player) return;
    let handle = typeof m.handle === 'string' ? m.handle.trim().replace(/^@+/, '') : '';
    if (handle && (!HANDLE_RE.test(handle) || BANNED_RE.test(handle))) return this.send(c, { t: 'err', msg: "That handle can't be used. Letters, numbers, . _ and - only." });
    if (this.house.isReserved(handle)) return this.send(c, { t: 'err', msg: `@${handle} is one of the hosts. Please use your own handle.` });
    const platform = PLATFORMS.has(m.platform) ? m.platform : 'ig';
    let img = null;
    if (typeof m.img === 'string' && m.img.length <= MAX_IMG_B64) {
      const buf = Buffer.from(m.img, 'base64');
      if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) img = buf; // JPEG only
    }
    // Optional: join the snake a friend is in, by their handle
    let friendSnake = null;
    if (typeof m.follow === 'string' && m.follow.trim()) {
      const want = m.follow.trim().replace(/^@+/, '').toLowerCase();
      const friend = HANDLE_RE.test(want) && [...this.players.values()].find(q => q.handle && q.handle.toLowerCase() === want);
      friendSnake = friend && this.snakeOf(friend);
      if (!friendSnake) return this.send(c, { t: 'err', code: 'nofriend', msg: `@${want.slice(0, 30)} isn't in the arena right now. Clear the box to join the biggest snake.` });
    }
    const p = { pid: this.pidSeq++, handle: handle || null, platform, img, client: c, x: 0, y: 0, angle: 0, target: 0, wob: 0, lastInput: this.now, lastSteer: 0 };
    this.players.set(p.pid, p); this.humans++;
    c.player = p;
    // New people join the tail of the biggest snake. Nobody here yet: you start your own and lead it.
    // Usually the tail of the biggest snake; sometimes (and always if there's nobody) a fresh lone head
    const s = friendSnake || (Math.random() < CFG.SOLO_SPAWN_CHANCE ? null : this.biggest());
    if (s) { const t = s.members[s.members.length - 1]; p.x = t.x + rand(-2, 2); p.y = t.y + rand(-2, 2); s.members.push(p); }
    else { const at = this.safeSpot(); this.spawnLine([p], at.x, at.y, Math.atan2(-at.y, -at.x)); }
    p.lastSteer = this.now; // a fresh head keeps going straight until the first steering message
    this.send(c, { t: 'you', pid: p.pid });
    this.house.onJoin(p, this.snakeOf(p));
    this.broadcastJson({ t: 'prof', l: [this.profileRow(p)] });
  }

  chat(c, m) {
    const p = c.player;
    if (!p || typeof m.text !== 'string' || this.now - (c.lastChat || 0) < CFG.CHAT_GAP_MS) return;
    // Printable text only, one line, trimmed; banned words are starred out
    let text = m.text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, CFG.CHAT_MAX);
    if (!text) return;
    text = text.replace(new RegExp(BANNED_RE.source, 'gi'), w => '*'.repeat(w.length));
    c.lastChat = this.now;
    this.broadcastJson({ t: 'chat', pid: p.pid, text });
  }

  open(c, m) {
    const p = this.players.get(Number(m.pid));
    if (!c.player || !p || !p.handle || p === c.player || c.opened.has(p.pid)) return;
    c.opened.add(p.pid); // one count per viewer per profile
    if (p.client) this.send(p.client, { t: 'opened', n: 1 });
    this.fame.open(p.handle, p.platform, c.ip);
  }

  // Someone tapped a profile on the hall of fame list
  fameOpen(c, m) {
    const handle = typeof m.handle === 'string' ? m.handle : '', platform = m.platform;
    if (!HANDLE_RE.test(handle) || !PLATFORMS.has(platform) || !this.fame.has(handle, platform)) return;
    if (c.player && c.player.handle && c.player.handle.toLowerCase() === handle.toLowerCase()) return;
    this.fame.open(handle, platform, c.ip);
  }

  // Send the board when it changes (at most every 5s) and save it to disk
  flushFame() {
    this.fame.rollover();
    if (this.fame.version !== this.fameSent) {
      this.fameSent = this.fame.version;
      this.broadcastJson({ t: 'fame', day: this.fame.day, top: this.fame.top() });
    }
    this.fame.save();
  }

  hostCount() { let n = 0; for (const sl of this.house.slots) if (sl.player) n++; return n; }
  profileRow(p) { return [p.pid, p.handle, p.platform, p.img ? 1 : 0, p.bot ? 1 : 0]; }
  avatarOf(pid) { const p = this.players.get(pid); return p && p.img; }

  event(e) { this.events.push(e); if (this.house) this.house.onEvent(e); }

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
  //   u8 type=1 | f64 serverTime | u16 arenaR | u16 online (players + hosts) | u8 boltCount | (i16 x, i16 y)*bolts
  //   u8 trollCount | (i16 x, i16 y, u8 angle(0-255), u8 flags(bit0 cooling))*trolls | u16 snakeCount
  //   per snake: u16 id | u16 len | u16 leadLeft(10ms units) | u8 flags(bit0 boost) | u8 turn | i16 angle*5000
  //   per seg:   i16 x | i16 y | u32 pid
  encode() {
    let segs = 0; for (const s of this.snakes) segs += s.members.length;
    const nb = Math.min(255, this.bolts.length);
    const nt = Math.min(255, this.trolls.length);
    const buf = Buffer.allocUnsafe(17 + nb * 4 + nt * 6 + this.snakes.length * 10 + segs * 8);
    const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
    let o = 0;
    o = buf.writeUInt8(1, o); o = buf.writeDoubleLE(this.now, o);
    o = buf.writeUInt16LE(Math.min(65535, Math.round(this.arenaR)), o); o = buf.writeUInt16LE(Math.min(65535, this.humans + this.hostCount()), o); // online count includes the hosts
    o = buf.writeUInt8(nb, o);
    for (let i = 0; i < nb; i++) { o = buf.writeInt16LE(i16(this.bolts[i].x), o); o = buf.writeInt16LE(i16(this.bolts[i].y), o); }
    o = buf.writeUInt8(nt, o);
    for (let i = 0; i < nt; i++) {
      const t = this.trolls[i], a = ((t.angle % TAU) + TAU) % TAU;
      o = buf.writeInt16LE(i16(t.x), o); o = buf.writeInt16LE(i16(t.y), o);
      o = buf.writeUInt8(Math.round(a / TAU * 255) & 255, o); o = buf.writeUInt8(this.now < t.coolUntil ? 1 : 0, o);
    }
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
    return { ok: true, humans: this.humans, hosts: this.hostCount(), trolls: this.trolls.length, snakes: this.snakes.length, clients: this.clients.size, tickAvgMs: +this.perf.avg.toFixed(2), tickPeakMs: +this.perf.peak.toFixed(2) };
  }

  stop() { clearInterval(this.timer); clearInterval(this.pinger); clearInterval(this.fameTimer); this.fame.dirty = true; this.fame.save(); }
}

module.exports = { Game, CFG };
