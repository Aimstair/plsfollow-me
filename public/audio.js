// Procedural audio for plsfollow.me: a generative lo-fi loop and synthesized sound effects.
// Nothing is downloaded; every sound is built with Web Audio. Browsers only allow audio after a
// tap or click, so the game calls PFAudio.unlock() from its first user gesture.
window.PFAudio = (() => {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const prefs = { music: true, sfx: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('pf-audio') || '{}')); } catch { /* storage blocked */ }
  const save = () => { try { localStorage.setItem('pf-audio', JSON.stringify(prefs)); } catch { /* storage blocked */ } };

  let ctx = null, master, musicBus, sfxBus, reverb, delay, padFilter, crackle = null, timer = 0, nextTime = 0, step = 0;
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
    s.buffer = b; s.loop = true; f.type = 'highpass'; f.frequency.value = 900; g.gain.value = 0.16;
    s.connect(f).connect(g).connect(musicBus); s.start();
    crackle = s;
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
  function scheduler() {
    while (nextTime < ctx.currentTime + 0.3) { playStep(step, nextTime); nextTime += EIGHTH; step++; }
  }
  function startMusic() {
    if (!ctx || timer) return;
    if (!crackle) startCrackle();
    nextTime = ctx.currentTime + 0.1; step = 0;
    timer = setInterval(scheduler, 50);
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 4);
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
    out: t => { [67, 66, 65].forEach((n, i) => tone(mtof(n - 12), t + i * 0.28, { type: 'sawtooth', dur: 0.32, gain: 0.18, filter: 900 })); tone(mtof(52), t + 0.84, { type: 'sawtooth', dur: 0.9, gain: 0.19, to: mtof(47), filter: 800 }); },
    opened: t => { tone(1320, t, { dur: 0.5, gain: 0.13, verb: 0.35 }); tone(1980, t + 0.07, { dur: 0.6, gain: 0.09, verb: 0.35 }); },
    turn: t => { tone(mtof(76), t, { dur: 0.35, gain: 0.1, verb: 0.3 }); tone(mtof(83), t + 0.1, { dur: 0.45, gain: 0.08, verb: 0.3 }); },
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
    get music() { return prefs.music; },
    get sfx() { return prefs.sfx; },
    setMusic(on) { prefs.music = on; save(); if (!ctx) return; if (on) startMusic(); else stopMusic(); },
    setSfx(on) {
      prefs.sfx = on; save();
      if (ctx) sfxBus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
    },
  };
})();
