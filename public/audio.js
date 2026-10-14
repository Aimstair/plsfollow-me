// Procedural audio for plsfollow.me: a generative lo-fi loop and synthesized sound effects.
// Nothing is downloaded; every sound is built with Web Audio. Browsers only allow audio after a
// tap or click, so the game calls PFAudio.unlock() from its first user gesture.
window.PFAudio = (() => {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const prefs = { music: true, sfx: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('pf-audio') || '{}')); } catch { /* storage blocked */ }
  const save = () => { try { localStorage.setItem('pf-audio', JSON.stringify(prefs)); } catch { /* storage blocked */ } };

  let ctx = null, master, musicBus, sfxBus, reverb, delay, padFilter, crackle = null, crackleGain = null, timer = 0, nextTime = 0, step = 0;
  let mode = 'lofi', intensity = 0, theme = 'algorithm'; // music mode: 'lofi', or 'boss' with intensity 0 (warning) / 1 (fight) / 2 (enraged)
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Graph ----------
  function build() {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = prefs.sfx ? 0.55 : 0; sfxBus.connect(master);

    // Generated room reverb: stereo noise with an exponential tail
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.42; reverb.connect(wet).connect(musicBus);

    // Soft dotted-eighth echo for the plucks
    delay = ctx.createDelay(2); delay.delayTime.value = 0.625;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
    delay.connect(dlp).connect(fb).connect(delay);
    const dwet = ctx.createGain(); dwet.gain.value = 0.35; dlp.connect(dwet).connect(musicBus);

    // Pads share one warm filter that slowly breathes
    padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900; padFilter.Q.value = 0.6;
    const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.07; lfoAmt.gain.value = 350; lfo.connect(lfoAmt).connect(padFilter.frequency); lfo.start();
    padFilter.connect(musicBus); padFilter.connect(reverb);

    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  // ---------- Music ----------
  const BPM = 72, EIGHTH = 60 / BPM / 2, STEPS_PER_CHORD = 16;
  // Fmaj9 → Em7 → Dm9 → Cmaj9, two bars each
  const CHORDS = [
    { bass: 41, pad: [57, 60, 64, 67] },
    { bass: 40, pad: [55, 59, 62, 64] },
    { bass: 38, pad: [53, 57, 60, 64] },
    { bass: 36, pad: [52, 55, 59, 62] },
  ];
  const PENTA = [72, 74, 76, 79, 81, 84, 86];

  function pad(notes, t, dur) {
    for (const n of notes) for (const [type, det, g] of [['triangle', -7, 0.05], ['sawtooth', 7, 0.018]]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = type; o.frequency.value = mtof(n); o.detune.value = det;
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(g, t + 1.6);
      e.gain.setValueAtTime(g, t + dur - 0.4);
      e.gain.linearRampToValueAtTime(0, t + dur + 1.8);
      o.connect(e).connect(padFilter); o.start(t); o.stop(t + dur + 2);
    }
  }
  function bass(n, t, dur) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.type = 'sine'; o.frequency.value = mtof(n);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.22, t + 0.03); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(e).connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function pluck(n, t, vel) {
    const o = ctx.createOscillator(), e = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = mtof(n);
    f.type = 'lowpass'; f.frequency.value = 2600;
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.07 * vel, t + 0.008); e.gain.exponentialRampToValueAtTime(0.0008, t + 1.1);
    o.connect(f).connect(e); e.connect(musicBus); e.connect(delay); e.connect(reverb);
    o.start(t); o.stop(t + 1.2);
  }
  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s;
  }
  function kick(t, g = 0.32) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(e).connect(musicBus); o.start(t); o.stop(t + 0.35);
  }
  function brush(t, g, freq, len) {
    const s = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0005, t + len);
    s.connect(f).connect(e).connect(musicBus); s.start(t, rand(0, 0.5)); s.stop(t + len + 0.02);
  }
  function startCrackle() {
    const len = ctx.sampleRate * 4, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.015 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.6 : 0);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; s.loop = true; f.type = 'highpass'; f.frequency.value = 900; g.gain.value = mode === 'boss' ? 0 : 0.16;
    s.connect(f).connect(g).connect(musicBus); s.start();
    crackle = s; crackleGain = g;
  }

  function playStep(i, t) {
    const c = CHORDS[Math.floor(i / STEPS_PER_CHORD) % CHORDS.length], s = i % STEPS_PER_CHORD;
    const swing = i % 2 ? EIGHTH * 0.16 : 0, tt = t + swing;
    if (s === 0) pad(c.pad, t, EIGHTH * STEPS_PER_CHORD);
    if (s === 0 || s === 8) bass(c.bass, t, EIGHTH * 6);
    if (s === 11 && Math.random() < 0.5) bass(c.bass + 7, tt, EIGHTH * 2);
    if (s % 8 === 0 || (s % 8 === 5 && Math.random() < 0.6)) kick(tt, s % 8 ? 0.2 : 0.3);
    if (s % 8 === 4) brush(t, 0.09, 1800, 0.22);
    if (i % 2) brush(tt, 0.025, 7000, 0.05);
    // A lazy melody: mostly rests, notes picked from the pentatonic scale near the last one
    if (Math.random() < (s % 4 === 0 ? 0.5 : 0.28)) {
      playStep.last = Math.max(0, Math.min(PENTA.length - 1, (playStep.last ?? 3) + Math.round(rand(-2, 2))));
      pluck(PENTA[playStep.last], tt + rand(0, 0.015), rand(0.6, 1));
    }
  }
  // ---------- Final boss theme ----------
  // D harmonic minor, Dm - Bb - Gm - A, one bar each: driving bass, timpani, choir, brass stabs, a bell
  // ostinato and drums. Intensity 0 = warning (drums, bass, timpani), 1 = the fight, 2 = enraged.
  const BOSS_PROG = [
    { root: 38, chord: [50, 53, 57] },  // Dm
    { root: 34, chord: [46, 50, 53] },  // Bb
    { root: 31, chord: [43, 46, 50] },  // Gm
    { root: 33, chord: [45, 49, 52] },  // A (the raised C# makes it sound epic)
  ];
  const bossEighth = () => 60 / (intensity >= 2 ? 152 : 138) / 2;
  function bossBass(n, t, dur) {
    for (const [type, g, det] of [['sawtooth', 0.09, 0], ['sine', 0.16, 0]]) {
      const o = ctx.createOscillator(), e = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = mtof(n); o.detune.value = det;
      f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + dur);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.01); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f).connect(e).connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function bigKick(t, g = 0.45) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(e).connect(musicBus); o.start(t); o.stop(t + 0.42);
  }
  function snare(t, g = 0.16) {
    const s = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    s.connect(f).connect(e); e.connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.5; e.connect(v).connect(reverb);
    s.start(t, rand(0, 0.5)); s.stop(t + 0.25);
    const o = ctx.createOscillator(), oe = ctx.createGain(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    oe.gain.setValueAtTime(g * 0.8, t); oe.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(oe).connect(musicBus); o.start(t); o.stop(t + 0.12);
  }
  function hat(t, g = 0.03) {
    const s = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 7500;
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
    s.connect(f).connect(e).connect(musicBus); s.start(t, rand(0, 0.5)); s.stop(t + 0.06);
  }
  function timpani(n, t, g = 0.3) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(mtof(n) * 1.05, t); o.frequency.exponentialRampToValueAtTime(mtof(n), t + 0.12);
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(e); e.connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.6; e.connect(v).connect(reverb);
    o.start(t); o.stop(t + 1.15);
    const s = noise(), f = ctx.createBiquadFilter(), ne = ctx.createGain(); f.type = 'lowpass'; f.frequency.value = 500;
    ne.gain.setValueAtTime(g * 0.6, t); ne.gain.exponentialRampToValueAtTime(0.001, t + 0.15); s.connect(f).connect(ne).connect(musicBus); s.start(t); s.stop(t + 0.18);
  }
  // "Aah" choir: detuned saws through two vowel formants, slow swell, lots of reverb
  function choir(notes, t, dur, g = 0.03) {
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(g, t + 0.35); out.gain.setValueAtTime(g, t + dur - 0.15); out.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    for (const fq of [750, 1150]) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = 5; out.connect(f); f.connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.9; f.connect(v).connect(reverb); }
    for (const n of notes) for (const det of [-14, 0, 14]) {
      const o = ctx.createOscillator(), vib = ctx.createOscillator(), va = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      vib.frequency.value = 5 + Math.random(); va.gain.value = 4; vib.connect(va).connect(o.detune);
      o.connect(out); o.start(t); o.stop(t + dur + 0.7); vib.start(t); vib.stop(t + dur + 0.7);
    }
  }
  function stab(notes, t, g = 0.045) {
    for (const n of notes) for (const det of [-8, 8]) {
      const o = ctx.createOscillator(), e = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.01); e.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(f).connect(e); e.connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.3; e.connect(v).connect(reverb);
      o.start(t); o.stop(t + 0.35);
    }
  }
  function bell(n, t, g = 0.05) {
    for (const [mul, gg] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.frequency.value = mtof(n) * mul;
      e.gain.setValueAtTime(g * gg, t); e.gain.exponentialRampToValueAtTime(0.0005, t + 1.2);
      o.connect(e); e.connect(musicBus); e.connect(delay); o.start(t); o.stop(t + 1.25);
    }
  }
  function playBoss(i, t) {
    const bar = Math.floor(i / 8), s = i % 8, c = BOSS_PROG[bar % 4], E = bossEighth();
    // driving bass ostinato
    bossBass(c.root + [0, 0, 12, 0, 0, 12, 0, 7][s], t, E * 0.95);
    // drums
    const kicks = intensity >= 2 ? [0, 2, 3, 4, 6, 7] : intensity >= 1 ? [0, 3, 4, 7] : [0, 4];
    if (kicks.includes(s)) bigKick(t, s === 0 ? 0.5 : 0.38);
    if (intensity >= 1 && (s === 2 || s === 6)) snare(t);
    if (intensity >= 2 && s === 7) snare(t + E / 2, 0.08);
    if (intensity >= 1) { hat(t); if (intensity >= 2) hat(t + E / 2, 0.02); }
    // timpani on the downbeat every other bar, a roll into each 4-bar phrase
    if (s === 0 && bar % 2 === 0) timpani(c.root + 12, t, 0.32);
    if (intensity >= 1 && bar % 4 === 3 && s >= 6) for (let k = 0; k < 3; k++) timpani(c.root + 12, t + k * E / 3, 0.12 + k * 0.05);
    // choir swells on every chord, an octave higher when enraged
    if (intensity >= 1 && s === 0) choir(c.chord.map(n => n + (intensity >= 2 ? 24 : 12)), t, E * 8, intensity >= 2 ? 0.035 : 0.028);
    // brass stabs and the bell ostinato
    if (intensity >= 1 && (s === 0 || s === 5 || (intensity >= 2 && s === 3))) stab(c.chord.map(n => n + 12), t);
    if (intensity >= 1 && s % 2 === 0) bell(c.chord[[0, 2, 1, 2][s / 2]] + 24, t, intensity >= 2 ? 0.05 : 0.035);
  }

  // ---------- Shared synth parts for the other two boss themes ----------
  let pumpBus = null, distCurve = null;
  // Everything melodic in the Influencer theme goes through this gain, which ducks on every kick (sidechain pump)
  function pump() { if (!pumpBus) { pumpBus = ctx.createGain(); pumpBus.connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.35; pumpBus.connect(v).connect(reverb); } return pumpBus; }
  function duckPump(t, len) { const g = pump().gain; g.cancelScheduledValues(t); g.setValueAtTime(0.18, t); g.linearRampToValueAtTime(1, t + len); }
  function dist() {
    if (!distCurve) { distCurve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; distCurve[i] = Math.tanh(x * 6); } }
    const w = ctx.createWaveShaper(); w.curve = distCurve; w.oversample = '2x'; return w;
  }
  // One synth voice: stacked detuned oscillators, a filter envelope and a gain envelope
  function voice(n, t, dur, { type = 'sawtooth', dets = [0], g = 0.05, cut = 3000, cutTo = 0, q = 0.7, attack = 0.005, release = 0.1, dest = musicBus, verb = 0, glideFrom = 0, vib = 0, shaper = false, bp = 0 } = {}) {
    const e = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = bp ? 'bandpass' : 'lowpass'; f.Q.value = q; f.frequency.setValueAtTime(bp || cut, t); if (cutTo) f.frequency.exponentialRampToValueAtTime(cutTo, t + dur);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + attack); e.gain.setValueAtTime(g, t + Math.max(attack, dur - release)); e.gain.linearRampToValueAtTime(0, t + dur);
    let head = f; if (shaper) { const w = dist(); w.connect(f); head = w; }
    f.connect(e).connect(dest); if (verb) { const v = ctx.createGain(); v.gain.value = verb; e.connect(v).connect(reverb); }
    for (const d of dets) {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = d;
      if (glideFrom) { o.frequency.setValueAtTime(mtof(glideFrom), t); o.frequency.exponentialRampToValueAtTime(mtof(n), t + 0.06); } else o.frequency.value = mtof(n);
      if (vib) { const l = ctx.createOscillator(), la = ctx.createGain(); l.frequency.value = 5.5; la.gain.value = vib; la.gain.setValueAtTime(0, t); la.gain.linearRampToValueAtTime(vib, t + dur * 0.6); l.connect(la).connect(o.detune); l.start(t); l.stop(t + dur + 0.05); }
      o.connect(head); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function noiseHit(t, { g = 0.1, type = 'highpass', freq = 6000, q = 0.7, len = 0.05, dest = musicBus, verb = 0 } = {}) {
    const s = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0005, t + len);
    s.connect(f).connect(e).connect(dest); if (verb) { const v = ctx.createGain(); v.gain.value = verb; e.connect(v).connect(reverb); }
    s.start(t, rand(0, 0.5)); s.stop(t + len + 0.02);
  }

  // ---------- 📸 The Influencer: dark synthwave in F minor ----------
  // Fm - Db - Bbm - C, four-on-the-floor with a sidechain pump, supersaw chords, 16th arps, claps,
  // camera-shutter percussion and a wailing siren lead when it gets enraged.
  const INFL = [
    { root: 29, chord: [53, 56, 60, 65], lead: [77, 75, 72, 75, 77, 80, 79, 77] }, // Fm
    { root: 25, chord: [49, 53, 56, 61], lead: [77, 73, 72, 73, 80, 77, 73, 72] }, // Db
    { root: 34, chord: [53, 58, 61, 65], lead: [73, 72, 70, 72, 73, 77, 82, 80] }, // Bbm
    { root: 24, chord: [52, 55, 60, 64], lead: [79, 76, 72, 76, 79, 84, 83, 79] }, // C (major, so it lifts back to Fm)
  ];
  function shutter(t, g) { noiseHit(t, { g, type: 'bandpass', freq: 3800, q: 2, len: 0.025 }); noiseHit(t + 0.045, { g: g * 0.8, type: 'bandpass', freq: 2600, q: 2, len: 0.04 }); }
  function playInfluencer(i, t) {
    const S = bossStep(), bar = Math.floor(i / 16), s = i % 16, c = INFL[bar % 4], hard = intensity >= 2;
    if (s % 4 === 0 && (intensity >= 1 || s % 8 === 0)) { bigKick(t, s === 0 ? 0.5 : 0.42); duckPump(t, S * 3.2); }
    if (intensity >= 1 && (s === 4 || s === 12)) { noiseHit(t, { g: 0.2, type: 'bandpass', freq: 1500, q: 0.9, len: 0.16, verb: 0.5 }); noiseHit(t + 0.012, { g: 0.12, type: 'bandpass', freq: 1100, len: 0.12 }); }
    if (hard && s === 14 && bar % 2) for (let k = 0; k < 4; k++) noiseHit(t + k * S / 2, { g: 0.06 + k * 0.03, type: 'bandpass', freq: 1500, len: 0.1 });
    if (s % 4 === 2) noiseHit(t, { g: 0.06, freq: 7000, len: 0.18 }); // open hat on the off-beat
    if (hard || (intensity >= 1 && s % 2 === 0)) noiseHit(t, { g: 0.025, freq: 9000, len: 0.03 });
    if (intensity >= 1 && (s === 7 || s === 15)) shutter(t, 0.12);
    // rolling bass: every 16th except the kicks, so it bounces against them
    if (s % 4 !== 0) voice(c.root + 12 + (s % 4 === 3 ? 12 : 0), t, S * 0.9, { dets: [-6, 6], g: 0.09, cut: 1400, cutTo: 300, dest: pump() });
    voice(c.root, t, S * 0.95, { type: 'sine', g: s % 4 === 0 ? 0 : 0.12, dest: pump() });
    // supersaw chord, held for the bar
    if (s === 0) for (const n of c.chord) voice(n + 12, t, S * 16, { dets: [-24, -11, 0, 11, 24], g: intensity ? 0.016 : 0.011, cut: hard ? 4200 : 2600, attack: 0.02, release: 0.2, dest: pump() });
    // 16th arpeggio up through the chord
    if (intensity >= 1) { const arp = [0, 1, 2, 3, 2, 1, 2, 3][s % 8], oct = s >= 8 ? 24 : 12; voice(c.chord[arp] + oct, t, S * 0.8, { type: 'square', g: 0.032, cut: 5200, cutTo: 900, dest: pump() }); }
    // siren lead: two notes per beat with glide, an octave up when enraged
    if (intensity >= 1 && s % 2 === 0 && (hard || bar % 4 >= 2)) {
      const n = c.lead[s / 2] + (hard ? 12 : 0), prev = c.lead[(s / 2 + 7) % 8] + (hard ? 12 : 0);
      voice(n, t, S * 1.9, { dets: [-8, 8], g: hard ? 0.035 : 0.028, cut: 3800, q: 2, glideFrom: prev, vib: 18, verb: 0.3, dest: musicBus });
    }
    if (s === 0 && bar % 4 === 0 && intensity >= 1) noiseHit(t, { g: 0.12, type: 'highpass', freq: 3000, len: 1.6, verb: 0.8 }); // crash
  }

  // ---------- 💬 The Comment Section: a war drum battle in E phrygian dominant ----------
  // E - F - Dm - E: taiko, chugging distorted bass, war horns, a snake-charmer lead and a gong every 4 bars.
  const DRAG = [
    { root: 40, horn: [52, 56, 59], lead: [76, 77, 80, 77, 76, 74, 76, 77, 80, 81, 80, 77, 76, 77, 76, 72] }, // E
    { root: 41, horn: [53, 57, 60], lead: [77, 76, 77, 80, 81, 80, 77, 76, 77, 80, 84, 83, 81, 80, 77, 76] }, // F
    { root: 38, horn: [50, 53, 57], lead: [74, 76, 77, 74, 72, 74, 76, 77, 81, 80, 77, 76, 74, 72, 71, 72] }, // Dm
    { root: 40, horn: [52, 56, 59], lead: [76, 80, 81, 80, 76, 77, 76, 74, 76, 77, 80, 77, 76, 77, 76, 76] }, // E
  ];
  function taiko(t, g = 0.45, low = 1) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.frequency.setValueAtTime(110 * low, t); o.frequency.exponentialRampToValueAtTime(48 * low, t + 0.25);
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(e).connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.5; e.connect(v).connect(reverb); o.start(t); o.stop(t + 0.75);
    noiseHit(t, { g: g * 0.5, type: 'lowpass', freq: 900, len: 0.12, verb: 0.4 });
  }
  function gong(t, g = 0.08) {
    for (const [m, gg] of [[1, 1], [1.48, 0.6], [2.13, 0.5], [2.9, 0.35], [4.1, 0.2]]) {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.frequency.setValueAtTime(70 * m * 1.02, t); o.frequency.exponentialRampToValueAtTime(70 * m, t + 0.6);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g * gg, t + 0.05); e.gain.exponentialRampToValueAtTime(0.0005, t + 4.5);
      o.connect(e).connect(musicBus); const v = ctx.createGain(); v.gain.value = 0.8; e.connect(v).connect(reverb); o.start(t); o.stop(t + 4.6);
    }
    noiseHit(t, { g: 0.1, type: 'bandpass', freq: 2500, q: 0.5, len: 2.5, verb: 1 });
  }
  function playComments(i, t) {
    const S = bossStep(), bar = Math.floor(i / 16), s = i % 16, c = DRAG[bar % 4], hard = intensity >= 2;
    // taiko pattern: BOOM . . BOOM . . BOOM . BOOM . BOOM BOOM (more hits when enraged)
    const hits = hard ? [0, 3, 6, 8, 10, 11, 12, 14, 15] : intensity >= 1 ? [0, 3, 6, 8, 10, 11] : [0, 8];
    if (hits.includes(s)) taiko(t, s === 0 ? 0.55 : 0.36, s % 8 === 0 ? 0.8 : 1);
    if (intensity >= 1 && (s === 4 || s === 12)) { noiseHit(t, { g: 0.22, type: 'bandpass', freq: 1800, q: 0.8, len: 0.18, verb: 0.5 }); taiko(t, 0.18, 1.8); }
    if (intensity >= 1 && s % 2 === 1) noiseHit(t, { g: hard ? 0.05 : 0.03, type: 'bandpass', freq: 5200, q: 3, len: 0.03 }); // rim clicks
    if (bar % 4 === 3 && s >= 12 && intensity >= 1) taiko(t + S / 2, 0.2 + (s - 12) * 0.05, 1.3);
    // chugging distorted bass
    const chug = intensity >= 1 ? [0, 2, 3, 4, 6, 8, 10, 11, 12, 14] : [0, 4, 8, 12];
    if (chug.includes(s)) { voice(c.root - 12, t, S * 0.85, { dets: [-7, 7], g: 0.05, cut: 900, cutTo: 250, shaper: true }); voice(c.root - 12, t, S * 0.9, { type: 'sine', g: 0.14 }); }
    // war horns on bars 1 and 3, a long swell
    if (s === 0 && (bar % 2 === 0 || hard)) for (const n of (intensity ? c.horn : [c.horn[0]])) voice(n, t, S * 14, { dets: [-10, 0, 10], g: 0.022, cut: 400, cutTo: 2000, q: 1.5, attack: S * 4, release: S * 3, verb: 0.6 });
    // snake-charmer lead with vibrato, doubled an octave up when enraged
    if (intensity >= 1 && (s % 2 === 0 || hard)) {
      const n = c.lead[s];
      if (n !== c.lead[s - 1] || s === 0) {
        voice(n, t, S * (hard ? 1 : 1.9), { type: 'square', dets: [0, 6], g: 0.022, bp: 1600, q: 1.2, vib: 25, verb: 0.25 });
        if (hard) voice(n + 12, t, S, { type: 'sawtooth', g: 0.012, cut: 4000, vib: 25, verb: 0.3 });
      }
    }
    if (s === 0 && bar % 4 === 0) gong(t, intensity >= 1 ? 0.09 : 0.06);
  }

  function playBossTheme(i, t) {
    if (theme === 'influencer') playInfluencer(i, t);
    else if (theme === 'comments') playComments(i, t);
    else playBoss(i, t);
  }
  // Each theme's step length: the Algorithm counts eighths, the others sixteenths
  function bossStep() {
    if (theme === 'influencer') return 60 / (intensity >= 2 ? 166 : 150) / 4;
    if (theme === 'comments') return 60 / (intensity >= 2 ? 162 : 146) / 4;
    return bossEighth();
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + 0.3) {
      if (mode === 'boss') { playBossTheme(step, nextTime); nextTime += bossStep(); }
      else { playStep(step, nextTime); nextTime += EIGHTH; }
      step++;
    }
  }
  // Switch between the lo-fi loop and the boss theme (level: null = lo-fi, 0/1/2 = boss intensity)
  function setBossMusic(level, kind) {
    const want = level == null ? 'lofi' : 'boss', th = kind || theme;
    if (want === mode && (want === 'lofi' || (level === intensity && th === theme))) return;
    const switching = want !== mode || (want === 'boss' && th !== theme);
    mode = want; if (want === 'boss') { intensity = level; theme = th; }
    if (!ctx) return;
    if (switching) {
      step = 0; nextTime = Math.max(nextTime, ctx.currentTime + 0.05);
      if (crackleGain) crackleGain.gain.setTargetAtTime(mode === 'boss' ? 0 : 0.16, ctx.currentTime, 0.3);
      if (timer) { musicBus.gain.cancelScheduledValues(ctx.currentTime); musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime); musicBus.gain.linearRampToValueAtTime(mode === 'boss' ? 0.4 : 0.32, ctx.currentTime + 1.5); }
    }
  }
  function startMusic() {
    if (!ctx || timer) return;
    if (!crackle) startCrackle();
    nextTime = ctx.currentTime + 0.1; step = 0;
    timer = setInterval(scheduler, 50);
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(mode === 'boss' ? 0.4 : 0.32, ctx.currentTime + (mode === 'boss' ? 1 : 4));
  }
  function stopMusic() {
    if (!ctx || !timer) return;
    clearInterval(timer); timer = 0;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  }

  // ---------- Sound effects ----------
  function tone(freq, t, { type = 'sine', dur = 0.2, gain = 0.3, to = 0, attack = 0.005, filter = 0, verb = 0.15 } = {}) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(gain, t + attack); e.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; node = node.connect(f); }
    node.connect(e).connect(sfxBus);
    if (verb) { const v = ctx.createGain(); v.gain.value = verb; e.connect(v).connect(reverb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(t, from, to, dur, gain) {
    const s = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(gain, t + dur * 0.3); e.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(e).connect(sfxBus); s.start(t, rand(0, 0.4)); s.stop(t + dur + 0.05);
  }
  const SFX = {
    join: t => { tone(mtof(72), t, { type: 'triangle', dur: 0.25, gain: 0.25 }); tone(mtof(79), t + 0.09, { type: 'triangle', dur: 0.4, gain: 0.25 }); },
    head: t => { [72, 76, 79, 84].forEach((n, i) => tone(mtof(n), t + i * 0.08, { type: 'triangle', dur: 0.6, gain: 0.22, verb: 0.35 })); tone(mtof(96), t + 0.34, { dur: 0.8, gain: 0.08, verb: 0.5 }); },
    boost: t => { whoosh(t, 400, 4000, 0.45, 0.35); tone(300, t, { type: 'sine', dur: 0.35, gain: 0.18, to: 900 }); },
    ready: t => tone(mtof(69), t, { type: 'sine', dur: 0.15, gain: 0.18 }),
    go: t => { tone(mtof(81), t, { type: 'square', dur: 0.22, gain: 0.12, filter: 3000 }); tone(mtof(88), t, { type: 'sine', dur: 0.3, gain: 0.15 }); },
    tap: t => tone(1400, t, { type: 'triangle', dur: 0.06, gain: 0.2, verb: 0 }),
    win: t => [79, 83, 86, 91].forEach((n, i) => tone(mtof(n), t + i * 0.06, { dur: 0.5, gain: 0.16, verb: 0.4 })),
    miss: t => { tone(mtof(64), t, { type: 'triangle', dur: 0.18, gain: 0.2 }); tone(mtof(60), t + 0.12, { type: 'triangle', dur: 0.3, gain: 0.2 }); },
    gain: t => [67, 71, 74, 79].forEach((n, i) => tone(mtof(n), t + i * 0.05, { type: 'triangle', dur: 0.2, gain: 0.18 })),
    lost: t => [74, 70, 67].forEach((n, i) => tone(mtof(n), t + i * 0.08, { type: 'triangle', dur: 0.25, gain: 0.18 })),
    crash: t => { whoosh(t, 2500, 200, 0.35, 0.4); tone(110, t, { dur: 0.3, gain: 0.35, to: 45, verb: 0 }); },
    troll: t => { tone(320, t, { type: 'sawtooth', dur: 0.45, gain: 0.22, to: 120, filter: 1100 }); tone(160, t + 0.05, { type: 'square', dur: 0.35, gain: 0.06, to: 70, filter: 700 }); },
    // Game over: a low thud, then a "wah wah wah wahhh" with a wobble on the last note
    out: t => {
      tone(140, t, { dur: 0.35, gain: 0.4, to: 40, verb: 0 });
      [67, 66, 65].forEach((n, i) => tone(mtof(n - 12), t + 0.15 + i * 0.3, { type: 'sawtooth', dur: 0.3, gain: 0.26, filter: 1100, verb: 0.25 }));
      const o = ctx.createOscillator(), e = ctx.createGain(), f = ctx.createBiquadFilter(), vib = ctx.createOscillator(), va = ctx.createGain(), t0 = t + 1.05;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(mtof(52), t0); o.frequency.linearRampToValueAtTime(mtof(47), t0 + 1.2);
      vib.frequency.value = 6; va.gain.value = 6; vib.connect(va).connect(o.frequency);
      f.type = 'lowpass'; f.frequency.value = 1000;
      e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(0.28, t0 + 0.04); e.gain.setValueAtTime(0.28, t0 + 0.9); e.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
      o.connect(f).connect(e).connect(sfxBus); o.start(t0); o.stop(t0 + 1.45); vib.start(t0); vib.stop(t0 + 1.45);
    },
    lose: t => { tone(mtof(71), t, { type: 'triangle', dur: 0.22, gain: 0.2 }); tone(mtof(67), t + 0.16, { type: 'triangle', dur: 0.22, gain: 0.2 }); tone(mtof(62), t + 0.32, { type: 'triangle', dur: 0.5, gain: 0.2, verb: 0.3 }); },
    opened: t => { tone(1320, t, { dur: 0.5, gain: 0.13, verb: 0.35 }); tone(1980, t + 0.07, { dur: 0.6, gain: 0.09, verb: 0.35 }); },
    turn: t => { tone(mtof(76), t, { dur: 0.35, gain: 0.1, verb: 0.3 }); tone(mtof(83), t + 0.1, { dur: 0.45, gain: 0.08, verb: 0.3 }); },
    // ---------- The Algorithm (each takes (time, options)) ----------
    bossSiren: t => { for (let i = 0; i < 3; i++) { tone(620, t + i * 0.7, { type: 'sawtooth', dur: 0.35, gain: 0.2, to: 940, filter: 2200, verb: 0.2 }); tone(940, t + i * 0.7 + 0.35, { type: 'sawtooth', dur: 0.35, gain: 0.2, to: 620, filter: 2200, verb: 0.2 }); } },
    bossRiser: (t, o) => { const d = Math.max(1, o.dur || 6); whoosh(t, 150, 5000, d, 0.32); tone(80, t, { type: 'sawtooth', dur: d, gain: 0.07, to: 640, filter: 1400, attack: d * 0.8, verb: 0.3 }); },
    bossFall: t => { tone(3200, t, { type: 'sine', dur: 1.4, gain: 0.09, to: 260, verb: 0.3 }); whoosh(t + 0.8, 400, 3000, 0.6, 0.3); },
    bossSlam: t => { tone(110, t, { dur: 1.4, gain: 0.6, to: 24, verb: 0.4 }); tone(55, t, { dur: 1.6, gain: 0.4, to: 22 }); whoosh(t, 4000, 90, 1.2, 0.55); const c = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 3000; e.gain.setValueAtTime(0.18, t); e.gain.exponentialRampToValueAtTime(0.001, t + 2); c.connect(f).connect(e).connect(sfxBus); e.connect(reverb); c.start(t); c.stop(t + 2); },
    bossRoar: t => { for (const [f0, det] of [[62, 0], [64, 8], [93, -5]]) { const oo = ctx.createOscillator(), e = ctx.createGain(), fl = ctx.createBiquadFilter(), vib = ctx.createOscillator(), va = ctx.createGain(); oo.type = 'sawtooth'; oo.frequency.value = f0; oo.detune.value = det; vib.frequency.value = 7; va.gain.value = 9; vib.connect(va).connect(oo.frequency); fl.type = 'lowpass'; fl.frequency.setValueAtTime(250, t); fl.frequency.linearRampToValueAtTime(1600, t + 0.6); fl.frequency.linearRampToValueAtTime(300, t + 1.7); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.16, t + 0.25); e.gain.exponentialRampToValueAtTime(0.001, t + 1.8); oo.connect(fl).connect(e).connect(sfxBus); e.connect(reverb); oo.start(t); oo.stop(t + 1.85); vib.start(t); vib.stop(t + 1.85); } whoosh(t, 300, 900, 1.4, 0.25); },
    bossCharge: (t, o) => { const d = Math.max(0.3, o.dur || 1.2); tone(140, t, { type: 'sawtooth', dur: d, gain: 0.15, to: 1400, filter: 2600, attack: d * 0.9 }); whoosh(t, 300, 6000, d, 0.12); },
    bossBlast: t => { tone(1100, t, { type: 'square', dur: 0.45, gain: 0.12, to: 110, filter: 3000 }); tone(70, t, { dur: 0.6, gain: 0.4, to: 30 }); whoosh(t, 5000, 600, 0.35, 0.4); },
    bossHum: (t, o) => { const d = Math.max(0.3, o.dur || 2); for (const f0 of [110, 113.5, 221]) { const oo = ctx.createOscillator(), e = ctx.createGain(), fl = ctx.createBiquadFilter(), trem = ctx.createOscillator(), ta = ctx.createGain(); oo.type = 'sawtooth'; oo.frequency.value = f0; fl.type = 'lowpass'; fl.frequency.value = 1500; trem.frequency.value = 18; ta.gain.value = 0.03; trem.connect(ta).connect(e.gain); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.06, t + 0.05); e.gain.setValueAtTime(0.06, t + d - 0.1); e.gain.linearRampToValueAtTime(0, t + d); oo.connect(fl).connect(e).connect(sfxBus); oo.start(t); oo.stop(t + d + 0.05); trem.start(t); trem.stop(t + d + 0.05); } },
    bossPowerDown: t => tone(700, t, { type: 'sawtooth', dur: 0.5, gain: 0.13, to: 50, filter: 1800 }),
    bossRumble: (t, o) => { const d = Math.max(0.3, o.dur || 1.2); const c = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain(); f.type = 'lowpass'; f.frequency.value = 180; e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.5, t + d); c.connect(f).connect(e).connect(sfxBus); c.start(t); c.stop(t + d + 0.05); tone(42, t, { dur: d, gain: 0.25, attack: d * 0.9 }); },
    bossStomp: t => { tone(130, t, { dur: 1.1, gain: 0.65, to: 26, verb: 0.35 }); whoosh(t, 1400, 120, 0.7, 0.5); },
    bossCrackle: t => { for (let k = 0; k < 3; k++) whoosh(t + k * 0.04, 4000, 1500, 0.08, 0.3); tone(90, t, { dur: 0.25, gain: 0.22, to: 40 }); },
    bossWave: t => whoosh(t, 250, 3000, 0.9, 0.6),
    bossWhistle: (t, o) => tone(rand(2200, 2800), t, { type: 'sine', dur: Math.max(0.3, o.dur || 1.4), gain: 0.09, to: 380 }),
    bossImpact: (t, o) => { const g = o.g ?? 1; tone(150, t, { dur: 0.55, gain: 0.4 * g, to: 36, verb: 0.2 }); whoosh(t, 2600, 200, 0.3, 0.35 * g); },
    bossWarp: (t, o) => { const d = Math.max(1, o.dur || 3.5); tone(48, t, { type: 'sawtooth', dur: d, gain: 0.14, to: 36, filter: 500, attack: 0.5, verb: 0.4 }); whoosh(t, 3000, 120, d, 0.3); tone(400, t, { dur: d, gain: 0.05, to: 90, attack: d * 0.7 }); },
    bossHurt: t => { tone(240, t, { type: 'square', dur: 0.35, gain: 0.12, to: 60, filter: 1500 }); tone(80, t, { dur: 0.4, gain: 0.35, to: 30 }); whoosh(t, 3000, 400, 0.25, 0.3); },
    bossGrass: t => [76, 81, 86].forEach((n, i) => tone(mtof(n), t + i * 0.06, { type: 'triangle', dur: 0.3, gain: 0.16, verb: 0.3 })),
    bossDown: t => { [72, 76, 79, 84, 88].forEach((n, i) => tone(mtof(n), t + i * 0.1, { type: 'triangle', dur: 0.6, gain: 0.2, verb: 0.4 })); tone(80, t, { dur: 0.8, gain: 0.4, to: 30 }); whoosh(t, 300, 5000, 1.2, 0.35); },
    bossLeave: t => { whoosh(t, 200, 3000, 1.2, 0.3); tone(300, t, { dur: 1.2, gain: 0.08, to: 900 }); },
    // ---------- The Influencer ----------
    inflWarn: t => { for (let i = 0; i < 4; i++) { tone(1320, t + i * 0.5, { type: 'square', dur: 0.12, gain: 0.1, filter: 4000 }); tone(1760, t + i * 0.5 + 0.14, { type: 'square', dur: 0.16, gain: 0.1, filter: 4000 }); } SFX.inflGlitch(t + 2); },
    inflBeep: (t, o) => { const n = o.n || 0; tone(n === 2 ? 1760 : 880, t, { type: 'sine', dur: n === 2 ? 0.35 : 0.15, gain: 0.22, verb: 0.2 }); },
    inflFlash: t => { whoosh(t, 9000, 2000, 0.25, 0.5); tone(3200, t, { dur: 1.2, gain: 0.1, to: 2800, verb: 0.5 }); tone(90, t, { dur: 0.4, gain: 0.3, to: 40 }); for (const d of [0, 0.05]) { const c = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 2; e.gain.setValueAtTime(0.35, t + d); e.gain.exponentialRampToValueAtTime(0.001, t + d + 0.04); c.connect(f).connect(e).connect(sfxBus); c.start(t + d); c.stop(t + d + 0.05); } },
    inflKiss: (t, o) => { const d = Math.max(0.4, o.dur || 1.2); tone(900, t, { type: 'sine', dur: 0.12, gain: 0.15, to: 1800 }); tone(1800, t + 0.08, { dur: 0.1, gain: 0.08, to: 600 }); [72, 76, 79, 84].forEach((n, i) => tone(mtof(n + 12), t + 0.2 + i * d / 6, { type: 'triangle', dur: 0.3, gain: 0.06, verb: 0.4 })); whoosh(t, 1500, 400, d, 0.12); },
    inflHeartBoom: (t, o) => { const g = o.g ?? 1; tone(180, t, { dur: 0.45, gain: 0.35 * g, to: 50, verb: 0.2 }); tone(mtof(88), t, { type: 'triangle', dur: 0.4, gain: 0.08 * g, to: mtof(76), verb: 0.4 }); whoosh(t, 4000, 600, 0.25, 0.3 * g); },
    inflRingCharge: (t, o) => { const d = Math.max(0.3, o.dur || 1.2); tone(220, t, { type: 'sawtooth', dur: d, gain: 0.1, to: 1760, filter: 5000, attack: d * 0.9 }); tone(15000, t, { dur: d, gain: 0.02, attack: d * 0.8 }); whoosh(t, 1000, 9000, d, 0.12); },
    inflRingZap: t => { tone(2400, t, { type: 'square', dur: 0.35, gain: 0.1, to: 200, filter: 6000 }); tone(60, t, { dur: 0.5, gain: 0.35, to: 30 }); whoosh(t, 8000, 500, 0.6, 0.4); },
    inflPing: (t, o) => tone(1200 + (o.n || 0) * 140, t, { type: 'sine', dur: 0.1, gain: 0.12, verb: 0.15 }),
    inflStamp: t => { tone(120, t, { dur: 0.6, gain: 0.5, to: 30, verb: 0.3 }); whoosh(t, 3000, 200, 0.4, 0.45); tone(mtof(84), t + 0.05, { type: 'triangle', dur: 0.4, gain: 0.08, verb: 0.4 }); },
    inflUnfollow: t => { tone(mtof(79), t, { type: 'triangle', dur: 0.12, gain: 0.16 }); tone(mtof(72), t + 0.09, { type: 'triangle', dur: 0.25, gain: 0.16, verb: 0.3 }); tone(400, t, { type: 'square', dur: 0.08, gain: 0.05, to: 200, filter: 2000 }); },
    inflGlitch: t => { for (let i = 0; i < 8; i++) tone(rand(200, 3000), t + i * 0.045, { type: 'square', dur: 0.04, gain: 0.08, filter: 5000, verb: 0 }); whoosh(t, 6000, 300, 0.4, 0.2); },
    inflDown: t => { SFX.inflGlitch(t); tone(1200, t + 0.35, { type: 'sine', dur: 1.4, gain: 0.15, to: 60 }); tone(60, t + 1.6, { type: 'square', dur: 0.08, gain: 0.12, filter: 1500 }); },
    // ---------- The Comment Section ----------
    dragonWarn: t => { for (let i = 0; i < 3; i++) { tone(98, t + i * 0.9, { type: 'sawtooth', dur: 0.8, gain: 0.16, to: 92, filter: 900, attack: 0.15, verb: 0.5 }); tone(147, t + i * 0.9, { type: 'sawtooth', dur: 0.8, gain: 0.1, filter: 900, attack: 0.15, verb: 0.5 }); } SFX.dragonChatter(t + 0.2); },
    dragonInhale: (t, o) => { const d = Math.max(0.3, o.dur || 1); whoosh(t, 4000, 300, d, 0.35); tone(60, t, { type: 'sawtooth', dur: d, gain: 0.08, to: 110, filter: 600, attack: d * 0.9 }); },
    dragonFire: (t, o) => { const d = Math.max(0.3, o.dur || 1.2); const c = noise(), f = ctx.createBiquadFilter(), e = ctx.createGain(); c.loop = true; f.type = 'lowpass'; f.frequency.setValueAtTime(3500, t); f.frequency.linearRampToValueAtTime(1200, t + d); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.5, t + 0.05); e.gain.setValueAtTime(0.5, t + d - 0.2); e.gain.linearRampToValueAtTime(0, t + d); c.connect(f).connect(e).connect(sfxBus); e.connect(reverb); c.start(t); c.stop(t + d + 0.05); SFX.dragonRoar(t); },
    dragonWhipWind: (t, o) => whoosh(t, 200, 1600, Math.max(0.3, o.dur || 0.8), 0.25),
    dragonWhip: t => { whoosh(t - 0.15, 600, 7000, 0.2, 0.5); const c = noise(), e = ctx.createGain(); e.gain.setValueAtTime(0.6, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.06); c.connect(e).connect(sfxBus); e.connect(reverb); c.start(t); c.stop(t + 0.07); tone(100, t, { dur: 0.3, gain: 0.3, to: 40 }); },
    dragonChatter: t => { for (let i = 0; i < 14; i++) { const f0 = rand(260, 700); tone(f0, t + i * 0.06 + rand(0, 0.03), { type: 'square', dur: 0.05, gain: 0.04, to: f0 * rand(0.7, 1.4), filter: 2000, verb: 0.1 }); } },
    dragonThread: (t, o) => { const d = Math.max(0.3, o.dur || 2); for (let i = 0; i < d / 0.09; i++) tone(rand(900, 1500), t + i * 0.09, { type: 'triangle', dur: 0.05, gain: 0.05, verb: 0 }); whoosh(t, 300, 2000, d, 0.15); },
    dragonSnap: t => { tone(1800, t, { type: 'square', dur: 0.08, gain: 0.1, to: 300, filter: 4000 }); whoosh(t, 5000, 800, 0.2, 0.3); },
    dragonBlock: t => { tone(mtof(64), t, { type: 'square', dur: 0.1, gain: 0.1, filter: 2500 }); tone(mtof(76), t + 0.07, { type: 'triangle', dur: 0.25, gain: 0.15, verb: 0.3 }); tone(80, t, { dur: 0.35, gain: 0.35, to: 35 }); whoosh(t, 4000, 300, 0.25, 0.3); },
    dragonRoar: t => { for (const [f0, det] of [[55, 0], [58, 10], [82, -6], [110, 4]]) { const oo = ctx.createOscillator(), e = ctx.createGain(), fl = ctx.createBiquadFilter(), w = dist(), vib = ctx.createOscillator(), va = ctx.createGain(); oo.type = 'sawtooth'; oo.frequency.setValueAtTime(f0 * 1.3, t); oo.frequency.exponentialRampToValueAtTime(f0, t + 1.5); oo.detune.value = det; vib.frequency.value = 11; va.gain.value = 14; vib.connect(va).connect(oo.frequency); fl.type = 'lowpass'; fl.frequency.setValueAtTime(400, t); fl.frequency.linearRampToValueAtTime(2200, t + 0.4); fl.frequency.linearRampToValueAtTime(350, t + 1.6); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.09, t + 0.15); e.gain.exponentialRampToValueAtTime(0.001, t + 1.7); oo.connect(w).connect(fl).connect(e).connect(sfxBus); e.connect(reverb); oo.start(t); oo.stop(t + 1.75); vib.start(t); vib.stop(t + 1.75); } whoosh(t, 500, 1500, 1.3, 0.3); },
    dragonDown: t => { SFX.dragonRoar(t); tone(300, t + 0.5, { type: 'sawtooth', dur: 1.5, gain: 0.1, to: 40, filter: 1200 }); for (let i = 0; i < 10; i++) tone(rand(400, 900), t + 0.6 + i * 0.12, { type: 'square', dur: 0.06, gain: 0.03, filter: 2000 }); },
    chat: t => { tone(780, t, { type: 'sine', dur: 0.09, gain: 0.12, to: 1150, verb: 0.1 }); },
    click: t => tone(900, t, { type: 'triangle', dur: 0.04, gain: 0.12, verb: 0 }),
  };
  const lastPlayed = {};

  return {
    // Call from a click/tap: creates or resumes the audio engine and starts music if it's on
    unlock() {
      if (!AC) return;
      if (!ctx) build();
      if (ctx.state !== 'running') ctx.resume();
      if (prefs.music) startMusic();
    },
    play(name) {
      if (!ctx || !prefs.sfx || ctx.state !== 'running' || !SFX[name]) return;
      // Don't stack the same sound when several events land in one frame
      const t = ctx.currentTime;
      if (lastPlayed[name] && t - lastPlayed[name] < 0.07) return;
      lastPlayed[name] = t;
      SFX[name](t + 0.01);
    },
    // Play a sound effect `delay` seconds from now (used to land boss sounds on the exact hit moment)
    at(name, delay, opts) {
      if (!ctx || !prefs.sfx || ctx.state !== 'running' || !SFX[name]) return;
      if (delay < -0.25) return; // already over
      SFX[name](ctx.currentTime + Math.max(0.01, delay), opts || {});
    },
    // Boss theme: null = back to lo-fi, 0 = warning, 1 = fight, 2 = enraged; kind picks the boss's own theme
    bossMusic(level, kind) { setBossMusic(level, kind); },
    // Briefly lower the music so a big moment (like game over) stands out
    duck(sec) {
      if (!ctx || !timer) return;
      const g = musicBus.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.06, t + 0.15); g.setValueAtTime(0.06, t + sec); g.linearRampToValueAtTime(mode === 'boss' ? 0.4 : 0.32, t + sec + 2);
    },
    // Tap race: a bright little pop that climbs a pentatonic scale as your count goes up
    tap(count) {
      if (!ctx || !prefs.sfx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      if (lastPlayed.tap && t - lastPlayed.tap < 0.03) return;
      lastPlayed.tap = t;
      const scale = [0, 2, 4, 7, 9], step = (count - 1) % 15, n = 76 + scale[step % 5] + 12 * Math.floor(step / 5) * 0.5;
      tone(mtof(Math.round(n)), t + 0.005, { type: 'triangle', dur: 0.09, gain: 0.16, verb: 0.05 });
      tone(mtof(Math.round(n)) * 2, t + 0.005, { type: 'sine', dur: 0.05, gain: 0.06, verb: 0 });
      if (count % 10 === 0) [0, 4, 7].forEach((d, i) => tone(mtof(Math.round(n) + 12 + d), t + 0.03 + i * 0.04, { type: 'triangle', dur: 0.25, gain: 0.1, verb: 0.3 }));
    },
    get music() { return prefs.music; },
    get sfx() { return prefs.sfx; },
    setMusic(on) { prefs.music = on; save(); if (!ctx) return; if (on) startMusic(); else stopMusic(); },
    setSfx(on) {
      prefs.sfx = on; save();
      if (ctx) sfxBus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
    },
  };
})();
