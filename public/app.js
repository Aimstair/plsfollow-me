(() => {
  'use strict';
  // ---------- Constants ----------
  const TAU = Math.PI * 2, R = 17, HEAD_R = 21, TICK_MS = 50, MAX_EXTRAP_MS = 120;
  let LEAD_MS = 30000, RACE_MS = 10000, BOOT = '';
  // Donation link for the main-screen button. Leave empty to hide the button.
  const DONATE_URL = 'https://buymeacoffee.com/aimstair';
  const PLAT = { ig: 'Instagram', tt: 'TikTok', x: 'X', th: 'Threads', yt: 'YouTube', tw: 'Twitch' };
  const PLAT_DOT = { ig: '#dd2a7b', tt: '#25f4ee', x: '#e7e9ea', th: '#fafafa', yt: '#ff0033', tw: '#9146ff' };
  const PROFILE_URL = {
    ig: h => `https://www.instagram.com/${h}/`, tt: h => `https://www.tiktok.com/@${h}`, x: h => `https://x.com/${h}`, th: h => `https://www.threads.com/@${h}`,
    yt: h => `https://www.youtube.com/@${h}`, tw: h => `https://www.twitch.tv/${h}`,
  };

  // Platform icons: a white glyph on the platform's colored tile. Used on name labels, badges and lists.
  const GLYPH = {
    ig: '<rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16.4" cy="7.6" r="1.15" fill="#fff"/>',
    tt: '<path d="M13.2 4h2.6c.3 1.9 1.5 3.2 3.4 3.5v2.6c-1.3 0-2.4-.4-3.4-1.1v5.6a4.6 4.6 0 1 1-4.6-4.6c.2 0 .5 0 .7.1v2.7a2 2 0 1 0 1.3 1.8z" fill="#fff"/>',
    x: '<path d="M6 5.5h3.6l3 4.2 3.5-4.2h2.1l-4.6 5.5 5.4 7.5h-3.6l-3.3-4.6-3.9 4.6H6.1l5-6z" fill="#fff"/>',
    th: '<path d="M15.6 11.3c-.1-2.3-1.5-3.6-3.6-3.6-1.3 0-2.4.6-3 1.6l1.4.9c.4-.6.9-.9 1.6-.9 1 0 1.6.6 1.8 1.6-2.9-.4-5.2.5-5.2 2.6 0 1.5 1.3 2.6 3 2.6 1.6 0 2.8-.9 3.3-2.4.5.4.8 1 .8 1.8 0 1.5-1.6 3-4.6 3-3.3 0-5.3-2.2-5.3-6.1S7.8 6 11.1 6c2.6 0 4.3 1.1 5 3.3l1.6-.4C16.8 6 14.5 4.4 11.1 4.4 6.8 4.4 4.3 7.2 4.3 12.4s2.5 7.7 6.8 7.7c4 0 6.3-2.1 6.3-4.6 0-1.8-.9-3.2-1.8-4.2zm-4.4 3.9c-.9 0-1.4-.5-1.4-1.1 0-1 1.3-1.5 3.6-1.2-.2 1.4-1 2.3-2.2 2.3z" fill="#fff"/>',
    yt: '<path d="M9.8 8.3v7.4l6.3-3.7z" fill="#fff"/>',
    tw: '<path d="M6.5 5 5.5 7.6v9.6h3.2V19h1.8l1.8-1.8h2.6l3.6-3.6V5zm10.3 7.9-2 2h-3.2l-1.8 1.8v-1.8H7.1V6.5h9.7zm-2-4.3h-1.4v3.9h1.4zm-3.8 0H9.6v3.9H11z" fill="#fff"/>',
  };
  const TILE = { ig: 'url(#igg)', tt: '#0b0b0f', x: '#0b0f14', th: '#000', yt: '#ff0033', tw: '#9146ff' };
  const iconSvg = (p, size = 16) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">` +
    (p === 'ig' ? '<defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f58529"/><stop offset=".5" stop-color="#dd2a7b"/><stop offset="1" stop-color="#8134af"/></linearGradient></defs>' : '') +
    `<rect width="24" height="24" rx="6.5" fill="${TILE[p] || '#555'}"/>${p === 'tt' || p === 'x' || p === 'th' ? '<rect x=".5" y=".5" width="23" height="23" rx="6" fill="none" stroke="rgba(255,255,255,.28)"/>' : ''}${GLYPH[p] || ''}</svg>`;
  // Canvas copies of the icons (drawn as images)
  const iconImg = {};
  for (const p of Object.keys(GLYPH)) { const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(p, 48)); iconImg[p] = im; }
  const iconReady = p => iconImg[p] && iconImg[p].complete && iconImg[p].naturalWidth;
  // DOM badge: icon + platform name (both from fixed constants, never user text)
  function setPlatBadge(el, p) { el.dataset.plat = p; el.innerHTML = iconSvg(p, 14) + '<span>' + PLAT[p] + '</span>'; }

  const cv = document.getElementById('game'), ctx = cv.getContext('2d');
  const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
  const $ = id => document.getElementById(id);
  const sfx = name => window.PFAudio && PFAudio.play(name);
  let W = 0, H = 0, DPR = 1;
  function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; }
  resize(); addEventListener('resize', resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // ---------- Sprites (pre-rendered once, drawn many times) ----------
  const cache = new Map();
  function sprite(key, size, paint) {
    let c = cache.get(key);
    if (!c) {
      if (cache.size > 3000) cache.clear();
      c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size); cache.set(key, c);
    }
    return c;
  }
  // Glossy candy bead
  const bead = (hue, sat = 88, lit = 60) => sprite(`b${hue}|${sat}|${lit}`, 72, (g, S) => {
    const c = S / 2, r = S / 2 - 2;
    const grd = g.createRadialGradient(c - r * .3, c - r * .35, r * .05, c, c, r);
    grd.addColorStop(0, `hsl(${hue},${sat}%,${Math.min(96, lit + 28)}%)`);
    grd.addColorStop(.5, `hsl(${hue},${sat}%,${lit}%)`);
    grd.addColorStop(1, `hsl(${hue},${sat}%,${Math.max(10, lit - 26)}%)`);
    g.fillStyle = grd; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
    g.strokeStyle = `hsla(${hue},100%,88%,.45)`; g.lineWidth = 2.5;
    g.beginPath(); g.arc(c, c, r - 3, Math.PI * .25, Math.PI * .75); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.beginPath(); g.ellipse(c - r * .32, c - r * .42, r * .3, r * .15, -.55, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); g.arc(c - r * .05, c - r * .55, r * .06, 0, TAU); g.fill();
  });
  const glow = (rgb) => sprite(`g${rgb}`, 128, (g, S) => {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, `rgba(${rgb},.9)`); grd.addColorStop(.35, `rgba(${rgb},.35)`); grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  });
  const hueOf = pid => Math.round(((pid * 137.508) % 360) / 12) * 12;
  const snakeHue = id => (id * 83 + 190) % 360;
  // Avatars bake in the display font, so re-render them once it has loaded
  if (document.fonts) document.fonts.ready.then(() => { for (const k of [...cache.keys()]) if (k[0] === 'a') cache.delete(k); });

  // ---------- Profiles ----------
  const profiles = new Map();
  const setProfile = ([pid, handle, platform, img, host]) => profiles.set(pid, { pid, handle, platform, img: !!img, host: !!host, image: null });
  const handleOf = pid => (profiles.get(pid) || {}).handle || null;
  const platOf = pid => (profiles.get(pid) || {}).platform || 'ig';
  const name = pid => pid === myPid ? 'You' : handleOf(pid) ? '@' + handleOf(pid) : 'Anonymous';
  const photoUrl = pid => (profiles.get(pid) || {}).img ? `/a/${BOOT}/${pid}` : null;
  function photo(pid) {
    const p = profiles.get(pid); if (!p || !p.img) return null;
    if (!p.image) { p.image = new Image(); p.image.decoding = 'async'; p.image.src = photoUrl(pid); }
    return p.image.complete && p.image.naturalWidth ? p.image : null;
  }

  // ---------- World state from the server ----------
  let now = performance.now();
  let myPid = 0, view = null, me = null, mine = null, myIdx = -1;
  const snaps = [];
  const shake = { a: 0 };
  const stats = { led: 0, opens: 0, best: 0, biggestLed: 0 }; // for the share card
  let spot = null, lastHeadPid = 0;

  function decode(buf) {
    const v = new DataView(buf); let o = 1;
    const st = v.getFloat64(o, true); o += 8;
    const arenaR = v.getUint16(o, true); o += 2;
    const humans = v.getUint16(o, true); o += 2;
    const nb = v.getUint8(o); o += 1;
    const bolts = [];
    for (let i = 0; i < nb; i++) { bolts.push({ x: v.getInt16(o, true), y: v.getInt16(o + 2, true) }); o += 4; }
    const nt = v.getUint8(o); o += 1;
    const trolls = [];
    for (let i = 0; i < nt; i++) { trolls.push({ x: v.getInt16(o, true), y: v.getInt16(o + 2, true), angle: v.getUint8(o + 4) / 255 * TAU, cool: !!(v.getUint8(o + 5) & 1) }); o += 6; }
    const ns = v.getUint16(o, true); o += 2;
    const snakes = [], pos = new Map(), byId = new Map();
    for (let i = 0; i < ns; i++) {
      const s = { id: v.getUint16(o, true), left: v.getUint16(o + 4, true) * 10, boost: !!(v.getUint8(o + 6) & 1), turn: v.getUint8(o + 7), angle: v.getInt16(o + 8, true) / 5000, members: [] };
      const len = v.getUint16(o + 2, true); o += 10;
      for (let k = 0; k < len; k++) {
        const m = { x: v.getInt16(o, true), y: v.getInt16(o + 2, true), pid: v.getUint32(o + 4, true) }; o += 8;
        s.members.push(m); pos.set(m.pid, m);
      }
      snakes.push(s); byId.set(s.id, s);
    }
    return { st, arenaR, humans, bolts, trolls, snakes, pos, byId };
  }

  // Smooth playback: render a little behind the newest server time, by an amount that adapts to how
  // jittery this connection is. Interpolate between the two snapshots around that moment, and if the
  // next one is late, keep moving along the last velocity for a short while instead of freezing.
  const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
  function buildView() {
    const n = snaps.length; if (!n) return null;
    const rst = performance.now() + offset - net.behind;
    let a = snaps[0], b = a;
    if (n > 1) {
      if (rst >= snaps[n - 1].st) { a = snaps[n - 2]; b = snaps[n - 1]; }
      else for (let i = n - 2; i >= 0; i--) if (snaps[i].st <= rst) { a = snaps[i]; b = snaps[i + 1]; break; }
    }
    const span = b.st - a.st;
    const k = span > 0 ? Math.max(0, Math.min(1 + MAX_EXTRAP_MS / span, (rst - a.st) / span)) : 0;
    const mix = (p, m) => (!p || Math.abs(p.x - m.x) > 200 || Math.abs(p.y - m.y) > 200) ? { x: m.x, y: m.y } : { x: p.x + (m.x - p.x) * k, y: p.y + (m.y - p.y) * k };
    const snakes = b.snakes.map(s => {
      const sa = a.byId.get(s.id);
      return {
        id: s.id, turn: s.turn, boost: s.boost, angle: sa ? lerpAng(sa.angle, s.angle, k) : s.angle,
        left: Math.max(0, Math.min(LEAD_MS, s.left - (rst - b.st))),
        members: s.members.map(m => { const q = mix(a.pos.get(m.pid), m); q.pid = m.pid; return q; }),
      };
    });
    const sameTrolls = a.trolls.length === b.trolls.length;
    const trolls = b.trolls.map((t, i) => { const q = mix(sameTrolls ? a.trolls[i] : null, t); q.angle = sameTrolls ? lerpAng(a.trolls[i].angle, t.angle, Math.min(1, k)) : t.angle; q.cool = t.cool; return q; });
    return { snakes, trolls, bolts: b.bolts, humans: b.humans, arenaR: a.arenaR + (b.arenaR - a.arenaR) * Math.min(1, k) };
  }

  // Where am I in the newest snapshot (events arrive before the state of the same tick)
  function latestPlace() {
    const s = snaps.length && snaps[snaps.length - 1];
    if (!s || !myPid) return { sid: 0, idx: -1 };
    for (const sn of s.snakes) { const i = sn.members.findIndex(m => m.pid === myPid); if (i >= 0) return { sid: sn.id, idx: i, snake: sn }; }
    return { sid: 0, idx: -1 };
  }

  // ---------- Network ----------
  let ws = null, retry = 0, joinInfo = null, offset = 0, offsetTarget = 0, bestRtt = Infinity, clockReady = false;
  // base: fastest recent arrival delay; jitter: decaying peak of extra delay; behind: smoothed render delay
  const net = { base: Infinity, jitter: 30, behind: 160 };
  const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      retry = 0; bestRtt = Infinity; clockReady = false; snaps.length = 0; net.base = Infinity; net.jitter = 30;
      for (let i = 0; i < 6; i++) setTimeout(() => send({ t: 'sync', c: performance.now() }), i * 250);
      if (joinInfo) send({ t: 'join', ...joinInfo });
    };
    ws.onmessage = e => { if (typeof e.data === 'string') onJson(JSON.parse(e.data)); else onState(e.data); };
    ws.onclose = () => {
      myPid = 0; me = mine = null; closeRace();
      setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
    };
  }
  setInterval(() => send({ t: 'sync', c: performance.now() }), 15000);
  // Heartbeat so the server knows we're here (heads also send steering below)
  setInterval(() => { if (myPid && !document.hidden) send({ t: 'hb' }); }, 2000);

  function onState(buf) {
    const d = decode(buf);
    if (!clockReady) { snaps.length = 0; snaps.push(d); offset = offsetTarget = d.st - performance.now(); return; }
    const late = performance.now() + offset - d.st;
    net.base = Math.min(late, net.base + 0.3); // slowly forgets old best case so it can follow a slower route
    net.jitter = Math.max(late - net.base, net.jitter * 0.985);
    snaps.push(d);
    const keepFrom = performance.now() + offset - net.behind - 600;
    while (snaps.length > 2 && snaps[1].st < keepFrom) snaps.shift();
    if (snaps.length > 60) snaps.shift();
  }
  function smoothNet(dt) {
    offset += (offsetTarget - offset) * Math.min(1, dt * 2);
    const want = Math.max(70, Math.min(400, (isFinite(net.base) ? net.base : 0) + TICK_MS + net.jitter + 15));
    net.behind += (want - net.behind) * Math.min(1, dt * (want > net.behind ? 4 : 0.8)); // grow fast, shrink slowly
  }

  function onJson(m) {
    switch (m.t) {
      case 'hello': BOOT = m.boot; LEAD_MS = m.cfg.LEAD_MS; RACE_MS = m.cfg.RACE_MS; profiles.clear(); cache.clear(); break;
      case 'prof': m.l.forEach(setProfile); liveDirty = true; break;
      case 'bye': profiles.delete(m.pid); bubbles.delete(m.pid); liveDirty = true; break;
      case 'fame': renderFame(m.top); break;
      case 'chat': onChat(m); break;
      case 'you': myPid = m.pid; onJoined(); break;
      case 'out': knockedOut(m.why); break;
      case 'err': joinInfo = null; $('intro').hidden = false; $('bottom').hidden = true; $('joinErr').textContent = m.msg; $('joinErr').hidden = false; $('joinBtn').disabled = false; break;
      case 'sync': {
        const t = performance.now(), rtt = t - m.c;
        if (rtt <= bestRtt * 1.25 + 5) {
          bestRtt = Math.min(bestRtt, rtt); offsetTarget = m.s - (m.c + rtt / 2);
          if (!clockReady) { clockReady = true; offset = offsetTarget; snaps.length = 0; net.base = Infinity; }
        }
        break;
      }
      case 'ev': m.l.forEach(onEvent); break;
      case 'raceOpen': raceOk.add(keyOf(m.sid, m.turn)); break;
      case 'race': onRaceBoard(m); break;
      case 'tapr': onTapResult(m); break;
      case 'opened':
        if (spot) {
          spot.opens += m.n; sfx('opened');
          toast(`🔔 Someone opened your ${PLAT[platOf(myPid)]}`);
          if (me) burst(me.x, me.y - 30, 10, ['#ffc93c', '#fff'], { speed: 160, life: 600, size: 3 });
        }
        break;
    }
  }

  function headPos(sid) {
    const s = snaps.length && snaps[snaps.length - 1].byId.get(sid);
    return s && s.members[0];
  }
  function onEvent(e) {
    const me0 = latestPlace();
    if (e.k === 'boost') {
      burst(e.x, e.y, 26, ['#7dd3fc', '#e0f7ff', '#38bdf8'], { speed: 300, life: 600, size: 4 });
      if (e.sid === me0.sid && me0.idx === 0) { toast('⚡ Speed boost! Go steal someone.', true); shake.a = 6; sfx('boost'); }
    } else if (e.k === 'bite') {
      burst(e.x, e.y, 30, ['#ffffff', '#cfe8ff', '#ffc93c'], { speed: 340, life: 700, size: 5 });
      if (e.sid === me0.sid) { shake.a = 12; sfx('crash'); toast(me0.idx >= e.k2 ? '💥 The snake bit itself. You are in a new snake!' : `💥 The snake bit itself and lost ${e.n} people!`); }
    } else if (e.k === 'steal') {
      burst(e.x, e.y, 30, ['#ff5fa2', '#ffc93c', '#fff'], { speed: 320, life: 750, size: 5 });
      if (e.victim === me0.sid && me0.idx >= e.k2) { shake.a = 12; sfx('lost'); toast(`🫳 Another snake stole you (and ${e.n - 1} others)!`); }
      else if (e.thief === me0.sid) { sfx('gain'); toast(`😈 Your snake stole ${e.n} people!`); }
      else if (e.victim === me0.sid) { shake.a = 16; sfx('crash'); sfx('lost'); knockFx(e.hx, e.hy); toast(`😱 Your snake lost ${e.n} people to a thief!`); }
      if (e.victim !== me0.sid) knockFx(e.hx, e.hy, true);
    } else if (e.k === 'clash') {
      burst(e.x, e.y, 34, ['#fb923c', '#ffc93c', '#fff'], { speed: 380, life: 700, size: 5 });
      if (e.victim === myPid) { shake.a = 14; sfx('crash'); toast('🐍 Head-on crash! A bigger snake captured you.'); }
      else if (e.win === me0.sid) { sfx('gain'); toast(`🥊 Head-on crash! Your snake captured ${name(e.victim)}`); }
      else if (e.lose === me0.sid) { shake.a = 10; sfx('crash'); toast(`🥊 Your head ${name(e.victim)} got captured by a bigger snake!`); }
    } else if (e.k === 'troll') {
      burst(e.x, e.y, 28, ['#a855f7', '#f0abfc', '#ff5f7e'], { speed: 300, life: 650, size: 5 });
      if (e.sid === me0.sid) {
        shake.a = e.head === myPid ? 12 : 6; sfx('troll');
        toast(e.head === myPid ? `👹 A troll bumped you: −${e.ms / 1000}s of your turn!` : `👹 A troll bumped the head: −${e.ms / 1000}s. The race comes sooner!`);
      }
    } else if (e.k === 'bump') {
      burst(e.x, e.y, 30, ['#ffc93c', '#ff5f7e', '#fff'], { speed: 340, life: 650, size: 5 });
      if (e.a === myPid || e.b === myPid) { shake.a = 12; sfx('crash'); toast(`💥 Head bump with ${name(e.a === myPid ? e.b : e.a)}! −${e.ms / 1000}s for both of you`); }
    } else if (e.k === 'absorb') {
      burst(e.x, e.y, 26, ['#ff5fa2', '#ffc93c', '#fff'], { speed: 300, life: 700, size: 5 });
      if (e.victim === myPid) { shake.a = 10; sfx('lose'); toast(`⏱ Out of time! ${name(e.by)} bumped you, so you're in their tail now.`); }
      else if (e.by === myPid) { sfx('gain'); toast(`🐍 ${name(e.victim)} ran out of time and joined your tail!`, true); }
    } else if (e.k === 'out') {
      burst(e.x, e.y, 46, ['#a855f7', '#f0abfc', '#ff5f7e', '#fff'], { speed: 420, life: 900, size: 6 });
    } else if (e.k === 'break') {
      burst(e.x, e.y, 34, ['#a855f7', '#f0abfc', '#fff'], { speed: 360, life: 750, size: 5 });
      if (e.sid === me0.sid) { shake.a = 12; sfx('troll'); sfx('crash'); toast(me0.idx >= e.k2 ? "👹 A troll broke the snake. You're in a new snake now!" : `👹 A troll broke ${e.n} people off your snake!`); }
    } else if (e.k === 'turn') {
      const h = headPos(e.sid);
      if (h && e.head !== myPid) confetti(h.x, h.y, 22);
      if (e.sid !== me0.sid) return;
      if (e.head !== myPid) sfx('turn');
      if (e.prev === myPid && e.head !== myPid) toast(e.why === 'afk' ? 'You went quiet, so the next person took over.' : 'Your 30 seconds are up. Back to the tail!');
      // You raced this turn and someone else got the crown
      if (myEntry && myEntry.sid === e.sid && e.head !== myPid) sfx('lose');
      myEntry = null;
      if (e.taps && e.head !== myPid) toast(`⚔️ ${name(e.head)} won the tap race with ${e.taps} taps and is the new head`);
    }
  }

  // ---------- Particles ----------
  const parts = [];
  function burst(x, y, n, colors, { speed = 260, life = 800, size = 4, grav = 0, drag = 0.92 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(.35, 1) * speed;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: rand(.6, 1.2) * size, color: pick(colors), grav, drag, rot: rand(0, TAU), vr: rand(-8, 8), sq: Math.random() < .5 });
    }
    if (parts.length > 1200) parts.splice(0, parts.length - 1200);
  }
  // Knockback: a shockwave ring plus sparks where the robbed head got shoved
  const rings = [];
  function knockFx(x, y, quiet) {
    if (x == null) return;
    rings.push({ x, y, at: now, quiet });
    burst(x, y, quiet ? 12 : 24, ['#ffffff', '#ff5f7e', '#ffc93c'], { speed: quiet ? 260 : 380, life: 500, size: 4 });
  }
  function drawRings() {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i], t = (now - r.at) / 450;
      if (t >= 1) { rings.splice(i, 1); continue; }
      ctx.globalAlpha = (1 - t) * (r.quiet ? .45 : .85);
      ctx.beginPath(); ctx.arc(r.x, r.y, 20 + t * (r.quiet ? 50 : 90), 0, TAU);
      ctx.lineWidth = (1 - t) * 6 + 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const confetti = (x, y, n) => burst(x, y, n, ['#ffc93c', '#ff5fa2', '#7dd3fc', '#a78bfa', '#34d399', '#fff'], { speed: 360, life: 1200, size: 6, grav: 260, drag: .95 });
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt * 1000; if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60); p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
  }
  const motes = Array.from({ length: 90 }, () => { const a = rand(0, TAU), r = Math.sqrt(Math.random()); return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: rand(1, 2.6), ph: rand(0, TAU) }; });

  // ---------- Input ----------
  let pointer = null; const keys = {};
  addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerdown', e => {
    pointer = { x: e.clientX, y: e.clientY };
    if (!mine || myIdx !== 0) peekAt(e.clientX, e.clientY);
  });
  const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
  addEventListener('keydown', e => {
    if (typing(e)) return;
    keys[e.key] = true;
    if (race && !$('duel').hidden && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) padPress(); return; }
    if (e.key === 'Enter' && myPid && $('intro').hidden && $('shareModal').hidden) { e.preventDefault(); openChat(); }
  });
  addEventListener('keyup', e => { keys[e.key] = false; });

  const cam = { x: 0, y: 0, z: 1 };
  const toScreen = (x, y) => ({ x: (x - cam.x) * cam.z + W / 2, y: (y - cam.y) * cam.z + H / 2 });

  // Steering goes to the server 20 times a second while you're the head. Keys send a turn direction
  // (the server turns from the live angle); the mouse/finger sends the angle to point at.
  setInterval(() => {
    if (!me || myIdx !== 0 || document.hidden) return;
    if (keys.ArrowLeft || keys.a) { pointer = null; send({ t: 'k', d: -1 }); return; }
    if (keys.ArrowRight || keys.d) { pointer = null; send({ t: 'k', d: 1 }); return; }
    if (pointer) {
      const s = toScreen(me.x, me.y);
      if (Math.hypot(pointer.x - s.x, pointer.y - s.y) > 12) { send({ t: 'a', a: +Math.atan2(pointer.y - s.y, pointer.x - s.x).toFixed(3) }); return; }
    }
    send({ t: 'k', d: 0 }); // no input: keep going straight
  }, 50);

  // ---------- Tap race for next head ----------
  // In the leader's last 10 seconds, everyone who was in the snake when it opened taps as fast as they
  // can. Most taps when the timer runs out leads next. Taps go to the server in small batches.
  let race = null, raceTop = null, tapTimer = 0;
  const raceOk = new Set(); // races we're in (we were in the snake when it opened)
  const hiddenRace = new Set(); // races whose pop-up we closed (still racing via the race bar)
  let myEntry = null; // we tapped in the current turn's race (for the "you lost" sound)
  const keyOf = (sid, turn) => `${sid}:${turn}`;
  const raceOn = s => s.members.length > 1;     // the tap race runs the whole turn
  const lastStretch = s => s.left <= RACE_MS;   // final seconds: the head's timer ring flashes
  function openRace(s) {
    const key = keyOf(s.id, s.turn);
    hiddenRace.delete(key);
    if (!race || race.key !== key) {
      race = { key, sid: s.id, turn: s.turn, count: 0, unsent: 0, wasFirst: false };
      $('duelResult').textContent = 'Go go go!';
      const pad = $('pad'); pad.className = 'go'; pad.textContent = 'TAP!'; pad.disabled = false;
      sfx('go');
      clearInterval(tapTimer); tapTimer = setInterval(flushTaps, 150);
    }
    $('duelHint').textContent = 'Tap anywhere, as fast as you can! Most taps when the timer runs out leads next.';
    $('duel').hidden = false; $('pad').focus();
  }
  function padPress(x, y) {
    if (!race) return;
    race.count++; race.unsent++;
    const pad = $('pad'); pad.textContent = race.count;
    pad.classList.remove('bump'); void pad.offsetWidth; pad.classList.add('bump');
    if (window.PFAudio) PFAudio.tap(race.count);
    myEntry = { sid: race.sid };
    // "+1" and a ripple where the finger landed (or on the counter, for keyboard taps)
    if (x == null) { const r = pad.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height * .3; }
    const layer = $('tapfx');
    while (layer.childElementCount > 40) layer.firstChild.remove();
    const ring = document.createElement('i'); ring.className = 'ring'; ring.style.left = x + 'px'; ring.style.top = y + 'px';
    const plus = document.createElement('b'); plus.textContent = '+1'; plus.style.left = x + (Math.random() * 24 - 12) + 'px'; plus.style.top = y + 'px';
    plus.style.setProperty('--h', `${(race.count * 23) % 360}`);
    layer.append(ring, plus);
    setTimeout(() => { ring.remove(); plus.remove(); }, 700);
    if (race.count % 10 === 0) { pad.classList.remove('combo'); void pad.offsetWidth; pad.classList.add('combo'); }
  }
  // During the race the whole screen is the button
  $('duel').addEventListener('pointerdown', e => {
    if (e.target.closest('#duelClose')) return;
    e.preventDefault(); padPress(e.clientX, e.clientY);
  });
  $('duelClose').addEventListener('click', () => { if (race) { hiddenRace.add(race.key); flushTaps(); } $('duel').hidden = true; });
  function flushTaps() {
    if (race && race.unsent) { send({ t: 'taps', sid: race.sid, turn: race.turn, n: race.unsent }); race.unsent = 0; }
  }
  function onRaceBoard(m) {
    raceTop = m;
    if (typeof m.mine === 'number') stats.best = Math.max(stats.best, m.mine);
    if (!race || keyOf(m.sid, m.turn) !== race.key) return;
    const first = m.top[0], mineN = typeof m.mine === 'number' ? m.mine : 0, amFirst = first && first[0] === myPid;
    if (amFirst && !race.wasFirst) sfx('win');
    race.wasFirst = amFirst;
    $('duelResult').textContent = amFirst ? `👑 You're in first with ${first[1]} taps!` : first ? `You: ${mineN} · 1st: ${name(first[0])} with ${first[1]}` : 'Go go go!';
  }
  function onTapResult(m) {
    if (m.why === 'late') $('duelResult').textContent = "This race started before you arrived. You're in the next one!";
  }
  function closeRace() { flushTaps(); clearInterval(tapTimer); $('duel').hidden = true; race = null; }

  // ---------- Peek + follow ----------
  let peekFor = 0, peekTimer = 0;
  function peekAt(sx, sy) {
    if (!view) return;
    let best = null, bd = 24;
    for (const s of view.snakes) for (const p of s.members) {
      const q = toScreen(p.x, p.y), d = Math.hypot(q.x - sx, q.y - sy);
      if (d < bd) { bd = d; best = p; }
    }
    const el = $('peek');
    if (!best || best.pid === myPid) { el.hidden = true; return; }
    peekFor = best.pid;
    const h = handleOf(best.pid), url = photoUrl(best.pid);
    $('peekAva').textContent = url ? '' : h ? h[0].toUpperCase() : '?';
    $('peekAva').style.setProperty('--c', `hsl(${hueOf(best.pid)},85%,62%)`);
    $('peekAva').style.backgroundImage = url ? `url("${url}")` : '';
    $('peekAva').style.backgroundSize = url ? 'cover' : '';
    $('peekHandle').textContent = name(best.pid);
    $('peekPlat').hidden = !h; setPlatBadge($('peekPlat'), platOf(best.pid));
    $('peekFollow').hidden = !h; $('peekFollow').dataset.plat = platOf(best.pid);
    el.hidden = false;
    el.style.left = Math.min(W - 276, Math.max(16, sx - 130)) + 'px';
    el.style.top = Math.min(H - 80, Math.max(16, sy + 22)) + 'px';
    clearTimeout(peekTimer); peekTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }
  // Following happens in the real app: we open the profile and count the open
  function follow(pid) {
    const h = handleOf(pid); if (!h) return;
    send({ t: 'open', pid });
    const url = (PROFILE_URL[platOf(pid)] || PROFILE_URL.ig)(encodeURIComponent(h));
    window.open(url, '_blank', 'noopener');
  }
  $('peekFollow').addEventListener('click', () => follow(peekFor));
  $('spotFollow').addEventListener('click', e => { e.stopPropagation(); if (mine) follow(mine.members[0].pid); });

  // ---------- Chat ----------
  // Messages show as speech bubbles above the sender's segment for a few seconds
  const bubbles = new Map();
  function onChat(m) {
    bubbles.set(m.pid, { text: m.text, at: now, until: now + Math.min(8000, 3500 + m.text.length * 60) });
    if (view) for (const s of view.snakes) for (const p of s.members) if (p.pid === m.pid) { const q = toScreen(p.x, p.y); if (q.x > 0 && q.y > 0 && q.x < W && q.y < H) sfx('chat'); return; }
  }
  function openChat() {
    if (!myPid) return;
    $('chatBar').hidden = false; $('chatIn').value = ''; $('chatIn').focus();
  }
  function closeChat() { $('chatBar').hidden = true; $('chatIn').blur(); for (const k in keys) keys[k] = false; }
  $('chatBar').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('chatIn').value.trim();
    if (text) send({ t: 'chat', text });
    closeChat();
  });
  $('chatIn').addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });
  $('chatIn').addEventListener('blur', () => setTimeout(() => { if (!$('chatIn').value.trim()) $('chatBar').hidden = true; }, 150));
  $('chatBtn').addEventListener('click', () => { if (!$('chatBar').hidden) closeChat(); else if (myPid) openChat(); else toast('Join the snake to chat'); });

  function wrapLines(text, maxW, maxLines) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
    // Single words longer than the bubble get cut with an ellipsis
    return lines.map(l => { if (ctx.measureText(l).width <= maxW) return l; while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); return l + '…'; });
  }
  function drawBubbles() {
    if (!bubbles.size) return;
    const where = new Map();
    for (const s of view.snakes) s.members.forEach((p, i) => { if (bubbles.has(p.pid)) where.set(p.pid, { p, head: i === 0 }); });
    ctx.font = '700 13.5px Figtree, system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    // Lay out every bubble first, then nudge overlapping ones upward so nearby speakers stack
    const items = [];
    for (const [pid, b] of bubbles) {
      if (now > b.until) { bubbles.delete(pid); continue; }
      const w = where.get(pid); if (!w) continue;
      const q = toScreen(w.p.x, w.p.y);
      const lift = w.head ? (HEAD_R + 56) * cam.z + 14 : (R + 6) * cam.z + 8;
      const lines = wrapLines(b.text, 200, 3), lh = 18;
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 24, bh = lines.length * lh + 14;
      items.push({ pid, b, q, lines, lh, bw, bh, x: Math.max(8 + bw / 2, Math.min(W - 8 - bw / 2, q.x)), y: q.y - lift - bh });
    }
    items.sort((a, b) => b.y - a.y);
    const placed = [];
    for (const it of items) {
      for (let moved = true, guard = 0; moved && guard < 20; guard++) {
        moved = false;
        for (const o of placed) {
          if (Math.abs(it.x - o.x) < (it.bw + o.bw) / 2 + 4 && it.y < o.y + o.bh + 4 && it.y + it.bh > o.y - 4) { it.y = o.y - it.bh - 6; moved = true; }
        }
      }
      placed.push(it);
    }
    for (const { pid, b, q, lines, lh, bw, bh, x, y } of items) {
      if (y + bh < -20 || y > H + 20) continue;
      const age = now - b.at, life = b.until - now;
      const pop = Math.min(1, age / 160), alpha = Math.min(1, life / 400);
      const mineB = pid === myPid;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.translate(x, y + bh); ctx.scale(.85 + .15 * pop, .85 + .15 * pop); ctx.translate(-x, -(y + bh));
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.roundRect(x - bw / 2, y + 3, bw, bh, 14); ctx.fill();
      ctx.fillStyle = mineB ? '#ff5fa2' : 'rgba(250,252,255,.97)';
      ctx.beginPath(); ctx.roundRect(x - bw / 2, y, bw, bh, 14); ctx.fill();
      // little tail pointing toward the speaker
      const tx = Math.max(x - bw / 2 + 14, Math.min(x + bw / 2 - 14, q.x));
      ctx.beginPath(); ctx.moveTo(tx - 7, y + bh - 1); ctx.lineTo(tx, y + bh + 8); ctx.lineTo(tx + 7, y + bh - 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = mineB ? '#2a0614' : '#0b1220';
      lines.forEach((l, i) => ctx.fillText(l, x, y + 7 + lh / 2 + i * lh + .5));
      ctx.restore();
    }
  }

  // ---------- Rendering ----------
  function inView(x, y, pad) {
    const hw = W / cam.z / 2 + pad, hh = H / cam.z / 2 + pad;
    return Math.abs(x - cam.x) < hw && Math.abs(y - cam.y) < hh;
  }
  function polyline(m) { ctx.beginPath(); ctx.moveTo(m[0].x, m[0].y); for (let i = 1; i < m.length; i++) ctx.lineTo(m[i].x, m[i].y); }

  function drawArena(AR) {
    const fl = ctx.createRadialGradient(0, 0, 0, 0, 0, AR);
    fl.addColorStop(0, '#173252'); fl.addColorStop(.7, '#112640'); fl.addColorStop(1, '#0c1b30');
    ctx.beginPath(); ctx.arc(0, 0, AR, 0, TAU); ctx.fillStyle = fl; ctx.fill();
    ctx.save(); ctx.clip();
    const step = 64, vw = W / cam.z / 2 + step, vh = H / cam.z / 2 + step;
    ctx.fillStyle = 'rgba(125,180,230,.13)';
    for (let gy = Math.floor((cam.y - vh) / step) * step; gy < cam.y + vh; gy += step) {
      const off = (Math.round(gy / step) & 1) ? step / 2 : 0;
      for (let gx = Math.floor((cam.x - vw) / step) * step + off; gx < cam.x + vw; gx += step) { ctx.beginPath(); ctx.arc(gx, gy, 2.2, 0, TAU); ctx.fill(); }
    }
    for (const m of motes) {
      const x = m.x * AR + Math.sin(now / 3000 + m.ph) * 20, y = m.y * AR + Math.cos(now / 3700 + m.ph) * 20;
      if (!inView(x, y, 20)) continue;
      ctx.globalAlpha = .25 + .2 * Math.sin(now / 900 + m.ph);
      ctx.fillStyle = '#bfe3ff'; ctx.beginPath(); ctx.arc(x, y, m.s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    for (const [w, a] of [[46, .05], [26, .08], [12, .14]]) { ctx.beginPath(); ctx.arc(0, 0, AR + 6, 0, TAU); ctx.lineWidth = w; ctx.strokeStyle = `rgba(56,189,248,${a})`; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(0, 0, AR + 6, 0, TAU); ctx.lineWidth = 8; ctx.strokeStyle = '#1d4f73'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, AR + 2, 0, TAU); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(125,211,252,.55)'; ctx.stroke();
    ctx.strokeStyle = 'rgba(125,211,252,.35)'; ctx.lineWidth = 3;
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * TAU, x = Math.cos(a), y = Math.sin(a);
      if (!inView(x * AR, y * AR, 30)) continue;
      const len = i % 10 === 0 ? 18 : 8;
      ctx.beginPath(); ctx.moveTo(x * (AR + 12), y * (AR + 12)); ctx.lineTo(x * (AR + 12 + len), y * (AR + 12 + len)); ctx.stroke();
    }
  }

  function drawBolt(b) {
    if (!inView(b.x, b.y, 60)) return;
    const ph = b.x * .013 + b.y * .007, bob = Math.sin(now / 420 + ph) * 4, rot = now / 1100 + ph, x = b.x, y = b.y + bob;
    ctx.globalAlpha = .55 + .2 * Math.sin(now / 300 + ph);
    ctx.drawImage(glow('56,189,248'), x - 55, y - 55, 110, 110);
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 22 - bob, 13, 4, 0, 0, TAU); ctx.fill();
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16); }
    ctx.closePath();
    const g = ctx.createLinearGradient(-16, -16, 16, 16); g.addColorStop(0, '#e0f7ff'); g.addColorStop(.5, '#7dd3fc'); g.addColorStop(1, '#0284c7');
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#f0fbff'; ctx.stroke();
    ctx.rotate(-rot);
    ctx.beginPath(); ctx.moveTo(2.5, -10); ctx.lineTo(-6, 1.5); ctx.lineTo(-.5, 1.5); ctx.lineTo(-2.5, 10); ctx.lineTo(6, -1.5); ctx.lineTo(.5, -1.5); ctx.closePath();
    ctx.fillStyle = '#073b56'; ctx.fill();
    ctx.restore();
  }

  // Troll: a horned purple gremlin with angry eyes that look where it's heading
  const trollBody = () => sprite('troll', 96, (g, S) => {
    const c = S / 2, r = 30;
    g.fillStyle = '#3b0764';
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(c + sx * 12, c - 22); g.lineTo(c + sx * 26, c - 40); g.lineTo(c + sx * 24, c - 16); g.closePath(); g.fill(); }
    const grd = g.createRadialGradient(c - 9, c - 11, 3, c, c, r);
    grd.addColorStop(0, '#d8b4fe'); grd.addColorStop(.45, '#a855f7'); grd.addColorStop(1, '#581c87');
    g.fillStyle = grd; g.beginPath();
    for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU, rr = r + (i % 2 ? 0 : 3); g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr); }
    g.closePath(); g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#2e1065'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(c - 10, c - 14, 8, 4, -.5, 0, TAU); g.fill();
    g.strokeStyle = '#2e1065'; g.lineWidth = 2.5; g.lineJoin = 'round'; g.beginPath();
    g.moveTo(c - 11, c + 12); g.lineTo(c - 6, c + 8); g.lineTo(c - 2, c + 12); g.lineTo(c + 2, c + 8); g.lineTo(c + 6, c + 12); g.lineTo(c + 11, c + 8); g.stroke();
  });
  function drawTroll(t) {
    if (!inView(t.x, t.y, 60)) return;
    const bob = Math.sin(now / 180 + t.x * .01) * 2, x = t.x, y = t.y + bob, S = 46;
    ctx.globalAlpha = t.cool ? .25 : .5 + .15 * Math.sin(now / 220);
    ctx.drawImage(glow(t.cool ? '168,85,247' : '255,60,110'), x - 50, y - 50, 100, 100);
    ctx.globalAlpha = t.cool ? .6 : 1;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 20 - bob, 15, 4.5, 0, 0, TAU); ctx.fill();
    ctx.drawImage(trollBody(), x - S / 2, y - S / 2, S, S);
    const lx = Math.cos(t.angle) * 2.2, ly = Math.sin(t.angle) * 2.2;
    for (const sx of [-1, 1]) {
      const ex = x + sx * 6.5, ey = y - 4;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex, ey, 4.6, 5.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = t.cool ? '#6b21a8' : '#e11d48'; ctx.beginPath(); ctx.arc(ex + lx, ey + ly, 2.3, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2e1065'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - sx * 5, ey - 9); ctx.lineTo(ex + sx * 3.5, ey - 5.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawCrown(x, y, s, tilt, c = ctx) {
    c.save(); c.translate(x, y); c.rotate(tilt); c.scale(s, s);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(0, 9, 12, 2.5, 0, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(-12, 6); c.lineTo(-13.5, -6); c.lineTo(-6, 0); c.lineTo(0, -11); c.lineTo(6, 0); c.lineTo(13.5, -6); c.lineTo(12, 6); c.closePath();
    const g = c.createLinearGradient(0, -11, 0, 7); g.addColorStop(0, '#fff3b0'); g.addColorStop(.5, '#ffc93c'); g.addColorStop(1, '#d98a0b');
    c.fillStyle = g; c.fill(); c.lineJoin = 'round'; c.lineWidth = 1.6; c.strokeStyle = '#7a4d00'; c.stroke();
    c.fillStyle = '#e09a12'; c.strokeStyle = '#7a4d00'; c.lineWidth = 1.2;
    c.beginPath(); c.roundRect(-12.5, 4, 25, 4.5, 1.5); c.fill(); c.stroke();
    for (const [gx, gy, col] of [[0, -11, '#ff5fa2'], [-13.5, -6, '#7dd3fc'], [13.5, -6, '#7dd3fc']]) { c.beginPath(); c.arc(gx, gy, 2.2, 0, TAU); c.fillStyle = col; c.fill(); }
    c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.ellipse(-5, -1, 1.6, 3, -.4, 0, TAU); c.fill();
    c.restore();
  }

  function drawHead(s, h) {
    const a = s.angle;
    ctx.globalAlpha = .55; ctx.drawImage(glow('255,201,60'), h.x - 80, h.y - 80, 160, 160); ctx.globalAlpha = 1;
    if (s.boost) { ctx.globalAlpha = .8; ctx.drawImage(glow('56,189,248'), h.x - 60, h.y - 60, 120, 120); ctx.globalAlpha = 1; }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(h.x + 3, h.y + 11, HEAD_R, HEAD_R * .55, 0, 0, TAU); ctx.fill();
    // heading pointer, so you can still tell which way the head is going
    const fx = Math.cos(a), fy = Math.sin(a), px = -fy, py = fx, tip = HEAD_R + 15;
    ctx.beginPath();
    ctx.moveTo(h.x + fx * tip, h.y + fy * tip);
    ctx.lineTo(h.x + fx * (HEAD_R + 4) + px * 8, h.y + fy * (HEAD_R + 4) + py * 8);
    ctx.lineTo(h.x + fx * (HEAD_R + 4) - px * 8, h.y + fy * (HEAD_R + 4) - py * 8);
    ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    // the head IS the profile: avatar disc inside a platform-colored ring
    ctx.beginPath(); ctx.arc(h.x, h.y, HEAD_R + 3.5, 0, TAU); ctx.fillStyle = platRing(h.pid, h.x, h.y); ctx.fill();
    ctx.drawImage(avatar(h.pid), h.x - HEAD_R, h.y - HEAD_R, HEAD_R * 2, HEAD_R * 2);
    // turn timer ring
    const frac = Math.max(0, s.left / LEAD_MS), live = lastStretch(s);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(h.x, h.y, HEAD_R + 9, 0, TAU); ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(h.x, h.y, HEAD_R + 9, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.lineWidth = 3.5;
    ctx.strokeStyle = live ? (Math.floor(now / 250) % 2 ? '#ff5f7e' : '#ffc93c') : '#ffc93c'; ctx.stroke();
    drawCrown(h.x, h.y - HEAD_R - 17 + Math.sin(now / 320 + h.pid) * 1.5, 1.1, Math.sin(now / 700 + h.pid) * .08);
  }

  // Platform ring color (Instagram gets its gradient)
  function platRing(pid, x, y) {
    if (!handleOf(pid) && !photoUrl(pid)) return '#5b6b80';
    const p = platOf(pid);
    if (p === 'ig') { const g = ctx.createLinearGradient(x - HEAD_R, y + HEAD_R, x + HEAD_R, y - HEAD_R); g.addColorStop(0, '#f58529'); g.addColorStop(.5, '#dd2a7b'); g.addColorStop(1, '#8134af'); return g; }
    return PLAT_DOT[p];
  }
  // Profile picture sprite: the uploaded photo, or a generated avatar with the handle's initial
  const avatar = (pid, size = 128) => {
    const img = photo(pid), h = handleOf(pid);
    return sprite(`a${pid}|${img ? 'i' : ''}|${h || ''}|${size}`, size, (g, S) => {
      const c = S / 2;
      g.save(); g.beginPath(); g.arc(c, c, c, 0, TAU); g.clip();
      if (img) {
        const iw = img.naturalWidth, ih = img.naturalHeight, k = Math.max(S / iw, S / ih);
        g.drawImage(img, c - iw * k / 2, c - ih * k / 2, iw * k, ih * k);
      } else {
        const hue = pid === myPid ? 330 : hueOf(pid), grd = g.createLinearGradient(0, 0, S, S);
        grd.addColorStop(0, `hsl(${hue},90%,70%)`); grd.addColorStop(1, `hsl(${(hue + 40) % 360},80%,48%)`);
        g.fillStyle = h ? grd : '#3a475a'; g.fillRect(0, 0, S, S);
        g.fillStyle = h ? 'rgba(12,16,30,.82)' : '#9fb0c4';
        g.font = `400 ${S * .5}px "Bagel Fat One", system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(h ? h[0].toUpperCase() : '?', c, c + S * .04);
      }
      const gl = g.createLinearGradient(0, 0, 0, S * .55); gl.addColorStop(0, 'rgba(255,255,255,.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gl; g.beginPath(); g.ellipse(c, S * .22, S * .4, S * .26, 0, 0, TAU); g.fill();
      g.restore();
    });
  };

  // Name pill above a head, with the platform icon in front of the handle
  function drawLabel(h, text, bg, fg, plat) {
    ctx.font = '800 12.5px Figtree, system-ui';
    const icon = plat && iconReady(plat);
    const w = ctx.measureText(text).width + (icon ? 30 : 16), x = h.x - w / 2, y = h.y - HEAD_R - 54;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.roundRect(x, y + 2, w, 22, 11); ctx.fill();
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, 22, 11); ctx.fill();
    if (icon) ctx.drawImage(iconImg[plat], x + 4, y + 3, 16, 16);
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + (icon ? 24 : 8), y + 11.5);
  }

  const biggest = () => view.snakes.reduce((a, b) => (b.members.length > a.members.length ? b : a));

  function draw(dt) {
    const focusSnake = mine || (view.snakes.length ? biggest() : null);
    const focus = focusSnake ? focusSnake.members[0] : { x: 0, y: 0 };
    const zTarget = Math.min(W, H) / (me ? 860 : 1150);
    // Frame-rate independent easing, so 60 Hz and 120 Hz screens feel the same
    const kf = 1 - Math.pow(0.85, dt * 60), kz = 1 - Math.pow(0.95, dt * 60);
    cam.x += (focus.x - cam.x) * kf; cam.y += (focus.y - cam.y) * kf; cam.z += (zTarget - cam.z) * kz;
    shake.a *= Math.pow(0.88, dt * 60);
    const sx = (Math.random() - .5) * shake.a, sy = (Math.random() - .5) * shake.a;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a1424'); bg.addColorStop(1, '#060b15');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (W / 2 - cam.x * cam.z + sx), DPR * (H / 2 - cam.y * cam.z + sy));

    drawArena(view.arenaR);
    for (const b of view.bolts) drawBolt(b);
    for (const t of view.trolls) drawTroll(t);

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.save(); ctx.translate(4, 9);
    for (const s of view.snakes) { polyline(s.members); ctx.lineWidth = R * 2; ctx.strokeStyle = 'rgba(0,0,0,.32)'; ctx.stroke(); }
    ctx.restore();

    for (const s of view.snakes) {
      const m = s.members, isMine = s === mine, hue = snakeHue(s.id);
      polyline(m); ctx.lineWidth = R * 2 + 7; ctx.strokeStyle = isMine ? 'hsl(330,55%,28%)' : `hsl(${hue},45%,22%)`; ctx.stroke();
      polyline(m); ctx.lineWidth = R * 2 + 2; ctx.strokeStyle = isMine ? 'hsl(330,60%,40%)' : `hsl(${hue},45%,34%)`; ctx.stroke();
      const L = m.length;
      for (let i = L - 1; i >= 1; i--) {
        const p = m[i];
        if (!inView(p.x, p.y, 30)) continue;
        const r = R; // every face the same size: 80% of the head
        // Every segment is that person's profile: their photo, or a colored initial placeholder
        if (p.pid === myPid) {
          const pulse = 1 + Math.sin(now / 200) * .12, rr = r * 1.08;
          ctx.globalAlpha = .7; ctx.drawImage(glow('255,95,162'), p.x - 40, p.y - 40, 80, 80); ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr + 2, 0, TAU); ctx.fillStyle = '#ff5fa2'; ctx.fill();
          ctx.drawImage(avatar(p.pid, 48), p.x - rr, p.y - rr, rr * 2, rr * 2);
          ctx.beginPath(); ctx.arc(p.x, p.y, rr + 4 + 2 * pulse, 0, TAU); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.6, 0, TAU); ctx.fillStyle = 'rgba(8,12,22,.85)'; ctx.fill();
          ctx.drawImage(avatar(p.pid, 48), p.x - r, p.y - r, r * 2, r * 2);
        }
      }
      // boost trail
      if (s.boost && Math.random() < .8) {
        const h = m[0];
        parts.push({ x: h.x - Math.cos(s.angle) * 14 + rand(-5, 5), y: h.y - Math.sin(s.angle) * 14 + rand(-5, 5), vx: -Math.cos(s.angle) * 60, vy: -Math.sin(s.angle) * 60, life: 420, max: 420, size: rand(3, 6), color: '#7dd3fc', grav: 0, drag: .9, rot: 0, vr: 0, sq: false });
      }
    }
    for (const s of view.snakes) { const h = s.members[0]; if (inView(h.x, h.y, 120)) drawHead(s, h); }
    drawRings();

    for (const p of parts) {
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.4);
      ctx.fillStyle = p.color;
      if (p.sq) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    for (const s of view.snakes) {
      const h = s.members[0];
      if (!inView(h.x, h.y, 160)) continue;
      const hd = handleOf(h.pid);
      if (h.pid === myPid) drawLabel(h, hd ? `@${hd} · YOU` : 'YOU · in the spotlight', '#ffc93c', '#2a1a00', hd ? platOf(myPid) : null);
      else drawLabel(h, hd ? '@' + hd : 'anonymous', 'rgba(14,22,38,.92)', '#f1f6fa', hd ? platOf(h.pid) : null);
    }
    if (me && myIdx > 0) {
      ctx.font = '900 11.5px Figtree, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = 40, y = me.y + R + 22;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.roundRect(me.x - w / 2, y - 9, w, 20, 10); ctx.fill();
      ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.roundRect(me.x - w / 2, y - 11, w, 20, 10); ctx.fill();
      ctx.fillStyle = '#2a0614'; ctx.fillText('YOU', me.x, y);
    }

    // screen space: vignette + edge arrow back to YOU
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
    vg.addColorStop(0, 'rgba(4,8,16,0)'); vg.addColorStop(1, 'rgba(4,8,16,.6)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    drawBubbles();
    if (me && myIdx > 0) {
      const hs = toScreen(me.x, me.y), pad = 46;
      if (hs.x < pad || hs.y < pad || hs.x > W - pad || hs.y > H - pad) {
        const ang = Math.atan2(hs.y - H / 2, hs.x - W / 2);
        const t = Math.min((W / 2 - pad) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - pad) / Math.abs(Math.sin(ang) || 1e-6));
        const ax = W / 2 + Math.cos(ang) * t, ay = H / 2 + Math.sin(ang) * t;
        ctx.globalAlpha = .7; ctx.drawImage(glow('255,95,162'), ax - 34, ay - 34, 68, 68); ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.fillStyle = '#ff5fa2'; ctx.strokeStyle = '#7a1a45'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-9, -12); ctx.lineTo(-4, 0); ctx.lineTo(-9, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        const lx = ax - Math.cos(ang) * 34, ly = ay - Math.sin(ang) * 34;
        ctx.font = '900 11.5px Figtree, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.roundRect(lx - 20, ly - 10, 40, 20, 10); ctx.fill();
        ctx.fillStyle = '#2a0614'; ctx.fillText('YOU', lx, ly + .5);
      }
    }
    drawMini();
  }

  function drawMini() {
    const S = mini.width, k = (S / 2 - 12) / view.arenaR, c = S / 2;
    mctx.clearRect(0, 0, S, S);
    const g = mctx.createRadialGradient(c, c, 0, c, c, c); g.addColorStop(0, 'rgba(23,50,82,.95)'); g.addColorStop(1, 'rgba(10,22,40,.95)');
    mctx.beginPath(); mctx.arc(c, c, c - 3, 0, TAU); mctx.fillStyle = g; mctx.fill();
    mctx.lineWidth = 3; mctx.strokeStyle = 'rgba(125,211,252,.4)'; mctx.stroke();
    mctx.fillStyle = '#7dd3fc';
    for (const b of view.bolts) { mctx.beginPath(); mctx.arc(c + b.x * k, c + b.y * k, 3.5, 0, TAU); mctx.fill(); }
    mctx.fillStyle = '#c084fc';
    for (const t of view.trolls) { mctx.beginPath(); mctx.arc(c + t.x * k, c + t.y * k, 3.5, 0, TAU); mctx.fill(); }
    for (const s of view.snakes) {
      mctx.beginPath();
      s.members.forEach((p, i) => (i ? mctx.lineTo : mctx.moveTo).call(mctx, c + p.x * k, c + p.y * k));
      mctx.lineWidth = s === mine ? 6 : 4.5; mctx.lineCap = mctx.lineJoin = 'round';
      mctx.strokeStyle = s === mine ? '#ff5fa2' : `hsla(${snakeHue(s.id)},60%,62%,.85)`; mctx.stroke();
      const h = s.members[0]; mctx.beginPath(); mctx.arc(c + h.x * k, c + h.y * k, 5, 0, TAU); mctx.fillStyle = '#ffc93c'; mctx.fill();
    }
    if (me) { mctx.beginPath(); mctx.arc(c + me.x * k, c + me.y * k, 6, 0, TAU); mctx.fillStyle = '#fff'; mctx.fill(); }
  }

  // ---------- Spotlight (you as head) ----------
  function spotlightCheck() {
    const head = me && myIdx === 0;
    if (head && !spot) {
      spot = { opens: 0, shown: 0 };
      stats.led++; stats.biggestLed = Math.max(stats.biggestLed, mine.members.length);
      toast(mine.members.length > 1 ? '👑 You are the head for 30s. The whole snake sees your profile!' : '👑 You are the head. Grab people to grow your snake!', true);
      confetti(me.x, me.y, 46); shake.a = 10; sfx('head');
    } else if (head && spot) {
      spot.shown = Math.max(spot.shown, mine.members.length - 1);
      stats.biggestLed = Math.max(stats.biggestLed, mine.members.length);
    } else if (!head && spot) {
      const st = spot; spot = null; stats.opens += st.opens;
      if (handleOf(myPid) && st.shown) toast(`Your turn: shown to ${st.shown} people · ${st.opens} opened your ${PLAT[platOf(myPid)]}`);
    }
  }
  function raceCheck() {
    if (race && (!mine || myIdx === 0 || keyOf(mine.id, mine.turn) !== race.key || !raceOn(mine))) closeRace();
    const k = mine && keyOf(mine.id, mine.turn);
    if (me && myIdx > 0 && raceOn(mine) && mine.left > 300 && !race && raceOk.has(k) && !hiddenRace.has(k)) openRace(mine);
    if (race) $('duelTime').textContent = fmt(mine.left);
  }

  // ---------- HUD ----------
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  let hudAt = 0;
  function hud() {
    if (now - hudAt < 120) return; hudAt = now;
    const online = ws && ws.readyState === 1;
    $('chatBtn').hidden = !myPid;
    refreshLive();
    $('audioCtl').classList.toggle('ingame', $('intro').hidden);
    $('donate').classList.toggle('ingame', $('intro').hidden);
    document.documentElement.style.setProperty('--bottom-h', ($('bottom').hidden ? 0 : $('bottom').offsetHeight) + 'px');
    const humans = view ? view.humans : 0;
    $('n').textContent = humans.toLocaleString();
    $('introN').textContent = humans.toLocaleString();
    $('introN').parentElement.lastChild.textContent = ` ${humans === 1 ? 'player is' : 'players are'} online right now`;
    $('countTail').textContent = view && view.snakes.length > 1 ? `playing · ${view.snakes.length} snakes` : 'playing';
    const st = $('status');
    if (!online) { st.hidden = false; st.className = 'glass offline'; st.textContent = 'Reconnecting…'; }
    if (!view) return;
    const ranked = raceTop && mine && raceTop.sid === mine.id && raceTop.turn === mine.turn ? raceTop.top : [];
    if (mine && online) {
      st.hidden = false;
      const left = mine.left, head = mine.members[0], live = raceOn(mine), key = keyOf(mine.id, mine.turn);
      if (myIdx === 0) {
        st.className = 'glass lead';
        const alone = view.snakes.length < 2;
        st.textContent = mine.members.length > 1 ? (lastStretch(mine) ? `👑 Your followers are tapping for your spot · ${fmt(left)}` : `👑 You're the head · ${fmt(left)} · grab ⚡ to go faster`)
          : alone ? "👑 You're the only one here. Your 30s timer starts when someone else joins."
          : `⏱ Get a tail in ${fmt(left)} or it's game over! Hit a snake's body to steal people.`;
        st.classList.toggle('urgent', mine.members.length === 1 && !alone && left <= RACE_MS);
      } else {
        st.className = 'glass';
        const inRace = raceOk.has(key);
        st.textContent = ranked[0] && ranked[0][0] === myPid ? `🔥 You're winning the tap race. You lead in ${fmt(left)}`
          : !inRace ? `You're #${myIdx + 1} of ${mine.members.length} · you're in the next tap race (${fmt(left)})`
          : `You're #${myIdx + 1} of ${mine.members.length} · tap race · new leader in ${fmt(left)}`;
      }

      const sp = $('spot');
      if (head.pid !== lastHeadPid) { lastHeadPid = head.pid; sp.classList.remove('flash'); void sp.offsetWidth; sp.classList.add('flash'); }
      sp.classList.toggle('me', myIdx === 0);
      $('spotTag').textContent = myIdx === 0 ? "You're in the spotlight" : 'Now leading';
      $('spotTime').textContent = fmt(left);
      $('spotProg').style.strokeDashoffset = (182.2 * (1 - Math.max(0, left) / LEAD_MS)).toFixed(1);
      const hd = handleOf(head.pid), url = photoUrl(head.pid);
      $('spotAva').textContent = url ? '' : hd ? hd[0].toUpperCase() : '?';
      $('spotAva').style.setProperty('--c', head.pid === myPid ? '#ff5fa2' : `hsl(${hueOf(head.pid)},85%,62%)`);
      $('spotAva').style.backgroundImage = url ? `url("${url}")` : '';
      $('spotAva').style.backgroundSize = url ? 'cover' : '';
      $('spotHandle').textContent = head.pid === myPid ? (hd ? '@' + hd : 'You') : name(head.pid);
      $('spotPlat').hidden = !hd; if ($('spotPlat').dataset.plat !== platOf(head.pid) || !$('spotPlat').firstChild || $('spotPlat').firstChild.nodeType === 3) setPlatBadge($('spotPlat'), platOf(head.pid));
      const watching = mine.members.length - 1;
      $('spotSub').textContent = myIdx === 0 ? (!watching ? 'Nobody behind you yet. Share the link!' : hd ? `${watching} ${watching === 1 ? 'person sees' : 'people see'} you` : 'Add a handle to get followers') : `${watching} watching`;
      const f = $('spotFollow'); f.hidden = myIdx === 0 || !hd; f.dataset.plat = platOf(head.pid);
      $('spotOpens').hidden = !(myIdx === 0 && hd);
      $('spotOpensN').textContent = spot ? spot.opens : 0;

      $('race').classList.toggle('live', live && lastStretch(mine));
      const lone = mine.members.length === 1;
      $('raceCloses').textContent = lone ? (view.snakes.length < 2 ? '⏸ Timer paused: nobody else here yet' : `⏱ ${fmt(left)} to get a tail`) : `👆 Tap race · new leader in ${fmt(left)}`;
      const list = $('raceList'); list.textContent = '';
      if (live && ranked.length) for (let i = 0; i < 3; i++) {
        const e = ranked[i], li = document.createElement('li');
        li.className = !e ? 'slot' : e[0] === myPid ? 'mine' : i === 0 ? 'first' : '';
        const top = document.createElement('span'); top.className = 'pos'; top.textContent = i === 0 ? '👑 1st' : i === 1 ? '2nd' : '3rd';
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e ? name(e[0]) : '—';
        const ms = document.createElement('span'); ms.className = 'ms'; ms.textContent = e ? `${e[1]} taps` : '';
        li.append(top, nm, ms); list.append(li);
      } else {
        const li = document.createElement('li'); li.className = 'empty';
        li.textContent = mine.members.length === 1 ? 'Hit another snake’s body to steal its people. Head bumps with other lone heads cost you both 5s.'
          : myIdx === 0 ? 'Your followers are tapping for your spot…' : !raceOk.has(key) ? "Race in progress. You're in the next one!" : 'Tap anywhere! Most taps when the timer ends leads next.';
        list.append(li);
      }
    } else if (online) st.hidden = true;
    const top = view.snakes.slice().sort((a, b) => b.members.length - a.members.length).slice(0, 5), max = top.length ? top[0].members.length : 1;
    $('boardList').innerHTML = top.map(s => { const c = s === mine ? '#ff5fa2' : `hsl(${snakeHue(s.id)},60%,62%)`; return `<li class="${s === mine ? 'mine' : ''}" style="--c:${c}"><span class="orb"></span><span>${s === mine ? 'Your snake' : 'Snake ' + s.id}</span><span class="n">${s.members.length}</span><span class="bar"><i style="width:${Math.round(s.members.length / max * 100)}%"></i></span></li>`; }).join('');
    $('introNote').textContent = humans ? 'Live right now. Jump in!' : "Nobody's here yet. Join now and you lead first.";
  }

  function toast(msg, gold) {
    const el = document.createElement('div');
    el.className = 'toast glass' + (gold ? ' gold' : ''); el.textContent = msg;
    $('toasts').prepend(el);
    setTimeout(() => el.remove(), 3200);
    while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
  }

  // ---------- Hall of fame ----------
  function renderFame(top) {
    const list = $('fameList'); list.textContent = '';
    if (!top.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = 'Nobody yet today. Lead a snake with your handle to get on the board 👑';
      list.append(li); return;
    }
    top.forEach(([handle, platform, opens, led, biggest], i) => {
      const li = document.createElement('li'); li.tabIndex = 0; li.setAttribute('role', 'link');
      li.title = `Open @${handle} on ${PLAT[platform]}`;
      let hsh = 0; for (const ch of handle) hsh = (hsh * 31 + ch.charCodeAt(0)) % 360;
      const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = ['🥇', '🥈', '🥉'][i] || i + 1;
      const av = document.createElement('span'); av.className = 'av'; av.textContent = handle[0].toUpperCase();
      av.style.setProperty('--c', `linear-gradient(135deg, hsl(${hsh},90%,70%), hsl(${(hsh + 40) % 360},80%,50%))`);
      av.style.setProperty('--ring', PLAT_DOT[platform]);
      const who = document.createElement('span'); who.className = 'who';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = '@' + handle;
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.innerHTML = iconSvg(platform, 12); // fixed icon markup, then plain text below
      meta.append(` ${PLAT[platform]}${led ? ` · led ${led}×` : ''}${biggest > 1 ? ` · snake of ${biggest}` : ''}`);
      who.append(nm, meta);
      const op = document.createElement('span'); op.className = 'op'; op.textContent = `👀 ${opens}`; op.title = 'profile opens today';
      li.append(rk, av, who, op);
      const go = () => {
        send({ t: 'fameOpen', handle, platform });
        window.open(PROFILE_URL[platform](encodeURIComponent(handle)), '_blank', 'noopener');
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      list.append(li);
    });
  }

  // ---------- Join a friend ----------
  // Invite links look like plsfollow.me/@handle (or ?join=handle)
  const inviteFrom = (() => {
    const m = location.pathname.match(/^\/@([A-Za-z0-9._-]{1,30})$/), q = new URLSearchParams(location.search).get('join');
    const h = m ? m[1] : q && /^@?[A-Za-z0-9._-]{1,30}$/.test(q) ? q.replace(/^@/, '') : '';
    return h;
  })();
  if (inviteFrom) {
    $('friend').value = '@' + inviteFrom;
    $('invite').textContent = `🐍 @${inviteFrom} invited you to their snake!`;
    $('invite').hidden = false;
  }
  const syncJoinBtn = () => { const f = $('friend').value.trim().replace(/^@+/, ''); $('joinBtn').textContent = f ? `Join @${f}'s snake` : 'Join the tail'; };
  $('friend').addEventListener('input', syncJoinBtn); syncJoinBtn();
  // Suggest handles of people playing right now
  let liveDirty = true, liveAt = 0;
  function refreshLive() {
    if (!liveDirty || now - liveAt < 1000) return; liveDirty = false; liveAt = now;
    const dl = $('liveHandles'); dl.textContent = '';
    let n = 0;
    for (const p of profiles.values()) {
      if (!p.handle || p.pid === myPid) continue;
      const o = document.createElement('option'); o.value = '@' + p.handle; dl.append(o);
      if (++n >= 200) break;
    }
  }
  const inviteLink = () => handleOf(myPid) ? `plsfollow.me/@${handleOf(myPid)}` : 'plsfollow.me';

  // ---------- Join ----------
  async function shrinkPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const S = 160, c = document.createElement('canvas'); c.width = c.height = S;
      const k = Math.max(S / img.naturalWidth, S / img.naturalHeight);
      c.getContext('2d').drawImage(img, (S - img.naturalWidth * k) / 2, (S - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      return c.toDataURL('image/jpeg', .82).split(',')[1];
    } catch { return null; } finally { URL.revokeObjectURL(url); }
  }
  // Remember the join form in this browser (handle, platform and the small photo), so coming back is one tap
  const SAVE_KEY = 'pf-profile';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch { saved = {}; }
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked */ } };
  let photoB64 = typeof saved.img === 'string' ? saved.img : null;
  function showPhoto() {
    $('photoPrev').hidden = !photoB64; $('clearPhoto').hidden = !photoB64;
    if (photoB64) $('photoPrev').src = 'data:image/jpeg;base64,' + photoB64;
  }
  if (typeof saved.handle === 'string') $('handle').value = saved.handle ? '@' + saved.handle : '';
  if (saved.platform && PLAT[saved.platform]) $('platform').value = saved.platform;
  showPhoto();
  $('photo').addEventListener('change', async () => {
    const file = $('photo').files && $('photo').files[0];
    if (!file) return;
    const b64 = await shrinkPhoto(file);
    if (b64) { photoB64 = b64; saved.img = b64; persist(); showPhoto(); }
    else { $('joinErr').textContent = "That photo couldn't be read. Try a JPG or PNG."; $('joinErr').hidden = false; }
  });
  $('clearPhoto').addEventListener('click', () => {
    photoB64 = null; delete saved.img; persist(); $('photo').value = ''; showPhoto();
  });
  $('platform').addEventListener('change', () => { saved.platform = $('platform').value; persist(); });

  $('joinForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (window.PFAudio) PFAudio.unlock();
    $('joinErr').hidden = true; $('joinBtn').disabled = true;
    const handle = $('handle').value.trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, 30);
    if (handle && !/^[A-Za-z0-9._-]+$/.test(handle)) {
      $('joinErr').textContent = 'Handles can only use letters, numbers, . _ and -'; $('joinErr').hidden = false; $('joinBtn').disabled = false; return;
    }
    saved.handle = handle; saved.platform = $('platform').value; persist();
    joinInfo = { handle, platform: $('platform').value, img: photoB64, follow: $('friend').value.trim() };
    send({ t: 'join', ...joinInfo });
  });
  // A troll caught a head with no tail: back to the main screen, form still filled in for a quick rejoin
  function knockedOut(why) {
    if (spot) { stats.opens += spot.opens; spot = null; }
    myPid = 0; me = mine = null; joinInfo = null; closeRace();
    shake.a = 16; sfx('out'); if (window.PFAudio) PFAudio.duck(3); closeChat();
    $('bottom').hidden = true; $('peek').hidden = true; $('shareModal').hidden = true;
    $('intro').hidden = false; $('joinBtn').disabled = false;
    $('joinErr').textContent = why === 'time'
      ? "⏱ Time's up! You didn't get a tail in 30 seconds. Jump back in?"
      : '👹 A troll got you! Without a tail to protect you, one bump knocks you out. Jump back in?';
    $('joinErr').hidden = false;
  }
  let greetPending = false;
  function onJoined() {
    $('intro').hidden = true; $('bottom').hidden = false; $('joinBtn').disabled = false;
    greetPending = true; // greeted on the first frame that shows us in a snake
    if (joinInfo) joinInfo.follow = ''; // a reconnect just rejoins the biggest snake
    sfx('join');
  }
  function greet() {
    if (!greetPending || !me) return;
    greetPending = false;
    if (myIdx > 0) toast(`You joined at the tail. You're #${myIdx + 1}. Race to be the next head!`);
  }
  $('race').addEventListener('click', e => {
    if (e.target.closest('#share')) return;
    if (!mine || myIdx === 0 || !raceOn(mine)) return;
    if (!raceOk.has(keyOf(mine.id, mine.turn))) { toast("This race started before you arrived. You're in the next one!"); return; }
    openRace(mine);
  });

  // ---------- Share card ----------
  function makeCaption(s) {
    const pos = myIdx + 1, n = s.members.length, h = handleOf(myPid), tag = h ? ` Follow me @${h}` : '';
    if (stats.led) return `I led a snake of ${Math.max(n, stats.biggestLed)} strangers for 30 seconds 👑${stats.opens ? ` and ${stats.opens} people checked my profile` : ''}.${tag} 🐍 Join my snake → ${inviteLink()}`;
    return `I'm #${pos} in a snake of ${n} strangers 🐍 Waiting for my turn to lead 👑${tag} → ${inviteLink()}`;
  }
  // Editorial share card: soft gradient mesh, paper grain, serif headline, a polaroid of the actual snake
  const SHARE_THEMES = {
    cream:    { bg: '#f3ece0', blobs: ['#f7c6b0', '#d9c8ef', '#f4dfa6'], ink: '#2a2320', muted: '#8a7d70', accent: '#c4543c', line: 'rgba(42,35,32,.16)', frame: '#fffdf8', photo: '#efe6d8', dots: 'rgba(42,35,32,.09)', body: ['#e9967a', '#b49ad8'], tape: 'rgba(255,236,190,.7)', grain: 34 },
    blush:    { bg: '#fbe4e9', blobs: ['#ffbfd0', '#ffe0b0', '#e2d2ff'], ink: '#3b1d2a', muted: '#a07686', accent: '#d63a72', line: 'rgba(59,29,42,.15)', frame: '#ffffff', photo: '#fff1f4', dots: 'rgba(59,29,42,.08)', body: ['#ff8fb1', '#ffc46b'], tape: 'rgba(255,255,255,.65)', grain: 30 },
    midnight: { bg: '#14111c', blobs: ['#4a2f6e', '#6e2f52', '#2f4a6e'], ink: '#f6efe4', muted: '#9a90a8', accent: '#ffb0c8', line: 'rgba(246,239,228,.16)', frame: '#221e2c', photo: '#191622', dots: 'rgba(246,239,228,.08)', body: ['#ffb0c8', '#a99bff'], tape: 'rgba(255,255,255,.14)', grain: 22 },
  };
  let shareTheme = 'cream', grainTile = null;
  const SERIF = '"Instrument Serif", Georgia, serif', HAND = 'Caveat, "Bradley Hand", cursive';
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mixHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  function sparkle(c, x, y, s, col) {
    c.fillStyle = col; c.beginPath(); c.moveTo(x, y - s);
    c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s); c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s); c.fill();
  }
  function fitFont(c, text, weight, family, max, width) {
    let size = max; do { c.font = `${weight} ${size}px ${family}`; size -= 2; } while (c.measureText(text).width > width && size > 20);
  }
  function makeShareCard(s) {
    const Wc = 1080, Hc = 1350, cvs = document.createElement('canvas'); cvs.width = Wc; cvs.height = Hc;
    const c = cvs.getContext('2d'), T = SHARE_THEMES[shareTheme], m = s.members, meP = m[myIdx], myHandle = handleOf(myPid);
    const pos = myIdx + 1, n = m.length, led = stats.led > 0, total = led ? Math.max(n, stats.biggestLed) : n;
    // background: flat tone + three soft color blobs + paper grain
    c.fillStyle = T.bg; c.fillRect(0, 0, Wc, Hc);
    [[120, 160, 620, T.blobs[0]], [980, 520, 680, T.blobs[1]], [300, 1240, 640, T.blobs[2]]].forEach(([x, y, r, col]) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col + 'e6'); g.addColorStop(1, col + '00');
      c.fillStyle = g; c.fillRect(0, 0, Wc, Hc);
    });
    // top meta line
    const d = new Date();
    c.textBaseline = 'alphabetic'; c.letterSpacing = '6px';
    c.font = '800 22px Figtree, system-ui'; c.fillStyle = T.ink; c.textAlign = 'left'; c.fillText('PLSFOLLOW.ME', 72, 100);
    c.fillStyle = T.muted; c.textAlign = 'right';
    c.fillText(`${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, Wc - 72, 100);
    c.letterSpacing = '0px';
    c.fillStyle = T.line; c.fillRect(72, 124, Wc - 144, 2);
    // headline: roman line + big italic accent line
    c.textAlign = 'left'; c.fillStyle = T.ink;
    const line1 = led ? 'I led a snake of' : `I'm no. ${pos} in a snake of`;
    fitFont(c, line1, 400, SERIF, 86, Wc - 144); c.fillText(line1, 70, 222);
    const line2 = `${total} strangers`;
    fitFont(c, line2, 'italic 400', SERIF, 168, Wc - 200); c.fillStyle = T.accent; c.fillText(line2, 64, 372);
    const l2w = c.measureText(line2).width;
    sparkle(c, 64 + l2w + 46, 250, 26, T.accent); sparkle(c, 64 + l2w + 86, 300, 13, T.accent);
    // polaroid of the actual snake, slightly tilted
    c.save(); c.translate(Wc / 2, 742); c.rotate(-.035);
    c.shadowColor = 'rgba(30,20,10,.22)'; c.shadowBlur = 50; c.shadowOffsetY = 24;
    c.fillStyle = T.frame; c.beginPath(); c.roundRect(-400, -320, 800, 640, 10); c.fill();
    c.shadowColor = 'transparent';
    const P = { x: -370, y: -290, w: 740, h: 500 };
    c.save(); c.beginPath(); c.roundRect(P.x, P.y, P.w, P.h, 4); c.clip();
    c.fillStyle = T.photo; c.fillRect(P.x, P.y, P.w, P.h);
    c.fillStyle = T.dots;
    for (let y = P.y + 20; y < P.y + P.h; y += 34) for (let x = P.x + 20; x < P.x + P.w; x += 34) { c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.fill(); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of m) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const pad = 86, k = Math.min((P.w - pad * 2) / Math.max(1, x1 - x0), (P.h - pad * 2) / Math.max(1, y1 - y0), 2.2);
    const tx = p => P.x + P.w / 2 + (p.x - (x0 + x1) / 2) * k, ty = p => P.y + P.h / 2 + 12 + (p.y - (y0 + y1) / 2) * k;
    const r = Math.max(8, Math.min(20, R * k));
    // soft shadow pass, then pastel beads fading head → tail
    c.fillStyle = 'rgba(40,25,15,.13)';
    for (const p of m) { c.beginPath(); c.arc(tx(p) + 3, ty(p) + 7, r, 0, TAU); c.fill(); }
    for (let i = m.length - 1; i >= 1; i--) {
      const p = m[i], x = tx(p), y = ty(p), isMe = p.pid === myPid;
      c.fillStyle = isMe ? T.accent : mixHex(T.body[0], T.body[1], i / Math.max(1, m.length - 1));
      c.beginPath(); c.arc(x, y, isMe ? r * 1.3 : r, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,.38)'; c.beginPath(); c.arc(x - r * .32, y - r * .36, r * .36, 0, TAU); c.fill();
      if (isMe) { c.beginPath(); c.arc(x, y, r * 1.3 + 9, 0, TAU); c.lineWidth = 4; c.strokeStyle = T.accent; c.stroke(); }
    }
    const h = m[0], hr = r * 1.9, hx = tx(h), hy = ty(h);
    c.beginPath(); c.arc(hx, hy, hr + 7, 0, TAU); c.fillStyle = T.frame; c.fill();
    c.beginPath(); c.arc(hx, hy, hr + 7, 0, TAU); c.lineWidth = 3; c.strokeStyle = T.accent; c.stroke();
    c.drawImage(avatar(h.pid), hx - hr, hy - hr, hr * 2, hr * 2);
    drawCrown(hx, hy - hr - 22, 1.9, -.08, c);
    // handwritten "me" note with a little arrow
    const mx = tx(meP), my = ty(meP), mr = (myIdx === 0 ? hr + 7 : r * 1.3 + 9), left = mx > P.x + P.w * .6;
    const lx = Math.max(P.x + 70, Math.min(P.x + P.w - 70, mx + (left ? -1 : 1) * (mr + 90))), ly = Math.max(P.y + 50, my - mr - 50);
    c.font = `700 48px ${HAND}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = T.accent;
    c.fillText(myIdx === 0 ? "that's me!" : 'me!', lx, ly);
    const cx1 = lx + (left ? 50 : -50), ex = mx + (left ? mr * .7 : -mr * .7), ey = my - mr * .7;
    c.beginPath(); c.moveTo(lx + (left ? 30 : -30), ly + 24);
    c.quadraticCurveTo(cx1, ey, ex, ey); c.lineWidth = 3.5; c.lineCap = 'round'; c.strokeStyle = T.accent; c.stroke();
    const ang = Math.atan2(0, ex - cx1);
    for (const s2 of [-1, 1]) { c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - Math.cos(ang + s2 * .5) * 16, ey - Math.sin(ang + s2 * .5) * 16); c.stroke(); }
    c.restore();
    // handwritten polaroid caption
    c.font = `600 50px ${HAND}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = T.ink;
    c.fillText(led ? 'my 30 seconds of fame' : `${n} strangers & me`, -362, 284);
    sparkle(c, 352, 266, 14, T.accent);
    // washi tape
    c.rotate(.06); c.fillStyle = T.tape; c.fillRect(-90, -346, 180, 52);
    c.restore();
    // stats: three editorial columns with hairline dividers
    const opens = stats.opens + (spot ? spot.opens : 0);
    const tiles = [
      [led ? `${stats.led}×` : `no. ${pos}`, led ? 'times I led' : 'my spot'],
      [stats.best ? `${stats.best}` : `${n}`, stats.best ? 'tap record' : 'in my snake'],
      [myHandle ? `${opens}` : `${view.snakes.length}`, myHandle ? 'profile opens' : 'snakes alive'],
    ];
    const cw = (Wc - 144) / 3;
    tiles.forEach(([v, l], i) => {
      const cx = 72 + cw * i + cw / 2;
      if (i) { c.fillStyle = T.line; c.fillRect(72 + cw * i, 1128, 2, 104); }
      c.textAlign = 'center'; c.fillStyle = i === 0 ? T.accent : T.ink;
      fitFont(c, v, 400, SERIF, 84, cw - 40); c.fillText(v, cx, 1190);
      c.letterSpacing = '4px'; c.font = '800 19px Figtree, system-ui'; c.fillStyle = T.muted; c.fillText(l.toUpperCase(), cx, 1228); c.letterSpacing = '0px';
    });
    // footer
    c.fillStyle = T.line; c.fillRect(72, 1258, Wc - 144, 2);
    c.textBaseline = 'middle'; c.textAlign = 'left';
    if (myHandle) {
      c.drawImage(avatar(myPid), 72, 1278, 48, 48);
      const t = `@${myHandle}`; fitFont(c, t, 800, 'Figtree, system-ui', 30, 280); c.fillStyle = T.ink; c.fillText(t, 134, 1303);
      const tw = c.measureText(t).width;
      if (iconReady(platOf(myPid))) c.drawImage(iconImg[platOf(myPid)], 144 + tw, 1290, 26, 26);
      c.font = '600 24px Figtree, system-ui'; c.fillStyle = T.muted; c.fillText(PLAT[platOf(myPid)], 178 + tw, 1304);
    } else {
      c.font = `italic 400 40px ${SERIF}`; c.fillStyle = T.ink; c.fillText('pls follow me', 72, 1302);
    }
    c.textAlign = 'right'; c.fillStyle = T.accent;
    const cta = myHandle ? `join me → ${inviteLink()}` : 'join the snake → plsfollow.me';
    fitFont(c, cta, 'italic 400', SERIF, 38, myHandle ? 430 : 600); c.fillText(cta, Wc - 72, 1302);
    // paper grain over everything
    if (!grainTile) {
      grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 200;
      const gc = grainTile.getContext('2d'), id = gc.createImageData(200, 200);
      for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255 | 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      gc.putImageData(id, 0, 0);
    }
    c.globalAlpha = T.grain / 255; c.globalCompositeOperation = 'overlay';
    c.fillStyle = c.createPattern(grainTile, 'repeat'); c.fillRect(0, 0, Wc, Hc);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    return cvs;
  }
  let shareCanvas = null, shareSnake = null;
  async function renderShare() {
    if (!shareSnake) return;
    try { await Promise.all([`86px ${SERIF}`, `italic 86px ${SERIF}`, `700 48px ${HAND}`].map(f => document.fonts.load(f))); } catch { /* fall back to system fonts */ }
    shareCanvas = makeShareCard(shareSnake);
    $('shareImg').src = shareCanvas.toDataURL('image/png');
    document.querySelectorAll('#shareThemes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === shareTheme));
  }
  $('share').addEventListener('click', async () => {
    if (!mine) return;
    // Freeze the snake as it is right now
    shareSnake = { members: mine.members.map(p => ({ ...p })) };
    $('caption').value = makeCaption(mine);
    $('copyInvite').hidden = !handleOf(myPid);
    $('shareModal').hidden = false;
    await renderShare();
  });
  $('shareThemes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    shareTheme = b.dataset.theme; renderShare();
  });
  $('shareClose').addEventListener('click', () => { $('shareModal').hidden = true; });
  $('shareModal').addEventListener('click', e => { if (e.target.id === 'shareModal') $('shareModal').hidden = true; });
  $('copyCap').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('caption').value); toast('Caption copied'); }
    catch { $('caption').select(); toast('Select the caption and copy it'); }
  });
  $('copyInvite').addEventListener('click', async () => {
    const url = 'https://' + inviteLink();
    try { await navigator.clipboard.writeText(url); toast('Invite link copied: friends who open it join your snake'); }
    catch { toast(url); }
  });
  $('saveImg').addEventListener('click', () => {
    if (!shareCanvas) return;
    shareCanvas.toBlob(blob => {
      const a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = 'plsfollow-me.png'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  });
  $('nativeShare').addEventListener('click', () => {
    if (!shareCanvas) return;
    shareCanvas.toBlob(async blob => {
      const file = new File([blob], 'plsfollow-me.png', { type: 'image/png' });
      try {
        if (!navigator.canShare || !navigator.canShare({ files: [file] })) throw new Error('no share');
        await navigator.share({ files: [file], text: $('caption').value });
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast('Sharing isn’t supported here. Save the image and copy the caption instead.');
      }
    });
  });

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(.05, (t - last) / 1000); last = t; now = t;
    smoothNet(dt);
    view = buildView();
    me = null; mine = null; myIdx = -1;
    if (view && myPid) for (const s of view.snakes) {
      const i = s.members.findIndex(p => p.pid === myPid);
      if (i >= 0) { mine = s; myIdx = i; me = s.members[i]; break; }
    }
    if (view) {
      greet(); spotlightCheck(); raceCheck();
      draw(dt);
    } else {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#070d18'; ctx.fillRect(0, 0, W, H);
    }
    stepParts(dt);
    hud();
    requestAnimationFrame(frame);
  }
  // Music and sound toggles (remembered per browser)
  function syncAudioButtons() {
    if (!window.PFAudio) { $('audioCtl').hidden = true; return; }
    for (const [id, on, label] of [['musicBtn', PFAudio.music, 'Music'], ['sfxBtn', PFAudio.sfx, 'Sound effects']]) {
      const b = $(id); b.setAttribute('aria-pressed', on); b.title = `${label}: ${on ? 'on' : 'off'}`; b.setAttribute('aria-label', b.title);
    }
  }
  $('musicBtn').addEventListener('click', () => { PFAudio.setMusic(!PFAudio.music); PFAudio.unlock(); syncAudioButtons(); });
  $('sfxBtn').addEventListener('click', () => { PFAudio.setSfx(!PFAudio.sfx); PFAudio.unlock(); syncAudioButtons(); sfx('click'); });
  // Any first tap anywhere also wakes the audio (browsers block sound until then)
  addEventListener('pointerdown', () => window.PFAudio && PFAudio.unlock(), { once: true });
  syncAudioButtons();
  if (DONATE_URL) { $('donate').href = DONATE_URL; $('donate').hidden = false; }
  $('donate').addEventListener('click', () => sfx('click'));
  connect();
  requestAnimationFrame(frame);
})();
