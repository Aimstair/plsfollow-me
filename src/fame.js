'use strict';
// Spotlight hall of fame: today's most-opened profiles (UTC day). Saved to DATA_DIR so restarts
// and deploys keep the board; without DATA_DIR it lives in memory only.
const fs = require('fs');
const path = require('path');

const today = () => new Date().toISOString().slice(0, 10);
const keyOf = (handle, platform) => `${platform}:${handle.toLowerCase()}`;

class Fame {
  constructor(dir) {
    this.file = dir ? path.join(dir, 'fame.json') : null;
    this.day = today();
    this.rows = new Map(); // key -> { handle, platform, opens, led, biggest }
    this.seen = new Set(); // `${ip}|${key}`: one counted open per visitor per profile per day
    this.dirty = false; this.version = 0;
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d.day !== today()) return;
      this.day = d.day;
      for (const r of d.rows || []) this.rows.set(keyOf(r.handle, r.platform), r);
      for (const s of d.seen || []) this.seen.add(s);
    } catch { /* first run or unreadable file: start fresh */ }
  }

  save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const data = JSON.stringify({ day: this.day, rows: [...this.rows.values()], seen: [...this.seen] });
    const tmp = this.file + '.tmp';
    try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, this.file); } catch (e) { console.error('fame save failed:', e.message); }
  }

  rollover() {
    const d = today();
    if (d === this.day) return;
    this.day = d; this.rows.clear(); this.seen.clear(); this.touch();
  }

  touch() { this.dirty = true; this.version++; }

  row(handle, platform) {
    const k = keyOf(handle, platform);
    let r = this.rows.get(k);
    if (!r) { r = { handle, platform, opens: 0, led: 0, biggest: 0 }; this.rows.set(k, r); }
    return r;
  }

  // A real viewer opened this profile. Returns true if it counted.
  open(handle, platform, ip) {
    this.rollover();
    const s = `${ip}|${keyOf(handle, platform)}`;
    if (this.seen.has(s)) return false;
    if (this.seen.size > 200000) return false; // runaway guard
    this.seen.add(s);
    this.row(handle, platform).opens++;
    this.touch();
    return true;
  }

  // Opens from the hall-of-fame list only count for people already on today's board
  has(handle, platform) { this.rollover(); return this.rows.has(keyOf(handle, platform)); }

  led(handle, platform, size) {
    this.rollover();
    const r = this.row(handle, platform);
    r.led++; r.biggest = Math.max(r.biggest, size);
    this.touch();
  }

  top(n = 10) {
    this.rollover();
    return [...this.rows.values()]
      .filter(r => r.opens > 0 || r.led > 0)
      .sort((a, b) => b.opens - a.opens || b.led - a.led || b.biggest - a.biggest)
      .slice(0, n)
      .map(r => [r.handle, r.platform, r.opens, r.led, r.biggest]);
  }
}

module.exports = { Fame };
