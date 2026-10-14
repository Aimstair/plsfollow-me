'use strict';
// THE ALGORITHM: a boss that drops into the center of the arena, attacks for 2 minutes, then leaves for
// 3. Every attack is telegraphed first. Players fight back by touching 🌱 grass, which cuts its time.
// The server decides every hit; clients draw the same attacks from the shapes and times sent here.

const B = {
  FIRST_MS: Number(process.env.BOSS_FIRST_MS) || 60000, // first landing this long after the server starts (plus the warning)
  WARN_MS: 8000,          // siren + growing shadow before it lands
  STAY_MS: 120000,        // time on the map
  ENRAGE_MS: 30000,       // last part of the stay: faster attacks, Doomscroll
  LEAVE_MS: 2500,         // rise/explode animation
  COOLDOWN_MS: 180000,    // break after it leaves before the next warning
  BODY_R: 120,
  SLAM_R: 350,
  HEAD_COST_MS: 5000, STUN_MS: 800, KNOCK: 520, HIT_GRACE_MS: 1500,
  SEG_R: 16, HEAD_R: 21,
  GRASS_EVERY_MS: 5000, GRASS_MAX: 4, GRASS_LIFE_MS: 15000, GRASS_CUT_MS: 6000, GRASS_HIT: 34,
  LOOT_BOLTS: 8, DOWN_CUT_MS: 30000, // players who cut this much time off it log it off
};
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// Distance from point to segment
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

class Boss {
  constructor(game) {
    this.g = game;
    this.phase = 'idle';
    this.nextAt = Date.now() + B.FIRST_MS;
    this.attacks = []; this.grass = [];
    this.seq = 1; this.lastType = ''; this.nextAttackAt = 0; this.nextGrassAt = 0;
    this.landAt = 0; this.endsAt = 0; this.leaveAt = 0; this.outcome = ''; this.lastGrassBy = 0; this.cut = 0;
  }

  get present() { return this.phase === 'landing' || this.phase === 'active'; }
  get enraged() { return this.phase === 'active' && this.endsAt - this.g.now <= B.ENRAGE_MS; }

  // ---------- State sent to clients ----------
  snapshot() {
    const now = this.g.now;
    return {
      t: 'boss', phase: this.phase, now, landAt: this.landAt, endsAt: this.endsAt, leaveAt: this.leaveAt, nextAt: this.nextAt,
      outcome: this.outcome, by: this.lastGrassBy, enraged: this.enraged, cut: this.cut, need: B.DOWN_CUT_MS,
      grass: this.grass.map(g => [g.id, Math.round(g.x), Math.round(g.y), g.until]),
      attacks: this.attacks.filter(a => a.t2 > now).map(a => a.wire),
    };
  }
  push() { this.g.broadcastJson(this.snapshot()); }

  // ---------- Loop ----------
  tick() {
    const g = this.g, now = g.now;
    if (this.phase === 'idle') {
      if (now >= this.nextAt) { this.phase = 'warning'; this.landAt = now + B.WARN_MS; this.outcome = ''; this.push(); this.g.house.onBoss('warning'); }
      return;
    }
    if (this.phase === 'warning') {
      if (now >= this.landAt) {
        this.phase = 'active'; this.endsAt = now + B.STAY_MS; this.cut = 0; this.lastGrassBy = 0;
        this.nextAttackAt = now + 3500; this.nextGrassAt = now + 2500;
        this.addAttack({ type: 'slam', t0: now - 1, t1: now, t2: now + 450, r: B.SLAM_R });
        this.push();
      }
      return;
    }
    if (this.phase === 'leaving') {
      if (now >= this.leaveAt) { this.phase = 'idle'; this.nextAt = now + B.COOLDOWN_MS; this.attacks = []; this.grass = []; this.push(); }
      return;
    }
    // active
    if (now >= this.endsAt) return this.leave(this.cut >= B.DOWN_CUT_MS ? 'down' : 'bored');
    if (now >= this.nextAttackAt) this.chooseAttack();
    let changed = false;
    if (now >= this.nextGrassAt) { this.nextGrassAt = now + (this.enraged ? B.GRASS_EVERY_MS * 0.6 : B.GRASS_EVERY_MS); if (this.grass.length < B.GRASS_MAX) { this.spawnGrass(); changed = true; } }
    const before = this.grass.length;
    this.grass = this.grass.filter(gr => gr.until > now);
    if (this.grass.length !== before) changed = true;
    this.attacks = this.attacks.filter(a => a.t2 > now - 500);
    this.applyAttacks();
    this.contact();
    if (this.collectGrass()) changed = true;
    if (changed && this.phase === 'active') this.push();
  }

  leave(outcome) {
    const g = this.g;
    this.phase = 'leaving'; this.outcome = outcome; this.leaveAt = g.now + B.LEAVE_MS; this.attacks = []; this.grass = [];
    if (outcome === 'down') {
      // Logged off: a shower of ⚡ boosts spills out of the center
      g.bonusBolts = B.LOOT_BOLTS; g.bonusBoltsUntil = g.now + 45000;
      for (let i = 0; i < B.LOOT_BOLTS; i++) { const a = i / B.LOOT_BOLTS * TAU + rand(-.2, .2), r = rand(160, 420); g.bolts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
    }
    this.push();
    g.house.onBoss(outcome === 'down' ? 'down' : 'left');
  }

  // ---------- Attacks ----------
  addAttack(a) {
    a.id = this.seq++; a.hit = new Set();
    // What clients need to draw it (no server-only fields)
    const { hit, ...wire } = a; a.wire = wire;
    this.attacks.push(a);
    this.g.broadcastJson({ t: 'bossAtk', a: wire });
    return a;
  }

  chooseAttack() {
    const now = this.g.now, enr = this.enraged;
    this.nextAttackAt = now + (enr ? rand(2000, 3000) : rand(4000, 6000));
    const pool = enr ? ['beam', 'stomp', 'rain', 'doom'] : ['beam', 'stomp', 'rain'];
    let type; do { type = pool[Math.floor(Math.random() * pool.length)]; } while (type === this.lastType && pool.length > 1);
    this.lastType = type;
    if (type === 'beam') {
      const tele = 1300, dur = 2200, count = enr ? 3 : 1 + Math.floor(Math.random() * 2);
      this.addAttack({ type, t0: now, t1: now + tele, t2: now + tele + dur, count, a0: rand(0, TAU), sweep: (Math.random() < .5 ? -1 : 1) * rand(Math.PI / 2, Math.PI * 2 / 3), len: 900, w: 36 });
    } else if (type === 'stomp') {
      const tele = 1200, n = enr ? 6 : 4 + Math.floor(Math.random() * 2), lines = [];
      for (let i = 0; i < n; i++) {
        const base = i / n * TAU + rand(-.25, .25), pts = [];
        for (let r = B.BODY_R; r <= 820; r += 100) { const a = base + rand(-.12, .12); pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
        lines.push(pts);
      }
      const ringAt = now + tele + 650, speed = 420, reach = this.g.arenaR + 60;
      const gaps = []; for (let i = 0, k = enr ? 1 : 2; i < k; i++) gaps.push([rand(0, TAU), 0.42]);
      this.addAttack({ type, t0: now, t1: now + tele, t2: ringAt + (reach - B.BODY_R) / speed * 1000, lines, step: 140, ringAt, speed, r0: B.BODY_R, gaps, ringW: 40 });
    } else if (type === 'rain') {
      // Aim ahead of the heads of the biggest snakes and leaders
      const tele = 1500, snakes = this.g.snakes.slice().sort((a, b) => b.members.length - a.members.length);
      const circles = [];
      for (const s of snakes) {
        if (circles.length >= 10) break;
        const h = s.members[0], lead = 1.5 * 190, ang = h.angle;
        const shots = s.members.length > 4 ? 2 : 1;
        for (let i = 0; i < shots && circles.length < 10; i++) circles.push([Math.round(h.x + Math.cos(ang) * lead * rand(.6, 1.1) + rand(-40, 40)), Math.round(h.y + Math.sin(ang) * lead * rand(.6, 1.1) + rand(-40, 40))]);
      }
      while (circles.length < 3) { const a = rand(0, TAU), r = rand(200, this.g.arenaR * .8); circles.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
      this.addAttack({ type, t0: now, t1: now + tele, t2: now + tele + 260, circles, r: 70 });
    } else {
      this.addAttack({ type: 'doom', t0: now, t1: now + 900, t2: now + 3900, pull: 115 });
    }
  }

  // Does this attack hit point (x,y) with radius rr right now?
  hits(a, x, y, rr, isHead = true) {
    const now = this.g.now;
    if (now < a.t1 || now > a.t2) return false;
    if (a.type === 'slam') return Math.hypot(x, y) < a.r + rr;
    if (a.type === 'beam') {
      const f = (now - a.t1) / (a.t2 - a.t1);
      for (let i = 0; i < a.count; i++) {
        const ang = a.a0 + i * TAU / a.count + a.sweep * f;
        if (segDist(x, y, Math.cos(ang) * B.BODY_R * .6, Math.sin(ang) * B.BODY_R * .6, Math.cos(ang) * a.len, Math.sin(ang) * a.len) < a.w / 2 + rr) return true;
      }
      return false;
    }
    if (a.type === 'stomp') {
      // Fractures erupt one after another, each live for 450ms
      for (let i = 0; i < a.lines.length; i++) {
        const s = a.t1 + i * a.step; if (now < s || now > s + 450) continue;
        const pts = a.lines[i];
        for (let j = 1; j < pts.length; j++) if (segDist(x, y, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) < 22 + rr) return true;
      }
      if (isHead && now >= a.ringAt) { // the shockwave ring only knocks heads around; fractures split bodies
        const R = a.r0 + (now - a.ringAt) / 1000 * a.speed, d = Math.hypot(x, y);
        if (Math.abs(d - R) < a.ringW / 2 + rr) {
          const ang = Math.atan2(y, x);
          if (!a.gaps.some(([ga, hw]) => angDiff(ang, ga) < hw)) return true;
        }
      }
      return false;
    }
    if (a.type === 'rain') return a.circles.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < a.r + rr);
    return false;
  }

  applyAttacks() {
    const g = this.g, dt = 0.05;
    for (const a of this.attacks) {
      if (g.now < a.t1 || g.now > a.t2) continue;
      if (a.type === 'doom') {
        // Doomscroll: every head is dragged toward the center
        for (const s of g.snakes) { const h = s.members[0], d = Math.hypot(h.x, h.y) || 1; h.x -= h.x / d * a.pull * dt; h.y -= h.y / d * a.pull * dt; }
        continue;
      }
      for (const s of g.snakes.slice()) {
        if (a.hit.has(s.id) || g.now < (s.bossGrace || 0)) continue;
        const m = s.members;
        if (this.hits(a, m[0].x, m[0].y, B.HEAD_R)) { a.hit.add(s.id); this.hitHead(s, a, m[0].x, m[0].y); continue; }
        for (let k = 1; k < m.length; k++) {
          if (this.hits(a, m[k].x, m[k].y, B.SEG_R, false)) { a.hit.add(s.id); this.hitBody(s, k, a); break; }
        }
      }
    }
  }

  // Bumping the boss itself
  contact() {
    const g = this.g, reach = B.BODY_R + B.HEAD_R;
    for (const s of g.snakes.slice()) {
      if (g.now < (s.bossGrace || 0)) continue;
      const m = s.members;
      if (Math.hypot(m[0].x, m[0].y) < reach) { this.hitHead(s, { type: 'body' }, 0, 0); continue; }
      for (let k = 1; k < m.length; k++) if (Math.hypot(m[k].x, m[k].y) < B.BODY_R + B.SEG_R) { this.hitBody(s, k, { type: 'body' }); break; }
    }
  }

  hitHead(s, a, ox, oy) {
    const g = this.g, h = s.members[0];
    s.bossGrace = g.now + B.HIT_GRACE_MS;
    // Shoved away from where the hit came from (the center for slam/contact/fractures)
    let dx = h.x - ox, dy = h.y - oy;
    if (a.type === 'beam' || a.type === 'stomp' || a.type === 'slam' || a.type === 'body' || !Math.hypot(dx, dy)) { dx = h.x; dy = h.y; }
    if (a.type === 'rain') { const c = a.circles.reduce((b, c) => (Math.hypot(h.x - c[0], h.y - c[1]) < Math.hypot(h.x - b[0], h.y - b[1]) ? c : b)); dx = h.x - c[0]; dy = h.y - c[1]; }
    const d = Math.hypot(dx, dy) || 1;
    h.kx = dx / d * B.KNOCK; h.ky = dy / d * B.KNOCK; h.stunUntil = g.now + B.STUN_MS;
    s.leaderSince -= B.HEAD_COST_MS; // turn time, or the no-tail survival timer for a lone head
    g.event({ k: 'bossHit', sid: s.id, pid: h.pid, atk: a.type, head: 1, x: Math.round(h.x), y: Math.round(h.y) });
  }

  hitBody(s, k, a) {
    const g = this.g, m = s.members, at = m[k];
    s.bossGrace = g.now + B.HIT_GRACE_MS;
    const tail = m.splice(k);
    s.grace = Math.max(s.grace, g.now + 1500);
    const ns = g.makeSnake(tail); ns.bossGrace = g.now + B.HIT_GRACE_MS;
    g.event({ k: 'bossHit', sid: s.id, nsid: ns.id, k2: k, n: tail.length, atk: a.type, x: Math.round(at.x), y: Math.round(at.y) });
  }

  // ---------- Touch grass ----------
  spawnGrass() {
    const g = this.g;
    let best = null;
    for (let i = 0; i < 8; i++) {
      const a = rand(0, TAU), r = rand(250, Math.min(700, g.arenaR * .85)), x = Math.cos(a) * r, y = Math.sin(a) * r;
      const d = Math.min(Infinity, ...this.grass.map(o => Math.hypot(o.x - x, o.y - y)));
      if (!best || d > best.d) best = { x, y, d };
    }
    this.grass.push({ id: this.seq++, x: best.x, y: best.y, until: g.now + B.GRASS_LIFE_MS });
  }

  collectGrass() {
    const g = this.g; let took = false;
    for (const s of g.snakes) {
      const h = s.members[0];
      for (let i = this.grass.length - 1; i >= 0; i--) {
        const gr = this.grass[i];
        if (Math.hypot(h.x - gr.x, h.y - gr.y) > B.GRASS_HIT) continue;
        this.grass.splice(i, 1); took = true;
        this.endsAt -= B.GRASS_CUT_MS; this.cut += B.GRASS_CUT_MS; this.lastGrassBy = h.pid;
        g.event({ k: 'grass', pid: h.pid, x: Math.round(gr.x), y: Math.round(gr.y), endsAt: this.endsAt, cut: B.GRASS_CUT_MS, total: this.cut, need: B.DOWN_CUT_MS });
        if (this.endsAt <= g.now) { this.leave('down'); return true; }
      }
    }
    return took;
  }

  // ---------- Hints for bots ----------
  // An angle to steer away from danger in the next moment, or null if this spot looks safe
  danger(h) {
    if (!this.present) return null;
    const g = this.g, now = g.now;
    if (Math.hypot(h.x, h.y) < B.BODY_R + 140) return Math.atan2(h.y, h.x);
    const ax = h.x + Math.cos(h.angle) * 60, ay = h.y + Math.sin(h.angle) * 60;
    for (const a of this.attacks) {
      if (a.t2 < now || a.t0 > now + 400) continue;
      // check the attack as if it were live, a little ahead of time
      const real = g.now; g.now = Math.max(a.t1, Math.min(a.t2, now + 500));
      const bad = this.hits(a, ax, ay, 40) || this.hits(a, h.x, h.y, 40);
      g.now = real;
      if (bad) return a.type === 'rain' || a.type === 'stomp' ? Math.atan2(h.y, h.x) + rand(-.6, .6) : h.angle + Math.PI / 2 * (Math.random() < .5 ? 1 : -1);
    }
    return null;
  }
}

module.exports = { Boss, BOSS: B };
