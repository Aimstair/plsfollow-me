// THE ALGORITHM: drawing and HUD for the boss. The server decides everything; this file draws the
// warning zones, attacks, grass and the boss itself at the same server-time moment as the rest of the
// world, so what you see is what hits.
window.PFBoss = (() => {
  'use strict';
  const TAU = Math.PI * 2;
  const R = 120, SLAM_R = 350;
  let st = { phase: 'idle', attacks: [], grass: [] };
  const fx = new Set(); // one-shot effects already fired (impacts, eruptions)
  let api = null;       // helpers from the game: { burst, shake, sfx, toast, name, myHead, now }

  function init(a) { api = a; }
  function onSnapshot(m) {
    const prev = st.phase, wasEnraged = !!st.enraged;
    st = { ...m, attacks: m.attacks || [], grass: m.grass || [] };
    if (prev !== st.phase) onPhase(prev, st.phase);
    if (st.enraged && !wasEnraged && st.phase === 'active') { api.at('bossRoar', 0); api.shake(10); api.toast('👁️ THE ALGORITHM IS ENRAGED', true); }
    music();
  }
  // Boss theme follows the fight: warning → fight → enraged, back to lo-fi when it's gone
  function music() { api.music(st.phase === 'warning' ? 0 : st.phase === 'active' ? (st.enraged ? 2 : 1) : null); }
  // Each attack's sounds are scheduled on the game clock: wind-up during the warning, impact on the hit
  function onAttack(a) {
    if (st.attacks.some(x => x.id === a.id)) return;
    st.attacks.push(a);
    const now = api.now(), at = (name, time, o) => api.at(name, (time - now) / 1000, o);
    if (a.type === 'beam') {
      at('bossCharge', a.t0, { dur: (a.t1 - a.t0) / 1000 });
      at('bossBlast', a.t1); at('bossHum', a.t1, { dur: (a.t2 - a.t1) / 1000 }); at('bossPowerDown', a.t2);
    } else if (a.type === 'stomp') {
      at('bossRumble', a.t0, { dur: (a.t1 - a.t0) / 1000 }); at('bossStomp', a.t1);
      a.lines.forEach((_, i) => at('bossCrackle', a.t1 + i * a.step));
      at('bossWave', a.ringAt);
    } else if (a.type === 'rain') {
      const me = api.myHead(), dur = (a.t1 - a.t0) / 1000;
      for (let i = 0; i < Math.min(3, a.circles.length); i++) at('bossWhistle', a.t0 + i * 120, { dur: dur - i * 0.12 });
      // louder the closer an impact lands to you
      const near = me ? Math.min(...a.circles.map(([x, y]) => Math.hypot(x - me.x, y - me.y))) : 800;
      const g = Math.max(0.35, Math.min(1, 1 - near / 1400));
      for (let i = 0; i < Math.min(4, a.circles.length); i++) at('bossImpact', a.t1 + i * 45, { g: g * (i ? 0.6 : 1) });
    } else if (a.type === 'doom') {
      at('bossWarp', a.t0, { dur: (a.t2 - a.t0) / 1000 });
    }
  }
  function onPhase(prev, ph) {
    if (ph === 'warning') {
      api.sfx('bossSiren'); api.toast('⚠️ THE ALGORITHM is coming! Get away from the center', true);
      // a rising sweep for the whole warning, the incoming whistle, then the crash right on the landing
      const now = api.now(), until = (st.landAt - now) / 1000;
      api.at('bossRiser', 0, { dur: until }); api.at('bossFall', until - 1.4); api.at('bossSlam', until);
    }
    else if (ph === 'active' && prev === 'warning') { api.shake(22); api.burst(0, 0, 60, ['#ff5f7e', '#fff', '#a78bfa', '#ffc93c'], { speed: 520, life: 1000, size: 7 }); }
    else if (ph === 'leaving') {
      if (st.outcome === 'down') { api.sfx('bossDown'); api.shake(18); api.burst(0, 0, 90, ['#34d399', '#ffc93c', '#fff', '#7dd3fc', '#ff5fa2'], { speed: 620, life: 1400, size: 8, grav: 120 }); api.toast(`🎉 The Algorithm got logged off!${st.by ? ' Last grass: ' + api.name(st.by) : ''}`, true); }
      else { api.sfx('bossLeave'); api.toast('👁️ The Algorithm got bored and left. Back in 3 minutes.'); }
    }
  }
  function onEvent(e, mine) {
    if (e.k === 'grass') {
      api.burst(e.x, e.y, 20, ['#34d399', '#bbf7d0', '#fff'], { speed: 240, life: 700, size: 5 });
      st.endsAt = e.endsAt; st.cut = e.total;
      st.grass = st.grass.filter(g => Math.hypot(g[1] - e.x, g[2] - e.y) > 2);
      if (e.pid === mine.pid) { api.sfx('bossGrass'); api.toast(`🌱 You touched grass! −${e.cut / 1000}s for the Algorithm`, true); }
      else api.toast(`🌱 ${api.name(e.pid)} touched grass (−${e.cut / 1000}s)`);
    } else if (e.k === 'bossHit') {
      api.burst(e.x, e.y, 26, ['#ff5f7e', '#fff', '#a78bfa'], { speed: 320, life: 650, size: 5 });
      if (e.sid !== mine.sid) return;
      const what = { beam: '👁️ Shadowbanned!', stomp: '💥 Stomped!', rain: '☄️ Ratioed!', slam: '💥 Slammed!', body: '👁️ Bumped the Algorithm!' }[e.atk] || '👁️ Hit!';
      api.shake(14); api.sfx('bossHurt');
      if (e.head) api.toast(e.pid === mine.pid ? `${what} −5s and stunned` : `${what} Your head lost 5s`);
      else api.toast(mine.idx >= e.k2 ? `${what} You got split off into a new snake` : `${what} ${e.n} people split off your snake`);
    }
  }

  const present = () => st.phase === 'active' || st.phase === 'leaving';
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ---------- Ground layer: warnings under the snakes ----------
  function drawGround(ctx, now) {
    if (st.phase === 'warning') {
      const f = clamp01(1 - (st.landAt - now) / 8000), pulse = .5 + .5 * Math.sin(now / 120);
      ctx.fillStyle = `rgba(0,0,0,${.25 + .35 * f})`; ctx.beginPath(); ctx.ellipse(0, 20, R * (0.4 + f), R * (0.25 + .6 * f), 0, 0, TAU); ctx.fill();
      ctx.setLineDash([18, 14]); ctx.lineWidth = 6; ctx.strokeStyle = `rgba(255,60,90,${.35 + .4 * pulse})`;
      ctx.beginPath(); ctx.arc(0, 0, SLAM_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,40,80,${.06 + .06 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, SLAM_R, 0, TAU); ctx.fill();
    }
    if (!present()) return;
    for (const a of st.attacks) {
      if (now < a.t0 || now > a.t2 + 400) continue;
      if (a.type === 'beam' && now < a.t1) {
        const f = (now - a.t0) / (a.t1 - a.t0);
        for (let i = 0; i < a.count; i++) {
          const ang = a.a0 + i * TAU / a.count;
          // sweep wedge, then the aim line
          ctx.fillStyle = `rgba(255,40,80,${.05 + .07 * f})`; ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, a.len, Math.min(ang, ang + a.sweep), Math.max(ang, ang + a.sweep)); ctx.closePath(); ctx.fill();
          ctx.setLineDash([14, 10]); ctx.lineWidth = 3 + 3 * f; ctx.strokeStyle = `rgba(255,70,100,${.5 + .4 * f})`;
          ctx.beginPath(); ctx.moveTo(Math.cos(ang) * R, Math.sin(ang) * R); ctx.lineTo(Math.cos(ang) * a.len, Math.sin(ang) * a.len); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (a.type === 'stomp') {
        a.lines.forEach((pts, i) => {
          const s = a.t1 + i * a.step;
          if (now > s + 450) { ctx.strokeStyle = 'rgba(40,20,30,.55)'; ctx.lineWidth = 6; }
          else if (now < s) { const p = .5 + .5 * Math.sin(now / 70 + i); ctx.strokeStyle = `rgba(255,140,60,${.35 + .4 * p})`; ctx.lineWidth = 5; ctx.setLineDash([10, 8]); }
          else return;
          ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
        });
        if (now < a.ringAt) {
          // where the shockwave will be safe: green gaps on the outer edge
          for (const [ga, hw] of a.gaps) { ctx.strokeStyle = 'rgba(52,211,153,.75)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, R + 40, ga - hw, ga + hw); ctx.stroke(); }
        }
      }
      if (a.type === 'rain' && now < a.t1) {
        const f = clamp01((now - a.t0) / (a.t1 - a.t0));
        for (const [x, y] of a.circles) {
          ctx.fillStyle = `rgba(255,40,80,${.1 + .15 * f})`; ctx.beginPath(); ctx.arc(x, y, a.r, 0, TAU); ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,80,110,.85)'; ctx.beginPath(); ctx.arc(x, y, a.r, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, a.r * (1 - f), 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
        }
      }
      if (a.type === 'doom') {
        const live = now >= a.t1 && now <= a.t2, alpha = live ? .5 : .25;
        ctx.lineWidth = 4; ctx.strokeStyle = `rgba(167,139,250,${alpha})`;
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          for (let r = R; r < 900; r += 30) { const ang = i / 6 * TAU + now / 500 + r / 160; (r === R ? ctx.moveTo : ctx.lineTo).call(ctx, Math.cos(ang) * r, Math.sin(ang) * r); }
          ctx.stroke();
        }
      }
    }
    // 🌱 grass tokens
    for (const [id, x, y, until] of st.grass) {
      const bob = Math.sin(now / 300 + id) * 3, fade = clamp01((until - now) / 2500);
      ctx.globalAlpha = .55 + .45 * fade;
      ctx.fillStyle = 'rgba(52,211,153,.18)'; ctx.beginPath(); ctx.arc(x, y, 30 + 3 * Math.sin(now / 200 + id), 0, TAU); ctx.fill();
      ctx.fillStyle = '#14532d'; ctx.beginPath(); ctx.ellipse(x, y + 10, 20, 7, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let b = -2; b <= 2; b++) { ctx.beginPath(); ctx.moveTo(x + b * 5, y + 8); ctx.quadraticCurveTo(x + b * 8, y - 6 + bob, x + b * 9 + Math.sin(now / 250 + b) * 3, y - 18 + bob - Math.abs(b) * -2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Top layer: the boss and live attacks over the snakes ----------
  function drawTop(ctx, now, look) {
    if (!present() && st.phase !== 'warning') return;
    for (const a of st.attacks) {
      if (now < a.t1 || now > a.t2 + 400) continue;
      if (a.type === 'slam') {
        const f = clamp01((now - a.t1) / 450);
        ctx.lineWidth = 30 * (1 - f) + 4; ctx.strokeStyle = `rgba(255,255,255,${1 - f})`; ctx.beginPath(); ctx.arc(0, 0, R + (a.r - R) * f, 0, TAU); ctx.stroke();
      }
      if (a.type === 'beam' && now <= a.t2) {
        const f = (now - a.t1) / (a.t2 - a.t1);
        for (let i = 0; i < a.count; i++) {
          const ang = a.a0 + i * TAU / a.count + a.sweep * f, x0 = Math.cos(ang) * R * .6, y0 = Math.sin(ang) * R * .6, x1 = Math.cos(ang) * a.len, y1 = Math.sin(ang) * a.len;
          ctx.lineCap = 'round';
          for (const [w, c] of [[a.w * 2.2, 'rgba(255,40,80,.18)'], [a.w, 'rgba(255,60,100,.75)'], [a.w * .38, 'rgba(255,245,250,.95)']]) {
            ctx.lineWidth = w * (1 + .08 * Math.sin(now / 30)); ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          }
        }
      }
      if (a.type === 'stomp') {
        a.lines.forEach((pts, i) => {
          const s = a.t1 + i * a.step; if (now < s || now > s + 450) return;
          const key = `${a.id}:f${i}`; if (!fx.has(key)) { fx.add(key); const [x, y] = pts[Math.floor(pts.length / 2)]; api.burst(x, y, 14, ['#fb923c', '#ffc93c', '#fff'], { speed: 260, life: 500, size: 5 }); }
          const f = (now - s) / 450;
          ctx.lineJoin = 'round';
          for (const [w, c] of [[30, `rgba(251,146,60,${.35 * (1 - f)})`], [12, `rgba(255,210,120,${1 - f})`], [4, `rgba(255,255,255,${1 - f})`]]) {
            ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath(); pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
          }
        });
        if (now >= a.ringAt && now <= a.t2) {
          const rr = a.r0 + (now - a.ringAt) / 1000 * a.speed;
          // the ring, drawn as arcs that skip the safe gaps
          const cuts = a.gaps.map(([ga, hw]) => [ga - hw, ga + hw]).sort((p, q) => p[0] - q[0]);
          ctx.lineWidth = a.ringW; ctx.lineCap = 'butt';
          for (const [c, w] of [['rgba(251,146,60,.35)', 1.6], ['rgba(255,220,150,.9)', .55]]) {
            ctx.strokeStyle = c; ctx.lineWidth = a.ringW * w;
            let start = cuts.length ? cuts[cuts.length - 1][1] - TAU : 0;
            if (!cuts.length) { ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); }
            for (const [s0, e0] of cuts) { ctx.beginPath(); ctx.arc(0, 0, rr, start, s0); ctx.stroke(); start = e0; }
          }
        }
      }
      if (a.type === 'rain' && now >= a.t1) {
        const f = clamp01((now - a.t1) / 400);
        a.circles.forEach(([x, y], i) => {
          const key = `${a.id}:r${i}`; if (!fx.has(key)) { fx.add(key); api.burst(x, y, 18, ['#ff5f7e', '#ffc93c', '#fff'], { speed: 300, life: 600, size: 5 }); }
          ctx.fillStyle = `rgba(255,240,220,${.8 * (1 - f)})`; ctx.beginPath(); ctx.arc(x, y, a.r * (.6 + .6 * f), 0, TAU); ctx.fill();
        });
      }
    }
    if (fx.size > 400) fx.clear();
    drawBody(ctx, now, look);
  }

  // The Algorithm itself: a chrome shell around a giant eye, ringed with notification icons
  function drawBody(ctx, now, look) {
    let scale = 1, alpha = 1, y = Math.sin(now / 700) * 6;
    if (st.phase === 'warning') return;
    if (st.phase === 'active' && now - st.landAt < 600) { const f = (now - st.landAt) / 600; scale = 2.6 - 1.6 * f * f; alpha = f; }
    if (st.phase === 'leaving') {
      const f = clamp01(1 - (st.leaveAt - now) / 2500);
      if (st.outcome === 'down') { scale = 1 + .5 * f; alpha = 1 - f; } else { scale = 1 + 1.4 * f; alpha = 1 - f; y -= 200 * f * f; }
    }
    const enr = st.enraged;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0, R * .95, R * .95 / scale, R * .28 / scale, 0, 0, TAU); ctx.fill();
    ctx.translate(0, y); ctx.scale(scale, scale);
    // glow
    const glow = ctx.createRadialGradient(0, 0, R * .6, 0, 0, R * 1.6);
    glow.addColorStop(0, enr ? 'rgba(255,40,60,.35)' : 'rgba(167,139,250,.3)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, R * 1.6, 0, TAU); ctx.fill();
    // orbiting notifications
    const icons = ['❤️', '💬', '🔔', '👍', '🔁', '⭐', '📈', '👀'];
    ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    icons.forEach((ic, i) => { const a = i / icons.length * TAU + now / (enr ? 900 : 1800); ctx.fillText(ic, Math.cos(a) * (R + 34), Math.sin(a) * (R + 34)); });
    // chrome shell
    const shell = ctx.createRadialGradient(-R * .35, -R * .45, R * .1, 0, 0, R);
    shell.addColorStop(0, '#f1f5f9'); shell.addColorStop(.45, '#8b95a7'); shell.addColorStop(1, '#1e2433');
    ctx.fillStyle = shell; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = enr ? '#ff5f7e' : '#c4b5fd'; ctx.stroke();
    ctx.strokeStyle = 'rgba(15,20,30,.45)'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + .2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * .72, Math.sin(a) * R * .72); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
    // eye, with a blink every few seconds
    const blink = (now % 4200) < 140 ? .12 : 1;
    ctx.save(); ctx.scale(1, blink);
    const scl = ctx.createRadialGradient(-10, -14, 6, 0, 0, R * .66);
    scl.addColorStop(0, '#ffffff'); scl.addColorStop(1, '#cbd5e1');
    ctx.fillStyle = scl; ctx.beginPath(); ctx.arc(0, 0, R * .66, 0, TAU); ctx.fill();
    let lx = 0, ly = 0;
    if (look) { const d = Math.hypot(look.x, look.y) || 1; lx = look.x / d * 24; ly = look.y / d * 24; }
    const iris = ctx.createRadialGradient(lx, ly, 4, lx, ly, 40);
    iris.addColorStop(0, enr ? '#fde047' : '#f0abfc'); iris.addColorStop(.5, enr ? '#f43f5e' : '#a855f7'); iris.addColorStop(1, enr ? '#7f1d1d' : '#3b0764');
    ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(lx, ly, 40, 0, TAU); ctx.fill();
    ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.arc(lx, ly, enr ? 12 : 18, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(lx - 12, ly - 14, 7, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // ---------- HUD bar under the status line ----------
  function hud(el, now) {
    if (st.phase === 'idle') { el.hidden = true; return; }
    el.hidden = false;
    const s = v => Math.max(0, Math.ceil(v / 1000));
    if (st.phase === 'warning') { el.className = 'glass warn'; el.textContent = innerWidth < 640 ? `⚠️ Algorithm in ${s(st.landAt - now)}` : `⚠️ THE ALGORITHM lands in ${s(st.landAt - now)}`; return; }
    if (st.phase === 'leaving') { el.className = 'glass'; el.textContent = st.outcome === 'down' ? '🎉 The Algorithm was logged off' : '👁️ The Algorithm left'; return; }
    const left = Math.max(0, st.endsAt - now), mm = Math.floor(s(left) / 60), ss = String(s(left) % 60).padStart(2, '0');
    el.className = 'glass' + (st.enraged ? ' enraged' : '');
    const cut = `${Math.round((st.cut || 0) / 1000)}/${Math.round((st.need || 30000) / 1000)}s`;
    el.textContent = innerWidth < 640 ? `👁️ ${mm}:${ss} · 🌱 ${cut}` : `👁️ THE ALGORITHM ${mm}:${ss} · 🌱 ${cut} to log it off`;
  }

  function mini(mctx, c, k, now) {
    if (!present() && st.phase !== 'warning') return;
    mctx.fillStyle = st.phase === 'warning' ? `rgba(255,60,90,${.4 + .4 * Math.sin(now / 150)})` : '#ff5f7e';
    mctx.beginPath(); mctx.arc(c, c, Math.max(6, R * k), 0, TAU); mctx.fill();
    mctx.fillStyle = '#4ade80';
    for (const [, x, y] of st.grass) { mctx.beginPath(); mctx.arc(c + x * k, c + y * k, 3.5, 0, TAU); mctx.fill(); }
  }

  return { init, onSnapshot, onAttack, onEvent, drawGround, drawTop, hud, mini, get state() { return st; } };
})();
