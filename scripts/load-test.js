'use strict';
// Spawns fake players that join, steer when they're the head, and race when the pad turns green.
// Usage: node scripts/load-test.js [clients=50] [seconds=40] [url=ws://localhost:8080/ws]
const WebSocket = require('ws');

const N = Number(process.argv[2]) || 50;
const SECS = Number(process.argv[3]) || 40;
const URL_ = process.argv[4] || 'ws://localhost:8080/ws';
const origin = URL_.replace(/^ws/, 'http').replace(/\/ws$/, '');

const tally = { states: 0, bytes: 0, joined: 0, taps: 0, tapOk: 0, tapBad: 0, events: {}, wonRace: 0, ledTurns: 0, errors: 0 };

function bot(i) {
  const ws = new WebSocket(URL_, { origin });
  let pid = 0, mySid = 0, myIdx = -1, myAngle = 0, offset = 0;
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'sync', c: Date.now() }));
    setTimeout(() => ws.send(JSON.stringify({ t: 'join', handle: i % 3 ? `tester_${i}` : '', platform: ['ig', 'tt', 'x', 'yt', 'tw'][i % 5] })), 50 + Math.random() * 500);
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      tally.states++; tally.bytes += data.length;
      // Decode just enough to find ourselves
      const b = data; let o = 1 + 8 + 2 + 2; const nb = b.readUInt8(o); o += 1 + nb * 4;
      const ns = b.readUInt16LE(o); o += 2; mySid = 0; myIdx = -1;
      for (let s = 0; s < ns; s++) {
        const id = b.readUInt16LE(o), len = b.readUInt16LE(o + 2), ang = b.readInt16LE(o + 8) / 5000; o += 10;
        for (let k = 0; k < len; k++, o += 8) if (b.readUInt32LE(o + 4) === pid) { mySid = id; myIdx = k; if (k === 0) myAngle = ang; }
      }
      return;
    }
    const m = JSON.parse(data);
    if (m.t === 'you') { pid = m.pid; tally.joined++; }
    else if (m.t === 'sync') offset = m.s - (m.c + (Date.now() - m.c) / 2);
    else if (m.t === 'ev') for (const e of m.l) { tally.events[e.k] = (tally.events[e.k] || 0) + 1; if (e.k === 'turn' && e.head === pid) { tally.ledTurns++; if (e.ms) tally.wonRace++; } }
    else if (m.t === 'go') {
      // React like a human: 180-450 ms after green, sometimes too early
      const early = Math.random() < 0.08, react = Math.round(180 + Math.random() * 270);
      const wait = m.at - offset - Date.now() + (early ? -300 : react);
      setTimeout(() => { tally.taps++; ws.send(JSON.stringify({ t: 'tap', sid: m.sid, turn: m.turn, ms: early ? -1 : react })); }, Math.max(0, wait));
    } else if (m.t === 'tapr') { if (m.ok) tally.tapOk++; else tally.tapBad++; }
  });
  ws.on('error', () => tally.errors++);
  // Heads wiggle around; everyone heartbeats
  const steer = setInterval(() => {
    if (ws.readyState !== 1) return;
    if (myIdx === 0) ws.send(JSON.stringify({ t: 'a', a: myAngle + (Math.random() - 0.5) * 1.2 }));
    else if (Math.random() < 0.05) ws.send(JSON.stringify({ t: 'hb' }));
  }, 66);
  return () => { clearInterval(steer); ws.close(); };
}

const stops = [];
for (let i = 0; i < N; i++) setTimeout(() => stops.push(bot(i)), i * 20);
setTimeout(async () => {
  stops.forEach(s => s());
  const health = await fetch(origin + '/healthz').then(r => r.json()).catch(() => null);
  console.log(JSON.stringify({ clients: N, seconds: SECS, ...tally, avgStateBytes: Math.round(tally.bytes / Math.max(1, tally.states)), health }, null, 2));
  setTimeout(() => process.exit(0), 300);
}, SECS * 1000);
