'use strict';
const fs = require('fs');
const path = require('path');
// House hosts: the site's own accounts, played by the server. They roam, chase boosts, dodge trolls,
// steal from other snakes and sometimes pick fights with each other. Players can join their snakes.
// They count as online players and appear in the hall of fame like everyone else.

// Each group shares one snake. Edit this list to change the hosts.
// "roam" hosts play like a regular visitor: they usually join the tail of the biggest snake, tap in
// the race and move from snake to snake, instead of keeping a home snake.
// A profile photo for a host goes in public/hosts/<handle>.jpg (square JPEG).
const GROUPS = [
  [{ handle: 'ericmar.g', platform: 'th' }],
  [{ handle: 'maisoncarte_official', platform: 'tt' }, { handle: 'clipit_app', platform: 'tt' }],
  [{ handle: 'quizwizard-aim', platform: 'yt', roam: true }],
  [{ handle: 'vhokun_', platform: 'ig', roam: true }],
  [{ handle: 'igoyeco', platform: 'ig', roam: true }],
  [{ handle: 'henri_hihi', platform: 'ig', roam: true }],
  [{ handle: 'oh.reocheesecake', platform: 'ig', roam: true }],
  [{ handle: 'numb_yb', platform: 'ig', roam: true }],
  [{ handle: 'monica.autolegitdealer', platform: 'ig', roam: true }],
  [{ handle: '_chashhhhh', platform: 'ig', roam: true }],
  [{ handle: 'izme_yu', platform: 'ig', roam: true }],
  [{ handle: 'michaelleoness', platform: 'ig', roam: true }],
  [{ handle: 'just.armyl', platform: 'ig', roam: true }],
  [{ handle: 'seanothelast', platform: 'ig', roam: true }],
];

// Chat lines by situation. Plain game chatter; nothing claims to have viewed or followed anyone.
const LINES = {
  head: ['my turn 😎', 'finally!!', 'ok where are we going', 'hold on tight', 'everyone follow me lol', 'driving now 🚗'],
  steal: ['thanks for the snacks 😈', 'yoink', 'mine now', 'get in loser', 'hehe sorry'],
  stolen: ['noooo 😭', 'hey give them back', 'rude 😤', 'who did that??', 'my tail!!'],
  boost: ['zoom ⚡', 'speeeed', 'catch me lol', 'nyoom'],
  troll: ['that goblin again 😭', 'stupid troll', 'ouch', 'the purple guys hate me'],
  bite: ['oops lol', 'we bit ourselves 💀', 'my bad', 'who was driving 😭'],
  welcome: ['welcome!', 'hi new person 👋', 'hey hey', 'more people yay', 'welcome to the snake 🐍'],
  cheer: ['go go go 👑', 'nice turn', 'go left!!', 'faster lol', "we're getting so long", 'dodge the goblin!'],
  bossWarn: ['oh no not again', 'everyone run 🏃', 'here it comes!!', 'boss fight!! 😤'],
  bossWarn_algorithm: ['THE ALGORITHM IS COMING 😱', 'not the algorithm again 😭'],
  bossWarn_influencer: ['is that... the Influencer?? 📸', "don't look at the camera!!"],
  bossWarn_comments: ['the COMMENT SECTION is here 💀', 'dragon incoming 🐉'],
  bossHit: ['shadowbanned 💀', 'the algorithm hates me', 'ouch!!', 'why me 😭'],
  bossToken_algorithm: ['touching grass 🌱', 'go touch grass everyone!', 'grass secured', 'log it off!!'],
  bossToken_influencer: ['unfollowed lol 📵', 'unfollow unfollow unfollow', 'bye bye followers'],
  bossToken_comments: ['blocked ✂️', 'BLOCK IT', 'cut its tail!!', 'reported 🚫'],
  bossDown: ['WE DID IT 🎉', 'gg ez', 'teamwork!!', 'free boosts!!', "that's how you do it"],
  bossLeft: ['phew it left', 'see you in 3 min lol', 'we survived 😮‍💨'],
  idle: ['this is so chaotic lol', "who's tapping so fast", 'gm everyone', 'these goblins are evil', 'tap tap tap', 'lol the snake is huge', 'good luck everyone 🍀', 'hello 👋', 'anyone else on their lunch break', 'this is weirdly fun', 'i keep getting stolen 😭'],
};
const CHAT_GAP_MS = [5000, 11000];    // at most one host chat in this window, across all hosts
const CHAT_PERSONAL_MS = [35000, 80000]; // each host waits at least this long between their own chats

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
    this.nextChat = 0; this.queue = []; this.idleAt = 0;
    this.nextGroup = GROUPS.length;
    // Paid bots (saved orders) join the roster too; they're not reserved, so their owner can still play
    for (const o of game.paid.active()) this.addPaid(o);
    for (const slot of this.slots) {
      try { slot.img = fs.readFileSync(path.join(__dirname, '..', 'public', 'hosts', `${slot.handle}.jpg`)); } catch { slot.img = null; }
    }
  }

  // A paid bot: roams like a visitor, carries the ✦ promoted tag, leaves when its time runs out
  addPaid(o) {
    const have = this.slots.find(s => s.orderId === o.id);
    if (have) { have.expiresAt = o.expiresAt; if (o.img) have.img = Buffer.from(o.img, 'base64'); return have; }
    const slot = { handle: o.handle, platform: o.platform, roam: true, promo: true, orderId: o.id, expiresAt: o.expiresAt,
      group: this.nextGroup++, player: null, deadUntil: 0, img: o.img ? Buffer.from(o.img, 'base64') : null };
    this.slots.push(slot);
    return slot;
  }
  removeSlot(slot) {
    const g = this.g, p = slot.player;
    if (p && g.players.has(p.pid)) { g.event({ k: 'out', pid: p.pid, x: Math.round(p.x), y: Math.round(p.y) }); g.eliminate(p, 'leave'); }
    this.slots.splice(this.slots.indexOf(slot), 1);
  }

  isReserved(handle) { return !!handle && this.reserved.has(handle.toLowerCase()); }

  // Called every tick: respawn knocked-out hosts, send wanderers home
  tick() {
    const g = this.g;
    this.chatTick();
    // Paid bots whose 30 days are up (or that were removed) leave the arena
    for (const slot of this.slots.slice()) {
      if (slot.promo && (g.now > slot.expiresAt || !g.paid.active(g.now).some(o => o.id === slot.orderId))) this.removeSlot(slot);
    }
    for (const slot of this.slots) {
      const p = slot.player;
      if (p && !g.players.has(p.pid)) { slot.player = null; slot.deadUntil = g.now + rand(RESPAWN_MS, RESPAWN_MS * 2); }
      if (!slot.player && g.now >= slot.deadUntil) this.spawn(slot);
      if (slot.player) {
        const q = slot.player, s = g.snakeOf(q);
        q.lastInput = g.now; // hosts are always "active"
        this.tap(q, s);
        // Away = stuck in a snake led by a different host group (being in a player's snake is fine).
        // Roaming hosts don't have a home, so they never leave on their own.
        const lead = s && s.members[0], away = !slot.roam && lead && lead.bot && lead.group !== slot.group;
        if (!away) q.awaySince = 0;
        else if (!q.awaySince) q.awaySince = g.now;
        else if (g.now - q.awaySince > AWAY_MS) { g.event({ k: 'out', pid: q.pid, x: Math.round(q.x), y: Math.round(q.y) }); g.eliminate(q, 'leave'); slot.player = null; slot.deadUntil = g.now + RESPAWN_MS; }
      }
    }
  }

  spawn(slot) {
    const g = this.g;
    const p = { pid: g.pidSeq++, bot: true, promo: !!slot.promo, group: slot.group, handle: slot.handle, platform: slot.platform, img: slot.img, client: null,
      x: 0, y: 0, angle: 0, target: 0, wob: 0, lastInput: g.now, lastSteer: 0, mind: { until: 0, mode: 'wander', aim: null } };
    g.players.set(p.pid, p);
    slot.player = p;
    // Rejoin a groupmate's snake if one is alive; roaming hosts usually join the biggest snake's tail
    // like a new visitor; otherwise start a new snake somewhere safe
    const mate = this.slots.find(o => o !== slot && o.group === slot.group && o.player && g.players.has(o.player.pid));
    const ms = (mate && g.snakeOf(mate.player)) || (slot.roam && Math.random() < 0.75 ? g.biggest() : null);
    if (ms) { const t = ms.members[ms.members.length - 1]; p.x = t.x; p.y = t.y; ms.members.push(p); }
    else { const at = g.safeSpot(); g.spawnLine([p], at.x, at.y, rand(0, TAU)); }
    g.broadcastJson({ t: 'prof', l: [g.profileRow(p)] });
  }

  // Tap race: hosts behind the head tap in bursts at a human-ish pace (2.5-6.5 taps/s), so anyone
  // who really goes for it can beat them
  tap(p, s) {
    if (!s || s.members[0] === p) return;
    const g = this.g;
    if (!p.tapRate || g.now > (p.tapSwitch || 0)) {
      p.tapRate = rand(2.5, 6.5); p.tapOn = Math.random() < 0.65; p.tapSwitch = g.now + rand(2000, 6000);
    }
    if (!p.tapOn) return;
    p.tapAcc = (p.tapAcc || 0) + p.tapRate * 0.05;
    if (p.tapAcc >= 1) { const n = Math.floor(p.tapAcc); p.tapAcc -= n; g.addTaps(p, s, n); }
  }

  // ---------- Chat ----------
  // Hosts chat when something happens to them, plus the odd bit of small talk. Never more than one
  // host message per few seconds overall, and each host only every half minute or more.
  say(p, kind, chance = 1) {
    const g = this.g;
    if (!p || !p.bot || !g.players.has(p.pid) || Math.random() > chance) return;
    if (g.now < this.nextChat || g.now < (p.nextChat || 0)) return;
    const pool = LINES[kind].filter(l => l !== p.lastLine), text = pool[Math.floor(Math.random() * pool.length)];
    p.lastLine = text; p.nextChat = g.now + rand(...CHAT_PERSONAL_MS);
    this.nextChat = g.now + rand(...CHAT_GAP_MS);
    this.queue.push({ at: g.now + rand(600, 2200), pid: p.pid, text }); // a beat to "type"
  }
  chatTick() {
    const g = this.g;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]; if (g.now < q.at) continue;
      this.queue.splice(i, 1);
      if (g.players.has(q.pid)) g.broadcastJson({ t: 'chat', pid: q.pid, text: q.text });
    }
    // Small talk: now and then a random host says something
    if (g.now > this.idleAt) {
      this.idleAt = g.now + 1000;
      const alive = this.slots.map(s => s.player).filter(p => p && g.players.has(p.pid));
      if (alive.length && Math.random() < 0.06) {
        const p = alive[Math.floor(Math.random() * alive.length)], s = g.snakeOf(p);
        this.say(p, s && s.members[0] !== p && s.members.length > 2 && Math.random() < 0.4 ? 'cheer' : 'idle');
      }
    }
  }
  botIn(sid, preferHead) {
    const s = this.g.snakes.find(x => x.id === sid); if (!s) return null;
    if (preferHead && s.members[0].bot) return s.members[0];
    const bots = s.members.filter(p => p.bot);
    return bots.length ? bots[Math.floor(Math.random() * bots.length)] : null;
  }
  onEvent(e) {
    const g = this.g;
    if (e.k === 'turn') this.say(g.players.get(e.head), 'head', 0.5);
    else if (e.k === 'steal') { if (Math.random() < 0.5) this.say(this.botIn(e.thief, true), 'steal', 0.6); else this.say(this.botIn(e.victim), 'stolen', 0.6); }
    else if (e.k === 'boost') this.say(this.botIn(e.sid, true), 'boost', 0.25);
    else if (e.k === 'troll' || e.k === 'break') this.say(this.botIn(e.sid), 'troll', 0.5);
    else if (e.k === 'bite') this.say(this.botIn(e.sid), 'bite', 0.5);
    else if (e.k === 'bossHit') this.say(this.botIn(e.sid), 'bossHit', 0.35);
    else if (e.k === 'token') this.say(g.players.get(e.pid), 'bossToken_' + e.boss, 0.4);
  }
  onBoss(phase, boss) {
    const alive = this.slots.map(s => s.player).filter(p => p && this.g.players.has(p.pid));
    if (!alive.length) return;
    const p = alive[Math.floor(Math.random() * alive.length)];
    this.say(p, phase === 'warning' ? (Math.random() < .6 ? 'bossWarn_' + boss : 'bossWarn') : phase === 'down' ? 'bossDown' : 'bossLeft', 0.8);
  }
  onJoin(p, s) {
    if (p.bot || !s) return;
    const bots = s.members.filter(q => q.bot && q !== p);
    if (bots.length) this.say(bots[Math.floor(Math.random() * bots.length)], 'welcome', 0.35);
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
    // Dodge the Algorithm's warnings (they react a beat late now and then, like people do)
    if (want === null && g.boss.present && Math.random() < 0.85) { const d = g.boss.danger(h); if (d !== null) want = d; }
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
    // While the Algorithm is down, grass is worth chasing
    if (g.boss.present && g.boss.tokens.length && Math.random() < 0.55) {
      let tk = null, gd = 900;
      for (const o of g.boss.tokens) { const p = g.boss.tokenPos(o), d = Math.hypot(p.x - h.x, p.y - h.y); if (d < gd) { gd = d; tk = o; } }
      if (tk) { mind.mode = 'token'; mind.aim = () => (g.boss.tokens.includes(tk) ? g.boss.tokenPos(tk) : null); return; }
    }
    let bolt = null, bd = 500;
    for (const b of g.bolts) { const d = Math.hypot(b.x - h.x, b.y - h.y); if (d < bd) { bd = d; bolt = b; } }
    if (bolt && Math.random() < 0.7) { mind.mode = 'boost'; mind.aim = () => (g.bolts.includes(bolt) ? bolt : null); return; }
    // Wander toward a random point, like someone exploring
    const a = rand(0, TAU), r = Math.sqrt(Math.random()) * g.arenaR * 0.7, pt = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    mind.mode = 'wander'; mind.aim = () => pt;
  }
}

module.exports = { House };
