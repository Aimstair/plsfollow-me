'use strict';
const fs = require('fs');
const path = require('path');
// House hosts: the site's own accounts, played by the server. They roam, chase boosts, dodge trolls,
// steal from other snakes and sometimes pick fights with each other. Players can join their snakes.
// They're tagged as hosts in the game, don't count as players, and stay off the hall of fame.

// Each group shares one snake. Edit this list to change the hosts.
// A profile photo for a host goes in public/hosts/<handle>.jpg (square JPEG, ~256px).
const GROUPS = [
  [{ handle: 'ericmar.g', platform: 'th' }],
  [{ handle: 'maisoncarte_official', platform: 'tt' }, { handle: 'clipit_app', platform: 'tt' }],
];

const RESPAWN_MS = 8000;      // back in the game this long after being knocked out
const AWAY_MS = 45000;        // a host stuck in another host's snake leaves after this, then respawns home
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

class House {
  constructor(game) {
    this.g = game;
    this.slots = [];
    GROUPS.forEach((members, group) => members.forEach(m => this.slots.push({ ...m, group, player: null, deadUntil: 0 })));
    this.reserved = new Set(this.slots.map(s => s.handle.toLowerCase()));
    for (const slot of this.slots) {
      try { slot.img = fs.readFileSync(path.join(__dirname, '..', 'public', 'hosts', `${slot.handle}.jpg`)); } catch { slot.img = null; }
    }
  }

  isReserved(handle) { return !!handle && this.reserved.has(handle.toLowerCase()); }

  // Called every tick: respawn knocked-out hosts, send wanderers home
  tick() {
    const g = this.g;
    for (const slot of this.slots) {
      const p = slot.player;
      if (p && !g.players.has(p.pid)) { slot.player = null; slot.deadUntil = g.now + RESPAWN_MS; }
      if (!slot.player && g.now >= slot.deadUntil) this.spawn(slot);
      if (slot.player) {
        const q = slot.player, s = g.snakeOf(q);
        q.lastInput = g.now; // hosts are always "active"
        // Away = stuck in a snake led by a different host group (being in a player's snake is fine)
        const lead = s && s.members[0], away = lead && lead.bot && lead.group !== slot.group;
        if (!away) q.awaySince = 0;
        else if (!q.awaySince) q.awaySince = g.now;
        else if (g.now - q.awaySince > AWAY_MS) { g.event({ k: 'out', pid: q.pid, x: Math.round(q.x), y: Math.round(q.y) }); g.eliminate(q, 'leave'); slot.player = null; slot.deadUntil = g.now + RESPAWN_MS; }
      }
    }
  }

  spawn(slot) {
    const g = this.g;
    const p = { pid: g.pidSeq++, bot: true, group: slot.group, handle: slot.handle, platform: slot.platform, img: slot.img, client: null,
      x: 0, y: 0, angle: 0, target: 0, wob: 0, lastInput: g.now, lastSteer: 0, mind: { until: 0, mode: 'wander', aim: null } };
    g.players.set(p.pid, p);
    slot.player = p;
    // Rejoin a groupmate's snake if one is alive, otherwise start a new snake somewhere safe
    const mate = this.slots.find(o => o !== slot && o.group === slot.group && o.player && g.players.has(o.player.pid));
    const ms = mate && g.snakeOf(mate.player);
    if (ms) { const t = ms.members[ms.members.length - 1]; p.x = t.x; p.y = t.y; ms.members.push(p); }
    else { const at = g.safeSpot(); g.spawnLine([p], at.x, at.y, rand(0, TAU)); }
    g.broadcastJson({ t: 'prof', l: [g.profileRow(p)] });
  }

  // Steering for a snake whose head is a host. Feels like a person: picks a plan every couple of
  // seconds, wobbles a little, and reacts right away to danger.
  steer(s, h) {
    const g = this.g, mind = h.mind, R = g.arenaR;
    let want = null;
    // Danger first: trolls close by, then the wall
    for (const t of g.trolls) {
      const d = Math.hypot(t.x - h.x, t.y - h.y);
      if (d < 190) { want = Math.atan2(h.y - t.y, h.x - t.x); break; }
    }
    if (want === null && Math.hypot(h.x, h.y) > R * 0.82) want = Math.atan2(-h.y, -h.x) + rand(-0.4, 0.4);
    if (want === null) {
      if (g.now > mind.until) this.plan(s, h);
      const a = mind.aim && mind.aim();
      want = a ? Math.atan2(a.y - h.y, a.x - h.x) : h.angle + (h.wob = h.wob * 0.95 + (Math.random() - 0.5) * 0.3);
    }
    h.target = want + rand(-0.08, 0.08);
  }

  plan(s, h) {
    const g = this.g, mind = h.mind, lonely = s.members.length === 1;
    mind.until = g.now + rand(1500, 3500);
    const others = g.snakes.filter(o => o !== s && o.members.length > 1);
    const rivals = others.filter(o => o.members[0].bot && o.members[0].group !== h.group);
    const near = others.filter(o => Math.hypot(o.members[0].x - h.x, o.members[0].y - h.y) < 1100);
    // Pick a fight: aim for a body segment a bit behind the target's head (that's how you steal)
    const hunt = o => { const k = Math.min(o.members.length - 1, 1 + Math.floor(rand(1, Math.min(6, o.members.length)))); return () => o.members[k] || null; };
    if (rivals.length && Math.random() < 0.3) { mind.mode = 'fight'; mind.aim = hunt(rivals[Math.floor(Math.random() * rivals.length)]); return; }
    if ((lonely || Math.random() < 0.3) && near.length) { mind.mode = 'hunt'; mind.aim = hunt(near[Math.floor(Math.random() * near.length)]); return; }
    let bolt = null, bd = 500;
    for (const b of g.bolts) { const d = Math.hypot(b.x - h.x, b.y - h.y); if (d < bd) { bd = d; bolt = b; } }
    if (bolt && Math.random() < 0.7) { mind.mode = 'boost'; mind.aim = () => (g.bolts.includes(bolt) ? bolt : null); return; }
    // Wander toward a random point, like someone exploring
    const a = rand(0, TAU), r = Math.sqrt(Math.random()) * g.arenaR * 0.7, pt = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    mind.mode = 'wander'; mind.aim = () => pt;
  }
}

module.exports = { House };
