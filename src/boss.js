'use strict';
// Bosses. Every few minutes one of three bosses drops in (never the same twice in a row), attacks for
// 2 minutes, then leaves for 3. Every attack is telegraphed. Players fight back with tokens:
//   👁️ THE ALGORITHM        stays in the center. 🌱 Touch grass cuts its time; cut 30s to log it off.
//   📸 THE INFLUENCER       stays in the center. 📵 Unfollow drains its followers; at zero it goes offline.
//   💬 THE COMMENT SECTION  a dragon that hunts across the arena. ✂️ Block tokens ride its body; each
//                           one cuts segments off until it's destroyed.
// The server decides every hit; clients draw the same shapes at the same server-time moments.

const B = {
  FIRST_MS: Number(process.env.BOSS_FIRST_MS) || 60000,
  WARN_MS: 8000, STAY_MS: 120000, ENRAGE_MS: 30000, LEAVE_MS: 2500, COOLDOWN_MS: 60000,
  BODY_R: 120, SLAM_R: 350,
  HEAD_COST_MS: 5000, STUN_MS: 800, KNOCK: 520, HIT_GRACE_MS: 1500,
  SEG_R: 16, HEAD_R: 21,
  TOKEN_EVERY_MS: 5000, TOKEN_MAX: 4, TOKEN_LIFE_MS: 15000, TOKEN_HIT: 34,
  GRASS_CUT_MS: 6000, DOWN_CUT_MS: 30000,           // the Algorithm
  INFL_HP: 9,                                       // the Influencer: unfollows needed
  DRAGON_SEGS: 22, DRAGON_MIN: 4, DRAGON_CUT: 2,    // the Comment Section
  DRAGON_SPACING: 40, DRAGON_SEG_R: 28, DRAGON_HEAD_R: 46, DRAGON_SPEED: 150, DRAGON_TURN: 1.7,
  LOOT_BOLTS: 8,
};
const KINDS = ['algorithm', 'influencer', 'comments'];
const NAMES = { algorithm: 'THE ALGORITHM', influencer: 'THE INFLUENCER', comments: 'THE COMMENT SECTION' };
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

class Boss {
  constructor(game) {
    this.g = game;
    this.phase = 'idle'; this.kind = ''; this.lastKind = '';
    this.nextAt = Date.now() + B.FIRST_MS;
    this.attacks = []; this.tokens = []; this.minions = [];
    this.seq = 1; this.lastType = ''; this.nextAttackAt = 0; this.nextTokenAt = 0;
    this.landAt = 0; this.endsAt = 0; this.leaveAt = 0; this.outcome = ''; this.lastBy = 0;
    this.cut = 0; this.hp = 0; this.hpMax = 0; this.dragon = null; this.liveTick = 0;
  }

  get present() { return this.phase === 'active'; }
  get enraged() { return this.phase === 'active' && this.endsAt - this.g.now <= B.ENRAGE_MS; }

  // ---------- Wire ----------
  snapshot() {
    const now = this.g.now;
    return {
      t: 'boss', kind: this.kind, name: NAMES[this.kind] || '', phase: this.phase, now,
      landAt: this.landAt, endsAt: this.endsAt, leaveAt: this.leaveAt, nextAt: this.nextAt,
      outcome: this.outcome, by: this.lastBy, enraged: this.enraged,
      cut: this.cut, need: B.DOWN_CUT_MS, hp: this.hp, hpMax: this.hpMax,
      tokens: this.tokens.map(t => { const p = this.tokenPos(t); return [t.id, Math.round(p.x), Math.round(p.y), t.until, t.seg ?? -1]; }),
      attacks: this.attacks.filter(a => a.t2 > now).map(a => a.wire),
    };
  }
  push() { this.g.broadcastJson(this.snapshot()); }
  // Moving parts (dragon body, minions, spotlights) go out 10 times a second
  pushLive() {
    const msg = { t: 'bossLive', now: this.g.now };
    if (this.dragon) { msg.body = this.dragon.segs.map(s => [Math.round(s.x), Math.round(s.y)]); msg.ang = +this.dragon.angle.toFixed(2); }
    if (this.minions.length) msg.mins = this.minions.map(m => [m.id, Math.round(m.x), Math.round(m.y)]);
    const spots = this.attacks.filter(a => a.type === 'spot' && a.t2 > this.g.now);
    if (spots.length) msg.spots = spots.map(a => [a.id, Math.round(a.x), Math.round(a.y)]);
    if (this.kind === 'comments') msg.tokens = this.tokens.map(t => { const p = this.tokenPos(t); return [t.id, Math.round(p.x), Math.round(p.y)]; });
    this.g.broadcastJson(msg);
  }

  // ---------- Loop ----------
  tick() {
    const g = this.g, now = g.now;
    if (this.phase === 'idle') {
      if (now >= this.nextAt) {
        const pool = KINDS.filter(k => k !== this.lastKind);   // never the same boss twice in a row
        this.kind = KINDS.includes(process.env.BOSS_KIND) ? process.env.BOSS_KIND : pool[Math.floor(Math.random() * pool.length)]; this.lastKind = this.kind; // BOSS_KIND: local testing only
        this.phase = 'warning'; this.landAt = now + B.WARN_MS; this.outcome = ''; this.lastBy = 0;
        this.push(); g.house.onBoss('warning', this.kind);
      }
      return;
    }
    if (this.phase === 'warning') { if (now >= this.landAt) this.land(); return; }
    if (this.phase === 'leaving') {
      if (now >= this.leaveAt) { this.phase = 'idle'; this.nextAt = now + B.COOLDOWN_MS; this.attacks = []; this.tokens = []; this.minions = []; this.dragon = null; this.push(); }
      return;
    }
    if (now >= this.endsAt) return this.leave(this.kind === 'algorithm' && this.cut >= B.DOWN_CUT_MS ? 'down' : 'bored');
    if (now >= this.nextAttackAt) this.chooseAttack();
    let changed = false;
    if (now >= this.nextTokenAt) { this.nextTokenAt = now + (this.enraged ? B.TOKEN_EVERY_MS * 0.6 : B.TOKEN_EVERY_MS); if (this.tokens.length < B.TOKEN_MAX) { this.spawnToken(); changed = true; } }
    const before = this.tokens.length;
    this.tokens = this.tokens.filter(t => t.until > now && (t.seg === undefined || (this.dragon && t.seg < this.dragon.segs.length)));
    if (this.tokens.length !== before) changed = true;
    this.attacks = this.attacks.filter(a => a.t2 > now - 500);
    if (this.dragon) this.moveDragon(0.05);
    this.moveMinions(0.05);
    this.applyAttacks();
    if (this.phase !== 'active') return;
    // Pickups first (a Block token sits on the dragon, so grabbing one must not count as bumping it)
    if (this.collectTokens()) changed = true;
    if (this.phase !== 'active') return;
    this.contact();
    if (changed) this.push();
    if (++this.liveTick % 2 === 0 && (this.dragon || this.minions.length || this.attacks.some(a => a.type === 'spot'))) this.pushLive();
  }

  land() {
    const now = this.g.now;
    this.phase = 'active'; this.endsAt = now + B.STAY_MS; this.cut = 0;
    this.nextAttackAt = now + 3500; this.nextTokenAt = now + 2500;
    this.hp = this.hpMax = this.kind === 'influencer' ? B.INFL_HP : this.kind === 'comments' ? B.DRAGON_SEGS : 0;
    if (this.kind === 'comments') {
      // The dragon lands coiled in the middle, then starts to hunt
      const segs = []; for (let i = 0; i < B.DRAGON_SEGS; i++) { const a = i * 0.45, r = 40 + i * 6; segs.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
      this.dragon = { segs, angle: rand(0, TAU), target: null, retarget: 0, path: segs.map(s => ({ x: s.x, y: s.y })).reverse(), freezeUntil: 0 };
    }
    this.addAttack({ type: 'slam', t0: now - 1, t1: now, t2: now + 450, r: B.SLAM_R });
    this.push();
  }

  leave(outcome) {
    const g = this.g;
    const c = this.center();
    this.phase = 'leaving'; this.outcome = outcome; this.leaveAt = g.now + B.LEAVE_MS; this.attacks = []; this.tokens = []; this.minions = [];
    if (outcome === 'down') {
      g.bonusBolts = B.LOOT_BOLTS; g.bonusBoltsUntil = g.now + 45000;
      for (let i = 0; i < B.LOOT_BOLTS; i++) { const a = i / B.LOOT_BOLTS * TAU + rand(-.2, .2), r = rand(160, 420); g.bolts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }); }
    }
    this.push();
    if (this.dragon) this.pushLive();
    g.house.onBoss(outcome === 'down' ? 'down' : 'left', this.kind);
  }

  center() { return this.dragon ? this.dragon.segs[0] : { x: 0, y: 0 }; }

  // ---------- Attacks ----------
  addAttack(a) {
    a.id = this.seq++; a.hit = new Set();
    const { hit, ...wire } = a; a.wire = wire;
    this.attacks.push(a);
    this.g.broadcastJson({ t: 'bossAtk', a: wire });
    return a;
  }

  // Heads of the biggest snakes and leaders, for aimed attacks
  targets(n) { return this.g.snakes.slice().sort((a, b) => b.members.length - a.members.length).slice(0, n).map(s => s.members[0]); }

  chooseAttack() {
    const now = this.g.now, enr = this.enraged;
    this.nextAttackAt = now + (enr ? rand(2000, 3000) : rand(4000, 6000));
    const pools = {
      algorithm: enr ? ['beam', 'stomp', 'rain', 'doom'] : ['beam', 'stomp', 'rain'],
      influencer: ['flash', 'hearts', 'ring', 'spot'],
      comments: ['fire', 'whip', 'replies', 'thread'],
    };
    const pool = pools[this.kind];
    let type; do { type = pool[Math.floor(Math.random() * pool.length)]; } while (type === this.lastType && pool.length > 1);
    this.lastType = type;
    this['atk_' + type](now, enr);
  }

  // --- The Algorithm ---
  atk_beam(now, enr) {
    const tele = 1300, dur = 2200, count = enr ? 3 : 1 + Math.floor(Math.random() * 2);
    this.addAttack({ type: 'beam', t0: now, t1: now + tele, t2: now + tele + dur, count, a0: rand(0, TAU), sweep: (Math.random() < .5 ? -1 : 1) * rand(Math.PI / 2, Math.PI * 2 / 3), len: 900, w: 36 });
  }
  atk_stomp(now, enr) {
    const tele = 1200, n = enr ? 6 : 4 + Math.floor(Math.random() * 2), lines = [];
    for (let i = 0; i < n; i++) {
      const base = i / n * TAU + rand(-.25, .25), pts = [];
      for (let r = B.BODY_R; r <= 820; r += 100) { const a = base + rand(-.12, .12); pts.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
      lines.push(pts);
    }
    const ringAt = now + tele + 650, speed = 420, reach = this.g.arenaR + 60;
    const gaps = []; for (let i = 0, k = enr ? 1 : 2; i < k; i++) gaps.push([rand(0, TAU), 0.42]);
    this.addAttack({ type: 'stomp', t0: now, t1: now + tele, t2: ringAt + (reach - B.BODY_R) / speed * 1000, lines, step: 140, ringAt, speed, r0: B.BODY_R, gaps, ringW: 40 });
  }
  aimedCircles(max, lead, spread) {
    const circles = [];
    for (const s of this.g.snakes.slice().sort((a, b) => b.members.length - a.members.length)) {
      if (circles.length >= max) break;
      const h = s.members[0], shots = s.members.length > 4 ? 2 : 1;
      for (let i = 0; i < shots && circles.length < max; i++) circles.push([Math.round(h.x + Math.cos(h.angle) * lead * rand(.6, 1.1) + rand(-spread, spread)), Math.round(h.y + Math.sin(h.angle) * lead * rand(.6, 1.1) + rand(-spread, spread))]);
    }
    return circles;
  }
  atk_rain(now) {
    const circles = this.aimedCircles(10, 285, 40);
    while (circles.length < 3) { const a = rand(0, TAU), r = rand(200, this.g.arenaR * .8); circles.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
    this.addAttack({ type: 'rain', t0: now, t1: now + 1500, t2: now + 1760, circles, r: 70 });
  }
  atk_doom(now) { this.addAttack({ type: 'doom', t0: now, t1: now + 900, t2: now + 3900, pull: 115 }); }

  // --- The Influencer ---
  // Flash: "3… 2… 1…" then every head still facing the camera is stunned. Turn away to survive.
  atk_flash(now) { this.addAttack({ type: 'flash', t0: now, t1: now + 2400, t2: now + 2700, cone: 1.2 }); }
  atk_hearts(now, enr) {
    const circles = this.aimedCircles(enr ? 6 : 4, 250, 60);
    for (let i = 0, extra = enr ? 9 : 6; i < extra; i++) { const a = rand(0, TAU), r = rand(180, this.g.arenaR * .85); circles.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]); }
    this.addAttack({ type: 'hearts', t0: now, t1: now + 1300, t2: now + 1560, circles, r: 66 });
  }
  atk_ring(now, enr) {
    const speed = 380, reach = this.g.arenaR + 60, ringAt = now + 1100, n = enr ? 2 : 3;
    const gaps = []; const base = rand(0, TAU); for (let i = 0; i < n; i++) gaps.push(base + i / n * TAU);
    this.addAttack({ type: 'ring', t0: now, t1: ringAt, t2: ringAt + (reach - 110) / speed * 1000, ringAt, speed, r0: 110, gaps, gw: 0.38, spin: (Math.random() < .5 ? -1 : 1) * 0.6, ringW: 34 });
  }
  // Story spotlight: locks onto a leader, follows (a bit slower than a snake), then stamps
  atk_spot(now) {
    const [h] = this.targets(1); if (!h) return this.atk_hearts(now, false);
    this.addAttack({ type: 'spot', t0: now, t1: now + 3000, t2: now + 3300, pid: h.pid, x: Math.round(h.x), y: Math.round(h.y), r: 110, follow: 165 });
  }

  // --- The Comment Section ---
  // Hot take: the dragon stops, aims, and breathes a cone of fire
  atk_fire(now) {
    const d = this.dragon, h = d.segs[0], [t] = this.targets(1);
    const ang = t ? Math.atan2(t.y - h.y, t.x - h.x) : d.angle;
    d.freezeUntil = now + 2500; d.angle = ang;
    this.addAttack({ type: 'fire', t0: now, t1: now + 1200, t2: now + 2500, x: Math.round(h.x), y: Math.round(h.y), ang, len: 460, half: 0.42 });
  }
  atk_whip(now) {
    const d = this.dragon, tail = d.segs[d.segs.length - 1], prev = d.segs[Math.max(0, d.segs.length - 3)];
    const a0 = Math.atan2(tail.y - prev.y, tail.x - prev.x) - Math.PI / 2;
    this.addAttack({ type: 'whip', t0: now, t1: now + 1000, t2: now + 1700, x: Math.round(tail.x), y: Math.round(tail.y), r: 270, a0, sweep: Math.PI * (Math.random() < .5 ? 1 : -1) });
  }
  atk_replies(now, enr) {
    const h = this.dragon.segs[0], n = enr ? 7 : 5;
    for (let i = 0; i < n; i++) { const a = i / n * TAU; this.minions.push({ id: this.seq++, x: h.x + Math.cos(a) * 60, y: h.y + Math.sin(a) * 60, angle: a, until: now + 10000 }); }
    this.addAttack({ type: 'replies', t0: now, t1: now, t2: now + 600, x: Math.round(h.x), y: Math.round(h.y) });
  }
  // Thread: a ring of comments closes in around a leader, with one gap to escape through
  atk_thread(now) {
    const [h] = this.targets(1); if (!h) return this.atk_whip(now);
    this.addAttack({ type: 'thread', t0: now, t1: now + 900, t2: now + 3400, x: Math.round(h.x), y: Math.round(h.y), r0: 380, r1: 50, gap: rand(0, TAU), gw: 0.55, w: 34 });
  }

  // Does attack `a` hit (x,y) with radius rr right now?
  hits(a, x, y, rr, isHead = true) {
    const now = this.g.now;
    if (now < a.t1 || now > a.t2) return false;
    switch (a.type) {
      case 'slam': { const c = this.center(); return Math.hypot(x - c.x, y - c.y) < a.r + rr; }
      case 'beam': {
        const f = (now - a.t1) / (a.t2 - a.t1);
        for (let i = 0; i < a.count; i++) {
          const ang = a.a0 + i * TAU / a.count + a.sweep * f;
          if (segDist(x, y, Math.cos(ang) * B.BODY_R * .6, Math.sin(ang) * B.BODY_R * .6, Math.cos(ang) * a.len, Math.sin(ang) * a.len) < a.w / 2 + rr) return true;
        }
        return false;
      }
      case 'stomp': {
        for (let i = 0; i < a.lines.length; i++) {
          const s = a.t1 + i * a.step; if (now < s || now > s + 450) continue;
          const pts = a.lines[i];
          for (let j = 1; j < pts.length; j++) if (segDist(x, y, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) < 22 + rr) return true;
        }
        if (isHead && now >= a.ringAt) {
          const R = a.r0 + (now - a.ringAt) / 1000 * a.speed, d = Math.hypot(x, y);
          if (Math.abs(d - R) < a.ringW / 2 + rr && !a.gaps.some(([ga, hw]) => angDiff(Math.atan2(y, x), ga) < hw)) return true;
        }
        return false;
      }
      case 'rain': case 'hearts': return a.circles.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < a.r + rr);
      case 'ring': {
        if (!isHead || now < a.ringAt) return false;
        const el = (now - a.ringAt) / 1000, R = a.r0 + el * a.speed, d = Math.hypot(x, y);
        if (Math.abs(d - R) > a.ringW / 2 + rr) return false;
        const ang = Math.atan2(y, x);
        return !a.gaps.some(gp => angDiff(ang, gp + a.spin * el) < a.gw);
      }
      case 'fire': {
        const d = Math.hypot(x - a.x, y - a.y);
        return d < a.len + rr && d > 10 && angDiff(Math.atan2(y - a.y, x - a.x), a.ang) < a.half + rr / Math.max(60, d);
      }
      case 'whip': {
        const d = Math.hypot(x - a.x, y - a.y); if (d > a.r + rr || d < 30) return false;
        const f = (now - a.t1) / (a.t2 - a.t1), cur = a.sweep * f;
        const raw = Math.atan2(y - a.y, x - a.x) - a.a0, rel = Math.atan2(Math.sin(raw), Math.cos(raw));
        const signed = a.sweep > 0 ? (rel < 0 ? rel + TAU : rel) : (rel > 0 ? rel - TAU : rel);
        return Math.abs(signed) <= Math.abs(cur) && Math.abs(signed) >= Math.abs(cur) - 0.9;
      }
      case 'thread': {
        const f = (now - a.t1) / (a.t2 - a.t1), R = a.r0 + (a.r1 - a.r0) * f, d = Math.hypot(x - a.x, y - a.y);
        return Math.abs(d - R) < a.w / 2 + rr && angDiff(Math.atan2(y - a.y, x - a.x), a.gap) > a.gw;
      }
    }
    return false;
  }

  applyAttacks() {
    const g = this.g, dt = 0.05;
    for (const a of this.attacks) {
      if (a.type === 'spot' && g.now < a.t1) {
        // the spotlight drifts after its target
        const t = g.players.get(a.pid);
        if (t) { const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy), mv = Math.min(d, a.follow * dt); if (d > 0) { a.x += dx / d * mv; a.y += dy / d * mv; } }
        continue;
      }
      if (g.now < a.t1 || g.now > a.t2) continue;
      if (a.type === 'doom') {
        for (const s of g.snakes) { const h = s.members[0], d = Math.hypot(h.x, h.y) || 1; h.x -= h.x / d * a.pull * dt; h.y -= h.y / d * a.pull * dt; }
        continue;
      }
      if (a.type === 'flash') {
        if (a.done) continue; a.done = true;
        for (const s of g.snakes.slice()) {
          const h = s.members[0];
          if (g.now < (s.bossGrace || 0) || Math.hypot(h.x, h.y) < 60) continue;
          if (angDiff(h.angle, Math.atan2(-h.y, -h.x)) < a.cone) this.hitHead(s, a, 0, 0);
        }
        continue;
      }
      if (a.type === 'spot') {
        if (a.done) continue; a.done = true;
        g.event({ k: 'bossStamp', id: a.id, x: Math.round(a.x), y: Math.round(a.y) });
        for (const s of g.snakes.slice()) {
          if (g.now < (s.bossGrace || 0)) continue;
          const m = s.members;
          if (Math.hypot(m[0].x - a.x, m[0].y - a.y) < a.r + B.HEAD_R) { this.hitHead(s, a, a.x, a.y); continue; }
          for (let k = 1; k < m.length; k++) if (Math.hypot(m[k].x - a.x, m[k].y - a.y) < a.r + B.SEG_R) { this.hitBody(s, k, a); break; }
        }
        continue;
      }
      if (a.type === 'replies') continue;
      for (const s of g.snakes.slice()) {
        if (a.hit.has(s.id) || g.now < (s.bossGrace || 0)) continue;
        const m = s.members;
        if (this.hits(a, m[0].x, m[0].y, B.HEAD_R)) { a.hit.add(s.id); this.hitHead(s, a, m[0].x, m[0].y); continue; }
        for (let k = 1; k < m.length; k++) if (this.hits(a, m[k].x, m[k].y, B.SEG_R, false)) { a.hit.add(s.id); this.hitBody(s, k, a); break; }
      }
    }
  }

  // Touching the boss's body (or a reply guy)
  contact() {
    const g = this.g;
    const bodies = this.dragon
      ? this.dragon.segs.map((s, i) => ({ x: s.x, y: s.y, r: i === 0 ? B.DRAGON_HEAD_R : B.DRAGON_SEG_R }))
      : [{ x: 0, y: 0, r: this.kind === 'influencer' ? 110 : B.BODY_R }];
    for (const s of g.snakes.slice()) {
      if (g.now < (s.bossGrace || 0)) continue;
      const m = s.members;
      const hb = bodies.find(b => Math.hypot(m[0].x - b.x, m[0].y - b.y) < b.r + B.HEAD_R);
      if (hb) { this.hitHead(s, { type: 'body' }, hb.x, hb.y); continue; }
      let cut = -1;
      for (let k = 1; k < m.length && cut < 0; k++) if (bodies.some(b => Math.hypot(m[k].x - b.x, m[k].y - b.y) < b.r + B.SEG_R)) cut = k;
      if (cut > 0) this.hitBody(s, cut, { type: 'body' });
    }
    // reply guys pop when they hit someone
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const mi = this.minions[i];
      for (const s of g.snakes) {
        if (g.now < (s.bossGrace || 0)) continue;
        const m = s.members;
        if (Math.hypot(m[0].x - mi.x, m[0].y - mi.y) < 22 + B.HEAD_R) { this.hitHead(s, { type: 'replies' }, mi.x, mi.y); this.minions.splice(i, 1); break; }
        let k = -1; for (let j = 1; j < m.length && k < 0; j++) if (Math.hypot(m[j].x - mi.x, m[j].y - mi.y) < 22 + B.SEG_R) k = j;
        if (k > 0) { this.hitBody(s, k, { type: 'replies' }); this.minions.splice(i, 1); break; }
      }
    }
  }

  hitHead(s, a, ox, oy) {
    const g = this.g, h = s.members[0];
    s.bossGrace = g.now + B.HIT_GRACE_MS;
    let dx = h.x - ox, dy = h.y - oy;
    if (a.type === 'rain' || a.type === 'hearts') { const c = a.circles.reduce((b, c) => (Math.hypot(h.x - c[0], h.y - c[1]) < Math.hypot(h.x - b[0], h.y - b[1]) ? c : b)); dx = h.x - c[0]; dy = h.y - c[1]; }
    else if (a.type === 'fire' || a.type === 'whip' || a.type === 'thread') { dx = h.x - a.x; dy = h.y - a.y; }
    else if (!this.dragon && ['beam', 'stomp', 'slam', 'body', 'ring', 'flash'].includes(a.type)) { dx = h.x; dy = h.y; }
    if (!Math.hypot(dx, dy)) { dx = Math.cos(h.angle + Math.PI); dy = Math.sin(h.angle + Math.PI); }
    const d = Math.hypot(dx, dy);
    h.kx = dx / d * B.KNOCK; h.ky = dy / d * B.KNOCK; h.stunUntil = g.now + B.STUN_MS;
    s.leaderSince -= B.HEAD_COST_MS;
    g.event({ k: 'bossHit', boss: this.kind, sid: s.id, pid: h.pid, atk: a.type, head: 1, x: Math.round(h.x), y: Math.round(h.y) });
  }

  hitBody(s, k, a) {
    const g = this.g, m = s.members, at = m[k];
    s.bossGrace = g.now + B.HIT_GRACE_MS;
    const tail = m.splice(k);
    s.grace = Math.max(s.grace, g.now + 1500);
    const ns = g.makeSnake(tail); ns.bossGrace = g.now + B.HIT_GRACE_MS;
    g.event({ k: 'bossHit', boss: this.kind, sid: s.id, nsid: ns.id, k2: k, n: tail.length, atk: a.type, x: Math.round(at.x), y: Math.round(at.y) });
  }

  // ---------- The dragon ----------
  moveDragon(dt) {
    const g = this.g, d = this.dragon, h = d.segs[0], now = g.now;
    if (now > d.retarget) { d.retarget = now + rand(4000, 7000); const ts = this.targets(3); d.target = ts[Math.floor(Math.random() * ts.length)] || null; }
    if (now >= d.freezeUntil) {
      let want = d.target && g.players.has(d.target.pid) ? Math.atan2(d.target.y - h.y, d.target.x - h.x) : d.angle + rand(-.3, .3);
      if (Math.hypot(h.x, h.y) > g.arenaR * 0.8) want = Math.atan2(-h.y, -h.x);
      let df = want - d.angle; df = Math.atan2(Math.sin(df), Math.cos(df));
      const mt = B.DRAGON_TURN * dt * (this.enraged ? 1.3 : 1); d.angle += Math.max(-mt, Math.min(mt, df));
      const sp = B.DRAGON_SPEED * (this.enraged ? 1.15 : 1);
      h.x += Math.cos(d.angle) * sp * dt; h.y += Math.sin(d.angle) * sp * dt;
    }
    // the body rides the head's trail
    const P = d.path, last = P[P.length - 1];
    if (!last || Math.hypot(h.x - last.x, h.y - last.y) >= 4) P.push({ x: h.x, y: h.y });
    let j = P.length - 1, acc = 0, px = h.x, py = h.y;
    for (let i = 1; i < d.segs.length; i++) {
      const want = i * B.DRAGON_SPACING;
      while (j >= 0) { const q = P[j], seg = Math.hypot(q.x - px, q.y - py); if (acc + seg >= want) break; acc += seg; px = q.x; py = q.y; j--; }
      if (j < 0) break;
      const q = P[j], seg = Math.hypot(q.x - px, q.y - py) || 1, f = (want - acc) / seg, s = d.segs[i];
      const tx = px + (q.x - px) * f, ty = py + (q.y - py) * f, dx = tx - s.x, dy = ty - s.y, dd = Math.hypot(dx, dy), mv = B.DRAGON_SPEED * 3 * dt;
      if (dd <= mv) { s.x = tx; s.y = ty; } else { s.x += dx / dd * mv; s.y += dy / dd * mv; }
    }
    if (j > 8) P.splice(0, j - 4);
  }

  moveMinions(dt) {
    const g = this.g, now = g.now;
    this.minions = this.minions.filter(m => m.until > now);
    for (const m of this.minions) {
      let best = null, bd = 900;
      for (const s of g.snakes) { const h = s.members[0], d = Math.hypot(h.x - m.x, h.y - m.y); if (d < bd) { bd = d; best = h; } }
      const want = best ? Math.atan2(best.y - m.y, best.x - m.x) : m.angle;
      let df = want - m.angle; df = Math.atan2(Math.sin(df), Math.cos(df)); m.angle += Math.max(-3 * dt, Math.min(3 * dt, df));
      m.x += Math.cos(m.angle) * 160 * dt; m.y += Math.sin(m.angle) * 160 * dt;
    }
  }

  // ---------- Fight-back tokens ----------
  tokenPos(t) { if (t.seg !== undefined && this.dragon) { const s = this.dragon.segs[t.seg]; return s || { x: 0, y: 0 }; } return t; }
  spawnToken() {
    const g = this.g, now = g.now;
    if (this.kind === 'comments') {
      // ✂️ Block tokens ride the dragon's body, away from its head
      const d = this.dragon; if (!d || d.segs.length <= B.DRAGON_MIN + 1) return;
      const free = []; for (let i = 3; i < d.segs.length; i++) if (!this.tokens.some(t => t.seg === i)) free.push(i);
      if (!free.length) return;
      this.tokens.push({ id: this.seq++, seg: free[Math.floor(Math.random() * free.length)], until: now + 12000 });
      return;
    }
    let best = null;
    for (let i = 0; i < 8; i++) {
      const a = rand(0, TAU), r = rand(250, Math.min(700, g.arenaR * .85)), x = Math.cos(a) * r, y = Math.sin(a) * r;
      const d = Math.min(Infinity, ...this.tokens.map(o => Math.hypot(o.x - x, o.y - y)));
      if (!best || d > best.d) best = { x, y, d };
    }
    this.tokens.push({ id: this.seq++, x: best.x, y: best.y, until: now + B.TOKEN_LIFE_MS });
  }

  collectTokens() {
    const g = this.g; let took = false;
    for (const s of g.snakes) {
      const h = s.members[0];
      for (let i = this.tokens.length - 1; i >= 0; i--) {
        const tk = this.tokens[i], p = this.tokenPos(tk);
        if (Math.hypot(h.x - p.x, h.y - p.y) > (tk.seg !== undefined ? B.DRAGON_SEG_R + B.HEAD_R : B.TOKEN_HIT)) continue;
        this.tokens.splice(i, 1); took = true; this.lastBy = h.pid;
        s.bossGrace = Math.max(s.bossGrace || 0, g.now + 1200); // a moment of safety after grabbing one
        const ev = { k: 'token', boss: this.kind, pid: h.pid, x: Math.round(p.x), y: Math.round(p.y) };
        if (this.kind === 'algorithm') {
          this.endsAt -= B.GRASS_CUT_MS; this.cut += B.GRASS_CUT_MS;
          Object.assign(ev, { endsAt: this.endsAt, cut: B.GRASS_CUT_MS, total: this.cut, need: B.DOWN_CUT_MS });
        } else if (this.kind === 'influencer') {
          this.hp -= 1; Object.assign(ev, { hp: this.hp, hpMax: this.hpMax });
        } else {
          // cut segments off the dragon's tail; tokens on removed segments go away
          const d = this.dragon; d.segs.splice(Math.max(B.DRAGON_MIN, d.segs.length - B.DRAGON_CUT));
          this.hp = d.segs.length; this.tokens = this.tokens.filter(t => t.seg < d.segs.length);
          Object.assign(ev, { hp: this.hp, hpMax: this.hpMax });
        }
        g.event(ev);
        const beaten = this.kind === 'influencer' ? this.hp <= 0 : this.kind === 'comments' ? this.hp <= B.DRAGON_MIN : false;
        if (beaten || (this.kind === 'algorithm' && this.endsAt <= g.now)) { this.leave('down'); return true; }
        break; // one token per head per tick
      }
    }
    return took;
  }

  // ---------- Hints for bots ----------
  // An angle to steer away from danger in the next moment, or null if this spot looks safe
  danger(h) {
    if (!this.present) return null;
    const g = this.g, now = g.now;
    if (this.dragon) {
      for (const s of this.dragon.segs) if (Math.hypot(h.x - s.x, h.y - s.y) < 150) return Math.atan2(h.y - s.y, h.x - s.x);
    } else if (Math.hypot(h.x, h.y) < B.BODY_R + 140) return Math.atan2(h.y, h.x);
    for (const m of this.minions) if (Math.hypot(h.x - m.x, h.y - m.y) < 130) return Math.atan2(h.y - m.y, h.x - m.x);
    const ax = h.x + Math.cos(h.angle) * 60, ay = h.y + Math.sin(h.angle) * 60;
    for (const a of this.attacks) {
      if (a.t2 < now || a.t0 > now + 400) continue;
      if (a.type === 'flash' && now < a.t1) return Math.atan2(h.y, h.x) + rand(-.4, .4); // look away from the camera
      if (a.type === 'spot' && now < a.t1 && Math.hypot(h.x - a.x, h.y - a.y) < 220) return Math.atan2(h.y - a.y, h.x - a.x);
      const real = g.now; g.now = Math.max(a.t1, Math.min(a.t2, now + 500));
      const bad = this.hits(a, ax, ay, 40) || this.hits(a, h.x, h.y, 40);
      g.now = real;
      if (bad) {
        const cx = a.x ?? 0, cy = a.y ?? 0;
        return ['rain', 'hearts', 'stomp', 'ring', 'fire', 'whip', 'thread'].includes(a.type) ? Math.atan2(h.y - cy, h.x - cx) + rand(-.6, .6) : h.angle + Math.PI / 2 * (Math.random() < .5 ? 1 : -1);
      }
    }
    return null;
  }
  // For the ace host (`allow`: a token on the dragon it's going for, so that body segment isn't avoided): of 36 headings, the one closest to `want` whose path stays clear of every attack,
  // the boss body and minions over the next ~1.2s (or null when the current path is already safe)
  safeHeading(h, want, speed, allow = null) {
    if (!this.present) return null;
    const g = this.g, now = g.now, real = g.now, T = [0.1, 0.25, 0.45, 0.7, 1, 1.35, 1.7];
    const flash = this.attacks.find(a => a.type === 'flash' && now < a.t1 + 100);
    const risk = ang => {
      let bad = 0;
      if (flash && angDiff(ang, Math.atan2(-h.y, -h.x)) < (flash.cone || 1.2) + 0.5) bad += 5;
      for (let i = 0; i < T.length; i++) {
        const x = h.x + Math.cos(ang) * speed * T[i], y = h.y + Math.sin(ang) * speed * T[i], w = T.length - i;
        if (Math.hypot(x, y) > g.arenaR * 0.97) bad += w;
        if (this.dragon) {
          const dh = this.dragon.segs[0], dx = dh.x + Math.cos(this.dragon.angle) * B.DRAGON_SPEED * T[i], dy = dh.y + Math.sin(this.dragon.angle) * B.DRAGON_SPEED * T[i];
          if (Math.hypot(x - dx, y - dy) < B.DRAGON_HEAD_R + 90) bad += w * 4;
        }
        for (const m of this.minions) { const mx = m.x + (h.x - m.x) * Math.min(1, T[i] * 0.5), my = m.y + (h.y - m.y) * Math.min(1, T[i] * 0.5); if (Math.hypot(x - mx, y - my) < 90) bad += w * 2; }
        if (this.dragon) { for (const sg of this.dragon.segs) if (Math.hypot(x - sg.x, y - sg.y) < 110 && !(allow && Math.hypot(allow.x - sg.x, allow.y - sg.y) < 60)) { bad += w * 4; break; } }
        else if (Math.hypot(x, y) < (this.kind === 'influencer' ? 110 : B.BODY_R) + 100) bad += w * 4;
        for (const m of this.minions) if (Math.hypot(x - m.x, y - m.y) < 100) bad += w * 2;
        g.now = now + T[i] * 1000;
        for (const a of this.attacks) if (a.t2 >= g.now && a.t1 <= g.now && a.type !== 'flash' && this.hits(a, x, y, 60) || this.hits(a, x, y, 60, false)) bad += w * 3;
        g.now = real;
      }
      return bad;
    };
    if (!risk(want) && !risk(h.angle)) return null;
    let best = want, bestScore = Infinity;
    for (let i = 0; i < 36; i++) {
      const ang = want + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * TAU / 36, sc = risk(ang) * 10 + angDiff(ang, want);
      if (sc < bestScore) { bestScore = sc; best = ang; }
    }
    return best;
  }
  // Token positions bots can aim for
  tokenSpots() { return this.tokens.map(t => this.tokenPos(t)); }
}

module.exports = { Boss, BOSS: B, NAMES };
