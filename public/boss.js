// Bosses: drawing, sound cues and HUD for 👁️ THE ALGORITHM, 📸 THE INFLUENCER and 💬 THE COMMENT
// SECTION. The server decides everything; this file draws warnings, attacks, tokens and the boss at the
// same server-time moment as the rest of the world, so what you see is what hits.
window.PFBoss = (() => {
  'use strict';
  const TAU = Math.PI * 2;
  const R = 120, SLAM_R = 350;
  const SHORT = { algorithm: '👁️', influencer: '📸', comments: '💬' };
  let st = { phase: 'idle', kind: '', attacks: [], tokens: [] };
  // live moving parts for the dragon / minions / spotlights, smoothed toward the latest server update
  const live = { body: [], target: [], ang: 0, mins: new Map(), spots: new Map(), tokens: [] };
  const fx = new Set();
  let api = null, flash = 0, lastFrame = 0;

  function init(a) { api = a; }
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const at = (name, time, o) => api.at(name, (time - api.now()) / 1000, o);

  // ---------- Messages ----------
  function onSnapshot(m) {
    const prev = st.phase, wasEnraged = !!st.enraged;
    st = { ...m, attacks: m.attacks || [], tokens: m.tokens || [] };
    if (st.phase !== 'active' && st.phase !== 'leaving') { live.body = []; live.target = []; live.mins.clear(); live.spots.clear(); live.tokens = []; }
    if (prev !== st.phase) onPhase(prev, st.phase);
    if (st.enraged && !wasEnraged && st.phase === 'active') {
      api.at({ algorithm: 'bossRoar', influencer: 'inflGlitch', comments: 'dragonRoar' }[st.kind] || 'bossRoar', 0);
      api.shake(12); api.toast(`${SHORT[st.kind]} ${st.name} IS ENRAGED`, true);
    }
    music();
  }
  function onLive(m) {
    if (m.body) {
      live.target = m.body; live.ang = m.ang;
      if (live.body.length !== m.body.length) live.body = m.body.map(p => p.slice());
    }
    const mins = new Map((m.mins || []).map(([id, x, y]) => [id, [x, y]]));
    for (const [id, p] of mins) { const cur = live.mins.get(id); live.mins.set(id, cur ? { x: cur.x, y: cur.y, tx: p[0], ty: p[1] } : { x: p[0], y: p[1], tx: p[0], ty: p[1] }); }
    for (const id of [...live.mins.keys()]) if (!mins.has(id)) live.mins.delete(id);
    for (const [id, x, y] of m.spots || []) { const cur = live.spots.get(id); live.spots.set(id, cur ? { x: cur.x, y: cur.y, tx: x, ty: y } : { x, y, tx: x, ty: y }); }
    if (m.tokens) live.tokens = m.tokens;
  }
  function music() { api.music(st.phase === 'warning' ? 0 : st.phase === 'active' ? (st.enraged ? 2 : 1) : null, st.kind); }

  function onAttack(a) {
    if (st.attacks.some(x => x.id === a.id)) return;
    st.attacks.push(a);
    const d = (a.t1 - a.t0) / 1000;
    switch (a.type) {
      case 'beam': at('bossCharge', a.t0, { dur: d }); at('bossBlast', a.t1); at('bossHum', a.t1, { dur: (a.t2 - a.t1) / 1000 }); at('bossPowerDown', a.t2); break;
      case 'stomp': at('bossRumble', a.t0, { dur: d }); at('bossStomp', a.t1); a.lines.forEach((_, i) => at('bossCrackle', a.t1 + i * a.step)); at('bossWave', a.ringAt); break;
      case 'rain': case 'hearts': {
        const me = api.myHead(), near = me ? Math.min(...a.circles.map(([x, y]) => Math.hypot(x - me.x, y - me.y))) : 800, g = Math.max(0.35, Math.min(1, 1 - near / 1400));
        if (a.type === 'rain') { for (let i = 0; i < Math.min(3, a.circles.length); i++) at('bossWhistle', a.t0 + i * 120, { dur: d - i * 0.12 }); for (let i = 0; i < Math.min(4, a.circles.length); i++) at('bossImpact', a.t1 + i * 45, { g: g * (i ? .6 : 1) }); }
        else { at('inflKiss', a.t0, { dur: d }); for (let i = 0; i < Math.min(4, a.circles.length); i++) at('inflHeartBoom', a.t1 + i * 55, { g: g * (i ? .6 : 1) }); }
        break;
      }
      case 'doom': at('bossWarp', a.t0, { dur: (a.t2 - a.t0) / 1000 }); break;
      case 'flash': for (let i = 0; i < 3; i++) at('inflBeep', a.t1 - 1800 + i * 600, { n: i }); at('inflFlash', a.t1); break;
      case 'ring': at('inflRingCharge', a.t0, { dur: d }); at('inflRingZap', a.ringAt); break;
      case 'spot': for (let i = 0; i < 7; i++) at('inflPing', a.t0 + (1 - Math.pow(1 - i / 7, 1.6)) * (a.t1 - a.t0), { n: i }); at('inflStamp', a.t1); break;
      case 'fire': at('dragonInhale', a.t0, { dur: d }); at('dragonFire', a.t1, { dur: (a.t2 - a.t1) / 1000 }); break;
      case 'whip': at('dragonWhipWind', a.t0, { dur: d }); at('dragonWhip', a.t1); break;
      case 'replies': at('dragonChatter', a.t0); break;
      case 'thread': at('dragonThread', a.t1, { dur: (a.t2 - a.t1) / 1000 }); at('dragonSnap', a.t2); break;
    }
  }

  function onPhase(prev, ph) {
    if (ph === 'warning') {
      api.at({ algorithm: 'bossSiren', influencer: 'inflWarn', comments: 'dragonWarn' }[st.kind] || 'bossSiren', 0);
      api.toast(`⚠️ ${st.name} is coming!${st.kind === 'comments' ? ' It hunts, so keep moving' : ' Get away from the center'}`, true);
      const until = (st.landAt - api.now()) / 1000;
      api.at('bossRiser', 0, { dur: until }); api.at('bossFall', until - 1.4); api.at('bossSlam', until);
    } else if (ph === 'active' && prev === 'warning') {
      api.shake(22); api.burst(0, 0, 60, ['#ff5f7e', '#fff', '#a78bfa', '#ffc93c'], { speed: 520, life: 1000, size: 7 });
    } else if (ph === 'leaving') {
      const c = live.body[0] ? { x: live.body[0][0], y: live.body[0][1] } : { x: 0, y: 0 };
      if (st.outcome === 'down') {
        api.at('bossDown', 0); api.at({ algorithm: 'bossLeave', influencer: 'inflDown', comments: 'dragonDown' }[st.kind] || 'bossLeave', 0.1);
        api.shake(18); api.burst(c.x, c.y, 90, ['#34d399', '#ffc93c', '#fff', '#7dd3fc', '#ff5fa2'], { speed: 620, life: 1400, size: 8, grav: 120 });
        const how = { algorithm: 'got logged off', influencer: 'went offline', comments: 'got blocked' }[st.kind];
        api.toast(`🎉 ${st.name} ${how}!${st.by ? ' Final blow: ' + api.name(st.by) : ''}`, true);
      } else {
        api.at('bossLeave', 0);
        api.toast(`${SHORT[st.kind]} ${st.name} got bored and left. Back in 3 minutes.`);
      }
    }
  }

  function onEvent(e, mine) {
    if (e.k === 'token') {
      api.burst(e.x, e.y, 20, e.boss === 'algorithm' ? ['#34d399', '#bbf7d0', '#fff'] : e.boss === 'influencer' ? ['#ff5fa2', '#fbcfe8', '#fff'] : ['#f43f5e', '#fff', '#fda4af'], { speed: 240, life: 700, size: 5 });
      if (e.boss === 'algorithm') { st.endsAt = e.endsAt; st.cut = e.total; } else st.hp = e.hp;
      st.tokens = st.tokens.filter(t => Math.hypot(t[1] - e.x, t[2] - e.y) > 2);
      const mineTok = e.pid === mine.pid;
      api.at({ algorithm: 'bossGrass', influencer: 'inflUnfollow', comments: 'dragonBlock' }[e.boss], 0);
      const what = {
        algorithm: ['🌱 You touched grass! −6s for the Algorithm', `🌱 ${api.name(e.pid)} touched grass (−6s)`],
        influencer: ['📵 You unfollowed the Influencer!', `📵 ${api.name(e.pid)} unfollowed the Influencer`],
        comments: ['✂️ You blocked part of the Comment Section!', `✂️ ${api.name(e.pid)} cut the dragon's tail`],
      }[e.boss];
      api.toast(mineTok ? what[0] : what[1], mineTok);
    } else if (e.k === 'bossHit') {
      api.burst(e.x, e.y, 26, ['#ff5f7e', '#fff', '#a78bfa'], { speed: 320, life: 650, size: 5 });
      if (e.sid !== mine.sid) return;
      const what = {
        beam: '👁️ Shadowbanned!', stomp: '💥 Stomped!', rain: '☄️ Ratioed!', slam: '💥 Slammed!',
        flash: '📸 Flashed!', hearts: '💖 Love-bombed!', ring: '💍 Ring-lit!', spot: '📍 Spotlighted!',
        fire: '🔥 Hot take!', whip: '🌪️ Tail-whipped!', thread: '🧵 Caught in the thread!', replies: '👥 A reply guy got you!',
        body: { algorithm: '👁️ Bumped the Algorithm!', influencer: '📸 Bumped the Influencer!', comments: '🐉 Bumped the Comment Section!' }[e.boss],
      }[e.atk] || '💥 Hit!';
      api.shake(14); api.at('bossHurt', 0);
      if (e.head) api.toast(e.pid === mine.pid ? `${what} −5s and stunned` : `${what} Your head lost 5s`);
      else api.toast(mine.idx >= e.k2 ? `${what} You got split off into a new snake` : `${what} ${e.n} people split off your snake`);
    } else if (e.k === 'bossStamp') {
      api.burst(e.x, e.y, 40, ['#fff', '#ffc93c', '#ff5fa2'], { speed: 420, life: 800, size: 6 }); api.shake(10);
    }
  }

  const present = () => st.phase === 'active' || st.phase === 'leaving';

  // Smooth the moving parts toward their latest server positions
  function step(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
    const k = 1 - Math.pow(0.0001, dt);
    if (live.target.length) {
      if (live.body.length !== live.target.length) live.body = live.target.map(p => p.slice());
      live.body.forEach((p, i) => { p[0] += (live.target[i][0] - p[0]) * k; p[1] += (live.target[i][1] - p[1]) * k; });
    }
    for (const m of live.mins.values()) { m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; }
    for (const s of live.spots.values()) { s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k; }
    flash = Math.max(0, flash - dt * 1.8);
  }

  // ---------- Ground layer: warnings and tokens under the snakes ----------
  function drawGround(ctx, now) {
    step(now);
    if (st.phase === 'warning') {
      const f = clamp01(1 - (st.landAt - now) / 8000), pulse = .5 + .5 * Math.sin(now / 120);
      ctx.fillStyle = `rgba(0,0,0,${.25 + .35 * f})`; ctx.beginPath(); ctx.ellipse(0, 20, R * (0.4 + f), R * (0.25 + .6 * f), 0, 0, TAU); ctx.fill();
      ctx.setLineDash([18, 14]); ctx.lineWidth = 6; ctx.strokeStyle = `rgba(255,60,90,${.35 + .4 * pulse})`;
      ctx.beginPath(); ctx.arc(0, 0, SLAM_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,40,80,${.06 + .06 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, SLAM_R, 0, TAU); ctx.fill();
      ctx.font = '900 34px Figtree, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,220,225,${.5 + .5 * pulse})`; ctx.fillText(`${SHORT[st.kind] || ''} ${st.name || ''}`, 0, -SLAM_R - 30);
    }
    if (!present()) return;
    for (const a of st.attacks) {
      if (now < a.t0 || now > a.t2 + 400) continue;
      if (ground[a.type]) ground[a.type](ctx, a, now);
    }
    drawTokens(ctx, now);
  }
  const ground = {
    beam(ctx, a, now) {
      if (now >= a.t1) return;
      const f = (now - a.t0) / (a.t1 - a.t0);
      for (let i = 0; i < a.count; i++) {
        const ang = a.a0 + i * TAU / a.count;
        ctx.fillStyle = `rgba(255,40,80,${.05 + .07 * f})`; ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, a.len, Math.min(ang, ang + a.sweep), Math.max(ang, ang + a.sweep)); ctx.closePath(); ctx.fill();
        ctx.setLineDash([14, 10]); ctx.lineWidth = 3 + 3 * f; ctx.strokeStyle = `rgba(255,70,100,${.5 + .4 * f})`;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * R, Math.sin(ang) * R); ctx.lineTo(Math.cos(ang) * a.len, Math.sin(ang) * a.len); ctx.stroke(); ctx.setLineDash([]);
      }
    },
    stomp(ctx, a, now) {
      a.lines.forEach((pts, i) => {
        const s = a.t1 + i * a.step;
        if (now > s + 450) { ctx.strokeStyle = 'rgba(40,20,30,.55)'; ctx.lineWidth = 6; }
        else if (now < s) { const p = .5 + .5 * Math.sin(now / 70 + i); ctx.strokeStyle = `rgba(255,140,60,${.35 + .4 * p})`; ctx.lineWidth = 5; ctx.setLineDash([10, 8]); }
        else return;
        ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
      });
      if (now < a.ringAt) for (const [ga, hw] of a.gaps) { ctx.strokeStyle = 'rgba(52,211,153,.75)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, R + 40, ga - hw, ga + hw); ctx.stroke(); }
    },
    rain(ctx, a, now) { targets(ctx, a, now, 'rgba(255,40,80,', 'rgba(255,80,110,.85)', false); },
    hearts(ctx, a, now) { targets(ctx, a, now, 'rgba(255,95,162,', 'rgba(255,150,200,.9)', true); },
    doom(ctx, a, now) {
      const alpha = now >= a.t1 && now <= a.t2 ? .5 : .25;
      ctx.lineWidth = 4; ctx.strokeStyle = `rgba(167,139,250,${alpha})`;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); for (let r = R; r < 900; r += 30) { const ang = i / 6 * TAU + now / 500 + r / 160; (r === R ? ctx.moveTo : ctx.lineTo).call(ctx, Math.cos(ang) * r, Math.sin(ang) * r); } ctx.stroke(); }
    },
    flash(ctx, a, now) {
      if (now >= a.t1) return;
      const left = Math.ceil((a.t1 - now) / 600), p = .5 + .5 * Math.sin(now / 90);
      ctx.fillStyle = `rgba(255,255,255,${.04 + .05 * p})`; ctx.beginPath(); ctx.arc(0, 0, 2000, 0, TAU); ctx.fill();
      ctx.font = '400 120px "Bagel Fat One", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(20,10,30,.8)'; ctx.fillStyle = '#fff';
      const txt = left > 3 ? '📸' : String(Math.min(3, left));
      ctx.strokeText(txt, 0, -R - 110); ctx.fillText(txt, 0, -R - 110);
      ctx.font = '900 26px Figtree, system-ui'; ctx.fillStyle = '#ffd1e3'; ctx.fillText('LOOK AWAY!', 0, -R - 40);
    },
    ring(ctx, a, now) {
      if (now >= a.ringAt) return;
      for (const g of a.gaps) { ctx.strokeStyle = 'rgba(52,211,153,.8)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, a.r0 + 30, g - a.gw, g + a.gw); ctx.stroke(); }
      ctx.setLineDash([12, 10]); ctx.lineWidth = 4; ctx.strokeStyle = `rgba(255,255,255,${.3 + .3 * Math.sin(now / 80)})`; ctx.beginPath(); ctx.arc(0, 0, a.r0 + 10, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    },
    spot(ctx, a, now) {
      if (now > a.t1 + 300) return;
      const s = live.spots.get(a.id) || { x: a.x, y: a.y }, f = clamp01((now - a.t0) / (a.t1 - a.t0));
      ctx.fillStyle = `rgba(255,201,60,${.12 + .2 * f})`; ctx.beginPath(); ctx.arc(s.x, s.y, a.r, 0, TAU); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = `rgba(255,220,120,${.6 + .4 * f})`; ctx.beginPath(); ctx.arc(s.x, s.y, a.r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x, s.y, a.r * (1 - f) + 6, 0, TAU); ctx.stroke();
      ctx.font = '28px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('📍', s.x, s.y - a.r - 18);
    },
    fire(ctx, a, now) {
      if (now >= a.t1) return;
      const f = (now - a.t0) / (a.t1 - a.t0);
      ctx.fillStyle = `rgba(255,80,40,${.08 + .14 * f})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, a.len, a.ang - a.half, a.ang + a.half); ctx.closePath(); ctx.fill();
      ctx.setLineDash([12, 10]); ctx.lineWidth = 4; ctx.strokeStyle = `rgba(255,120,60,${.6 + .3 * Math.sin(now / 60)})`; ctx.stroke(); ctx.setLineDash([]);
    },
    whip(ctx, a, now) {
      if (now >= a.t1) return;
      const f = (now - a.t0) / (a.t1 - a.t0), lo = Math.min(a.a0, a.a0 + a.sweep), hi = Math.max(a.a0, a.a0 + a.sweep);
      ctx.fillStyle = `rgba(255,200,60,${.06 + .12 * f})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, a.r, lo, hi); ctx.closePath(); ctx.fill();
      ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,210,90,.8)'; ctx.stroke(); ctx.setLineDash([]);
    },
    thread(ctx, a, now) {
      if (now >= a.t1) {
        const f = clamp01((now - a.t1) / (a.t2 - a.t1)), rr = a.r0 + (a.r1 - a.r0) * f;
        ctx.strokeStyle = 'rgba(52,211,153,.9)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(a.x, a.y, rr + 22, a.gap - a.gw, a.gap + a.gw); ctx.stroke();
        return;
      }
      ctx.setLineDash([14, 10]); ctx.lineWidth = 5; ctx.strokeStyle = `rgba(255,90,90,${.4 + .4 * Math.sin(now / 70)})`;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r0, a.gap + a.gw, a.gap - a.gw + TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(52,211,153,.9)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(a.x, a.y, a.r0 + 22, a.gap - a.gw, a.gap + a.gw); ctx.stroke();
    },
  };
  function targets(ctx, a, now, fillBase, stroke, heart) {
    if (now >= a.t1) return;
    const f = clamp01((now - a.t0) / (a.t1 - a.t0));
    for (const [x, y] of a.circles) {
      ctx.fillStyle = `${fillBase}${.1 + .15 * f})`; ctx.beginPath(); ctx.arc(x, y, a.r, 0, TAU); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.beginPath(); ctx.arc(x, y, a.r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, a.r * (1 - f), 0, TAU); ctx.stroke();
      if (heart) { ctx.font = `${26 + 10 * f}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💖', x, y); }
      else { ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke(); }
    }
  }

  function drawTokens(ctx, now) {
    if (st.kind === 'comments') {
      // ✂️ Block tokens ride the dragon's body
      for (const [id, x, y] of live.tokens) {
        const p = .5 + .5 * Math.sin(now / 150 + id);
        ctx.fillStyle = `rgba(255,255,255,${.25 + .25 * p})`; ctx.beginPath(); ctx.arc(x, y, 34 + 4 * p, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e11d48'; ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 13, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 9, y + 9); ctx.lineTo(x + 9, y - 9); ctx.stroke();
      }
      return;
    }
    for (const [id, x, y, until] of st.tokens) {
      const bob = Math.sin(now / 300 + id) * 3, fade = clamp01((until - now) / 2500);
      ctx.globalAlpha = .55 + .45 * fade;
      if (st.kind === 'influencer') {
        ctx.fillStyle = 'rgba(255,95,162,.2)'; ctx.beginPath(); ctx.arc(x, y + bob, 30 + 3 * Math.sin(now / 200 + id), 0, TAU); ctx.fill();
        ctx.fillStyle = '#1f1029'; ctx.beginPath(); ctx.roundRect(x - 13, y - 21 + bob, 26, 42, 6); ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#ff5fa2'; ctx.stroke();
        // a person with a minus: "unfollow"
        ctx.fillStyle = '#ffd1e3'; ctx.beginPath(); ctx.arc(x - 3, y - 5 + bob, 4.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(x - 3, y + 7 + bob, 7, Math.PI, 0); ctx.fill();
        ctx.fillRect(x + 4, y - 6 + bob, 7, 2.5);
      } else {
        ctx.fillStyle = 'rgba(52,211,153,.18)'; ctx.beginPath(); ctx.arc(x, y, 30 + 3 * Math.sin(now / 200 + id), 0, TAU); ctx.fill();
        ctx.fillStyle = '#14532d'; ctx.beginPath(); ctx.ellipse(x, y + 10, 20, 7, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (let b = -2; b <= 2; b++) { ctx.beginPath(); ctx.moveTo(x + b * 5, y + 8); ctx.quadraticCurveTo(x + b * 8, y - 6 + bob, x + b * 9 + Math.sin(now / 250 + b) * 3, y - 18 + bob + Math.abs(b) * 2); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Top layer: live attacks and the boss over the snakes ----------
  function drawTop(ctx, now, look) {
    if (!present() && st.phase !== 'warning') return;
    for (const a of st.attacks) {
      if (now < a.t1 || now > a.t2 + 400) continue;
      if (top[a.type]) top[a.type](ctx, a, now);
    }
    if (fx.size > 400) fx.clear();
    if (st.kind === 'comments') drawMinions(ctx, now);
    if (st.phase === 'warning') return;
    ({ algorithm: drawAlgorithm, influencer: drawInfluencer, comments: drawDragon }[st.kind] || drawAlgorithm)(ctx, now, look);
  }
  const top = {
    slam(ctx, a, now) { const f = clamp01((now - a.t1) / 450), c = bodyCenter(); ctx.lineWidth = 30 * (1 - f) + 4; ctx.strokeStyle = `rgba(255,255,255,${1 - f})`; ctx.beginPath(); ctx.arc(c.x, c.y, R + (a.r - R) * f, 0, TAU); ctx.stroke(); },
    beam(ctx, a, now) {
      if (now > a.t2) return;
      const f = (now - a.t1) / (a.t2 - a.t1);
      for (let i = 0; i < a.count; i++) {
        const ang = a.a0 + i * TAU / a.count + a.sweep * f, x0 = Math.cos(ang) * R * .6, y0 = Math.sin(ang) * R * .6, x1 = Math.cos(ang) * a.len, y1 = Math.sin(ang) * a.len;
        ctx.lineCap = 'round';
        for (const [w, c] of [[a.w * 2.2, 'rgba(255,40,80,.18)'], [a.w, 'rgba(255,60,100,.75)'], [a.w * .38, 'rgba(255,245,250,.95)']]) { ctx.lineWidth = w * (1 + .08 * Math.sin(now / 30)); ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      }
    },
    stomp(ctx, a, now) {
      a.lines.forEach((pts, i) => {
        const s = a.t1 + i * a.step; if (now < s || now > s + 450) return;
        const key = `${a.id}:f${i}`; if (!fx.has(key)) { fx.add(key); const [x, y] = pts[Math.floor(pts.length / 2)]; api.burst(x, y, 14, ['#fb923c', '#ffc93c', '#fff'], { speed: 260, life: 500, size: 5 }); }
        const f = (now - s) / 450; ctx.lineJoin = 'round';
        for (const [w, c] of [[30, `rgba(251,146,60,${.35 * (1 - f)})`], [12, `rgba(255,210,120,${1 - f})`], [4, `rgba(255,255,255,${1 - f})`]]) { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      });
      if (now >= a.ringAt && now <= a.t2) ringArcs(ctx, a.r0 + (now - a.ringAt) / 1000 * a.speed, a.gaps.map(([ga, hw]) => [ga - hw, ga + hw]), a.ringW, ['rgba(251,146,60,.35)', 'rgba(255,220,150,.9)']);
    },
    rain(ctx, a, now) { impacts(ctx, a, now, 'rgba(255,240,220,', ['#ff5f7e', '#ffc93c', '#fff']); },
    hearts(ctx, a, now) { impacts(ctx, a, now, 'rgba(255,200,230,', ['#ff5fa2', '#fbcfe8', '#fff']); },
    flash(ctx, a) { const key = `${a.id}:flash`; if (!fx.has(key)) { fx.add(key); flash = 1; api.shake(10); } },
    ring(ctx, a, now) {
      if (now < a.ringAt || now > a.t2) return;
      const el = (now - a.ringAt) / 1000, rr = a.r0 + el * a.speed;
      ringArcs(ctx, rr, a.gaps.map(g => [g + a.spin * el - a.gw, g + a.spin * el + a.gw]), a.ringW, ['rgba(255,95,162,.35)', 'rgba(255,245,250,.95)']);
    },
    fire(ctx, a, now) {
      if (now > a.t2) return;
      for (let k = 0; k < 3; k++) {
        const len = a.len * (0.75 + 0.25 * Math.sin(now / 40 + k * 2)), half = a.half * (0.8 + 0.2 * Math.sin(now / 55 + k));
        const g = ctx.createRadialGradient(a.x, a.y, 10, a.x, a.y, len);
        g.addColorStop(0, 'rgba(255,255,220,.95)'); g.addColorStop(.35, 'rgba(255,170,40,.75)'); g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, len, a.ang - half, a.ang + half); ctx.closePath(); ctx.fill();
      }
      if (Math.random() < .5) api.burst(a.x + Math.cos(a.ang) * a.len * .6, a.y + Math.sin(a.ang) * a.len * .6, 2, ['#ffb020', '#ff5020'], { speed: 120, life: 400, size: 6 });
    },
    whip(ctx, a, now) {
      if (now > a.t2) return;
      const f = (now - a.t1) / (a.t2 - a.t1), cur = a.a0 + a.sweep * f;
      for (let k = 0; k < 6; k++) {
        const ang = cur - Math.sign(a.sweep) * k * 0.14;
        ctx.strokeStyle = `rgba(255,${200 - k * 20},90,${.8 - k * .12})`; ctx.lineWidth = 16 - k * 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.x + Math.cos(ang) * 30, a.y + Math.sin(ang) * 30); ctx.lineTo(a.x + Math.cos(ang) * a.r, a.y + Math.sin(ang) * a.r); ctx.stroke();
      }
    },
    thread(ctx, a, now) {
      if (now > a.t2) return;
      const f = clamp01((now - a.t1) / (a.t2 - a.t1)), rr = a.r0 + (a.r1 - a.r0) * f, n = Math.max(6, Math.floor(rr / 12));
      for (let i = 0; i < n; i++) {
        const ang = i / n * TAU + now / 900;
        const d = Math.abs(Math.atan2(Math.sin(ang - a.gap), Math.cos(ang - a.gap))); if (d < a.gw) continue;
        const x = a.x + Math.cos(ang) * rr, y = a.y + Math.sin(ang) * rr;
        ctx.fillStyle = i % 3 ? '#fff' : '#fecdd3'; ctx.beginPath(); ctx.roundRect(x - 14, y - 10, 28, 20, 8); ctx.fill();
        ctx.fillStyle = '#e11d48'; ctx.font = '900 11px Figtree, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(['L', '😡', '💀', '?!'][i % 4], x, y + .5);
      }
    },
  };
  function ringArcs(ctx, rr, cuts, w, colors) {
    cuts = cuts.map(([s0, e0]) => { const k = Math.floor(s0 / TAU); return [s0 - k * TAU, e0 - k * TAU]; }).sort((p, q) => p[0] - q[0]);
    ctx.lineCap = 'butt';
    for (const [c, mul] of [[colors[0], 1.6], [colors[1], .55]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w * mul;
      if (!cuts.length) { ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); continue; }
      let start = cuts[cuts.length - 1][1] - TAU;
      for (const [s0, e0] of cuts) { if (s0 > start) { ctx.beginPath(); ctx.arc(0, 0, rr, start, s0); ctx.stroke(); } start = e0; }
    }
  }
  function impacts(ctx, a, now, fillBase, colors) {
    const f = clamp01((now - a.t1) / 400);
    a.circles.forEach(([x, y], i) => {
      const key = `${a.id}:r${i}`; if (!fx.has(key)) { fx.add(key); api.burst(x, y, 18, colors, { speed: 300, life: 600, size: 5 }); }
      ctx.fillStyle = `${fillBase}${.8 * (1 - f)})`; ctx.beginPath(); ctx.arc(x, y, a.r * (.6 + .6 * f), 0, TAU); ctx.fill();
    });
  }
  function bodyCenter() { return live.body[0] ? { x: live.body[0][0], y: live.body[0][1] } : { x: 0, y: 0 }; }

  // Shared falling/leaving motion for the bosses that stay in the center
  function entrance(now) {
    let scale = 1, alpha = 1, y = Math.sin(now / 700) * 6;
    if (st.phase === 'active' && now - st.landAt < 600) { const f = (now - st.landAt) / 600; scale = 2.6 - 1.6 * f * f; alpha = f; }
    if (st.phase === 'leaving') {
      const f = clamp01(1 - (st.leaveAt - now) / 2500);
      if (st.outcome === 'down') { scale = 1 + .5 * f; alpha = 1 - f; } else { scale = 1 + 1.4 * f; alpha = 1 - f; y -= 200 * f * f; }
    }
    return { scale, alpha, y };
  }

  // 👁️ The Algorithm: a chrome shell around a giant eye, ringed with notifications
  function drawAlgorithm(ctx, now, look) {
    const { scale, alpha, y } = entrance(now), enr = st.enraged;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0, R * .95, R * .95 / scale, R * .28 / scale, 0, 0, TAU); ctx.fill();
    ctx.translate(0, y); ctx.scale(scale, scale);
    const glow = ctx.createRadialGradient(0, 0, R * .6, 0, 0, R * 1.6);
    glow.addColorStop(0, enr ? 'rgba(255,40,60,.35)' : 'rgba(167,139,250,.3)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, R * 1.6, 0, TAU); ctx.fill();
    const icons = ['❤️', '💬', '🔔', '👍', '🔁', '⭐', '📈', '👀'];
    ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.forEach((ic, i) => { const a = i / icons.length * TAU + now / (enr ? 900 : 1800); ctx.fillText(ic, Math.cos(a) * (R + 34), Math.sin(a) * (R + 34)); });
    const shell = ctx.createRadialGradient(-R * .35, -R * .45, R * .1, 0, 0, R);
    shell.addColorStop(0, '#f1f5f9'); shell.addColorStop(.45, '#8b95a7'); shell.addColorStop(1, '#1e2433');
    ctx.fillStyle = shell; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = enr ? '#ff5f7e' : '#c4b5fd'; ctx.stroke();
    ctx.strokeStyle = 'rgba(15,20,30,.45)'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + .2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * .72, Math.sin(a) * R * .72); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
    const blink = (now % 4200) < 140 ? .12 : 1;
    ctx.save(); ctx.scale(1, blink);
    const scl = ctx.createRadialGradient(-10, -14, 6, 0, 0, R * .66); scl.addColorStop(0, '#ffffff'); scl.addColorStop(1, '#cbd5e1');
    ctx.fillStyle = scl; ctx.beginPath(); ctx.arc(0, 0, R * .66, 0, TAU); ctx.fill();
    let lx = 0, ly = 0; if (look) { const d = Math.hypot(look.x, look.y) || 1; lx = look.x / d * 24; ly = look.y / d * 24; }
    const iris = ctx.createRadialGradient(lx, ly, 4, lx, ly, 40);
    iris.addColorStop(0, enr ? '#fde047' : '#f0abfc'); iris.addColorStop(.5, enr ? '#f43f5e' : '#a855f7'); iris.addColorStop(1, enr ? '#7f1d1d' : '#3b0764');
    ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(lx, ly, 40, 0, TAU); ctx.fill();
    ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(lx, ly, enr ? 12 : 18, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(lx - 12, ly - 14, 7, 0, TAU); ctx.fill();
    ctx.restore(); ctx.restore();
  }

  // 📸 The Influencer: a giant ring light with a camera-lens eye and a LIVE badge
  function drawInfluencer(ctx, now, look) {
    const { scale, alpha, y } = entrance(now), enr = st.enraged, RR = 110;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0, RR * 1.05, RR / scale, RR * .3 / scale, 0, 0, TAU); ctx.fill();
    ctx.translate(0, y); ctx.scale(scale, scale); ctx.rotate(Math.sin(now / 900) * .06);
    const glow = ctx.createRadialGradient(0, 0, RR * .7, 0, 0, RR * 1.9);
    glow.addColorStop(0, enr ? 'rgba(255,60,120,.45)' : 'rgba(255,240,250,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, RR * 1.9, 0, TAU); ctx.fill();
    const flick = enr ? (Math.random() < .15 ? .4 : 1) : 1;
    ctx.lineWidth = 26; ctx.strokeStyle = `rgba(255,248,252,${.95 * flick})`; ctx.beginPath(); ctx.arc(0, 0, RR, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = enr ? '#ff5fa2' : '#f9a8d4'; ctx.beginPath(); ctx.arc(0, 0, RR + 14, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, RR - 14, 0, TAU); ctx.stroke();
    for (let i = 0; i < 28; i++) { const a = i / 28 * TAU + now / 3000; ctx.fillStyle = (i + Math.floor(now / 120)) % 7 === 0 ? '#ffd1e3' : '#ffffff'; ctx.beginPath(); ctx.arc(Math.cos(a) * RR, Math.sin(a) * RR, 4, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#0f0a16'; ctx.beginPath(); ctx.roundRect(-46, -72, 92, 144, 18); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#3b2b4f'; ctx.stroke();
    let lx = 0, ly = 0; if (look) { const d = Math.hypot(look.x, look.y) || 1; lx = look.x / d * 10; ly = look.y / d * 10; }
    for (const [r, c] of [[34, '#1f1530'], [28, '#2d1b46'], [21, enr ? '#be123c' : '#7e22ce'], [13, enr ? '#fda4af' : '#e879f9'], [7, '#05030a']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(lx * (r < 25 ? 1 : .3), ly * (r < 25 ? 1 : .3), r, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(lx - 7, ly - 8, 4, 0, TAU); ctx.fill();
    const pulse = .6 + .4 * Math.sin(now / 200);
    ctx.fillStyle = '#e11d48'; ctx.beginPath(); ctx.roundRect(-30, -RR - 48, 60, 24, 8); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${pulse})`; ctx.beginPath(); ctx.arc(-17, -RR - 36, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 13px Figtree, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('LIVE', 6, -RR - 35.5);
    ctx.font = '900 16px Figtree, system-ui'; ctx.fillStyle = '#ffd1e3'; ctx.fillText(`${followers()} followers`, 0, RR + 40);
    ctx.restore();
  }
  const followers = () => { const v = Math.max(0, st.hp || 0) / (st.hpMax || 1) * 1.2; return v >= 1 ? `${v.toFixed(1)}M` : `${Math.round(v * 1000)}K`; };

  // 💬 The Comment Section: a dragon made of angry comment bubbles
  const SNIPPETS = ['L', 'ratio', 'mid', 'cringe', '💀', '🤡', 'who asked', '😡', '?!', 'fake', 'flop', 'yikes'];
  function drawDragon(ctx, now) {
    const b = live.body; if (!b.length) return;
    let alpha = 1;
    if (st.phase === 'leaving') alpha = clamp01((st.leaveAt - now) / 2500);
    if (st.phase === 'active' && now - st.landAt < 600) alpha = (now - st.landAt) / 600;
    ctx.save(); ctx.globalAlpha = alpha;
    const enr = st.enraged;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 58; ctx.beginPath(); b.forEach(([x, y], i) => (i ? ctx.lineTo(x + 6, y + 12) : ctx.moveTo(x + 6, y + 12))); ctx.stroke();
    ctx.strokeStyle = enr ? '#7f1d1d' : '#4c0519'; ctx.lineWidth = 50; ctx.beginPath(); b.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    for (let i = b.length - 1; i >= 1; i--) {
      const [x, y] = b[i], [px, py] = b[i - 1], ang = Math.atan2(py - y, px - x), r = 28 - i * 0.25;
      ctx.fillStyle = enr ? '#f43f5e' : '#be123c';
      ctx.beginPath(); ctx.moveTo(x + Math.cos(ang + Math.PI / 2) * r, y + Math.sin(ang + Math.PI / 2) * r); ctx.lineTo(x + Math.cos(ang + Math.PI / 2) * (r + 14) - Math.cos(ang) * 8, y + Math.sin(ang + Math.PI / 2) * (r + 14) - Math.sin(ang) * 8); ctx.lineTo(x - Math.cos(ang) * 12 + Math.cos(ang + Math.PI / 2) * r, y - Math.sin(ang) * 12 + Math.sin(ang + Math.PI / 2) * r); ctx.fill();
      ctx.fillStyle = i % 2 ? '#fff1f2' : '#ffe4e6'; ctx.beginPath(); ctx.roundRect(x - r, y - r * .72, r * 2, r * 1.44, r * .5); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#9f1239'; ctx.stroke();
      ctx.fillStyle = '#be123c'; ctx.font = `900 ${Math.max(10, r * .5)}px Figtree, system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SNIPPETS[i % SNIPPETS.length], x, y + 1);
    }
    const [hx, hy] = b[0], ha = b[1] ? Math.atan2(hy - b[1][1], hx - b[1][0]) : live.ang;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ha);
    ctx.fillStyle = '#1c0a10';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-14, s * 30); ctx.lineTo(-44, s * 58); ctx.lineTo(-4, s * 40); ctx.fill(); }
    const hg = ctx.createRadialGradient(-10, -14, 6, 0, 0, 52); hg.addColorStop(0, enr ? '#fb7185' : '#fda4af'); hg.addColorStop(1, enr ? '#9f1239' : '#be123c');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.roundRect(-46, -38, 92, 76, 30); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-30, 30); ctx.lineTo(-48, 50); ctx.lineTo(-10, 36); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#4c0519'; ctx.beginPath(); ctx.roundRect(-46, -38, 92, 76, 30); ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(12, s * 15, 11, 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = enr ? '#facc15' : '#e11d48'; ctx.beginPath(); ctx.arc(15, s * 15, 4.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1c0a10'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(2, s * 28); ctx.lineTo(24, s * 8); ctx.stroke();
    }
    ctx.fillStyle = '#1c0a10'; ctx.beginPath(); ctx.moveTo(34, -12); ctx.lineTo(48, 0); ctx.lineTo(34, 12); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  function drawMinions(ctx, now) {
    for (const [id, m] of live.mins) {
      const bob = Math.sin(now / 120 + id) * 3;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(m.x + 2, m.y + 16, 14, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e11d48'; ctx.beginPath(); ctx.roundRect(m.x - 18, m.y - 13 + bob, 36, 26, 10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(m.x - 8, m.y + 11 + bob); ctx.lineTo(m.x - 14, m.y + 20 + bob); ctx.lineTo(m.x - 1, m.y + 12 + bob); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '900 13px Figtree, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!!', m.x, m.y + bob + 1);
    }
  }

  // Camera flash covers the whole screen (drawn in screen space)
  function drawScreen(ctx, W, H) {
    if (flash <= 0) return;
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash) * .85})`; ctx.fillRect(0, 0, W, H);
  }

  // ---------- HUD bar under the status line ----------
  function hud(el, now) {
    if (st.phase === 'idle' || !st.kind) { el.hidden = true; return; }
    el.hidden = false;
    const small = innerWidth < 640, s = v => Math.max(0, Math.ceil(v / 1000)), ic = SHORT[st.kind];
    if (st.phase === 'warning') { el.className = 'glass warn'; el.textContent = small ? `⚠️ ${ic} in ${s(st.landAt - now)}` : `⚠️ ${st.name} lands in ${s(st.landAt - now)}`; return; }
    if (st.phase === 'leaving') { el.className = 'glass'; el.textContent = st.outcome === 'down' ? `🎉 ${st.name} defeated` : `${ic} ${st.name} left`; return; }
    const left = Math.max(0, st.endsAt - now), clock = `${Math.floor(s(left) / 60)}:${String(s(left) % 60).padStart(2, '0')}`;
    let goal;
    if (st.kind === 'algorithm') goal = `🌱 ${Math.round((st.cut || 0) / 1000)}/${Math.round((st.need || 30000) / 1000)}s${small ? '' : ' to log it off'}`;
    else if (st.kind === 'influencer') goal = `📵 ${followers()}${small ? '' : ' followers left'}`;
    else goal = `✂️ ${Math.max(0, (st.hp || 0) - 4)}${small ? '' : ' segments to block'}`;
    el.className = 'glass' + (st.enraged ? ' enraged' : '');
    el.textContent = small ? `${ic} ${clock} · ${goal}` : `${ic} ${st.name} ${clock} · ${goal}`;
  }

  function mini(mctx, c, k, now) {
    if (!present() && st.phase !== 'warning') return;
    mctx.fillStyle = st.phase === 'warning' ? `rgba(255,60,90,${.4 + .4 * Math.sin(now / 150)})` : '#ff5f7e';
    if (st.kind === 'comments' && live.body.length && st.phase !== 'warning') {
      mctx.strokeStyle = '#ff5f7e'; mctx.lineWidth = 5; mctx.lineCap = 'round'; mctx.beginPath();
      live.body.forEach(([x, y], i) => (i ? mctx.lineTo(c + x * k, c + y * k) : mctx.moveTo(c + x * k, c + y * k))); mctx.stroke();
      mctx.beginPath(); mctx.arc(c + live.body[0][0] * k, c + live.body[0][1] * k, 6, 0, TAU); mctx.fill();
      for (const m of live.mins.values()) { mctx.beginPath(); mctx.arc(c + m.x * k, c + m.y * k, 2.5, 0, TAU); mctx.fill(); }
    } else { mctx.beginPath(); mctx.arc(c, c, Math.max(6, R * k), 0, TAU); mctx.fill(); }
    mctx.fillStyle = st.kind === 'influencer' ? '#ff8cc0' : st.kind === 'comments' ? '#fff' : '#4ade80';
    const toks = st.kind === 'comments' ? live.tokens : st.tokens;
    for (const t of toks) { mctx.beginPath(); mctx.arc(c + t[1] * k, c + t[2] * k, 3.5, 0, TAU); mctx.fill(); }
  }

  return { init, onSnapshot, onLive, onAttack, onEvent, drawGround, drawTop, drawScreen, hud, mini, get state() { return st; } };
})();
