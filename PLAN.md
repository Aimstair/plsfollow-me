# plsfollow.me — The Snake

One giant snake made of strangers. Every visitor is one segment. Only the head steers.
Each head leads for exactly 30 seconds. In the last 10, every follower races (reaction tap)
and the fastest becomes the next head.
If the snake bites itself, it splits in two, and the two snakes then fight over people.

**Goal:** it should be understandable within 2 seconds of landing, show real people
right away, and produce moments worth screenshotting and sharing.

---

## 1. Core rules

| Rule | Detail |
|---|---|
| Join | Visitors are added to the tail of the **biggest** snake. |
| Steer | Only the head steers, using mouse, finger or arrow keys. Everyone else follows the segment in front of them. |
| Leadership | Each head gets exactly 30s. The last 10s are the race for next head (section 3a). The winner leads next, and the old head goes to the tail. If nobody races, the next *active* human in line leads. Bots and AFK users are skipped. |
| AFK | A head that sends no input for 1s goes on autopilot (wanders, avoids walls). After 8s idle, leadership passes to the next active human. |
| Self-bite | If the head touches its own body (segment ≥ 10), the snake splits. Everything behind the bite becomes a new snake, and the bitten segment becomes its head. |
| Steal | If a head touches another snake's body at segment k, everything from k to the tail is taken and attached to the attacker's tail. |
| Head-on | The bigger snake captures the other head. |
| Grace | A snake that just split or stole cannot collide for 1–1.5s. This prevents chain reactions. |
| Arena | A circle whose radius grows with player count (`700 + 30·√N`). Heads slide along the wall. |
| Trolls | Every snake segment is a real person. Five purple 👹 trolls wander the map at random, keeping far apart from each other. They don't chase anyone. A troll touching a head costs that leader 5 seconds of their turn. A troll touching a body breaks the snake there, and everyone behind becomes a new snake. After a hit a troll is harmless for 4s. A head with no tail that touches a troll is knocked out. |

**What a new visitor sees:** if nobody else is playing, they start their own snake and lead it
immediately. Otherwise they join the tail of the biggest snake and can win the next race, which starts in at most 20s.

---

## 2. Architecture

```
Browser (canvas client)  ⇄  WebSocket  ⇄  Node game server (single authoritative loop, 20 Hz)
```

- **The server is authoritative.** Clients send only their steering angle. The server
  simulates everything and broadcasts the state.
- **Why not Vercel:** Vercel doesn't hold long-lived WebSockets. The game server runs
  on **Fly.io** (or Railway/Render), and the static client is served by the same process.
  This means one deploy and one domain.
- **Stack:** Node 20+, `ws`, vanilla canvas and JS. No framework, so the client loads fast.
  Can move to TypeScript later.

### Simulation (per tick, 50ms)
1. Balance bots, then update the arena radius.
2. Leadership: rotate when the timer expires or the head is AFK.
3. Heads turn toward the target angle (max 4.5 rad/s) and move at 170 px/s.
4. Followers use rope physics: each follower moves toward the segment in front until it is
   16px away, at up to 2.5× head speed. Stolen or reattached people therefore glide to
   their new position instead of teleporting.
5. Collisions: build a spatial hash grid (32px cells), then check each head against the
   nearby segments. At most one event per snake per tick.
6. Broadcast the state.

### Wire protocol
- Server sends JSON events: `hello {pid}`, `lead`, `ev {msg}` (split or steal notices).
- Client sends JSON: `join`, `a {angle}`. The angle is sent at about 15Hz, only while
  the tab is visible, and doubles as the activity heartbeat.
- Server sends one shared binary state buffer (little-endian) to everyone:
  ```
  u8 type | u16 arenaR | u16 humans | u16 watchers | u16 snakeCount
  per snake: u16 id | u16 len | u8 leadSecondsLeft
  per seg:   i16 x | i16 y | u16 pid | u8 flags(bit0 = bot)
  ```
  That's 7 bytes per segment. The client finds itself by `pid`, so every client gets the
  same buffer and the server encodes it once per tick.
- Clients whose `bufferedAmount` is over 1MB are skipped, so slow phones can't stall the loop.

### Client
- Interpolates between the last two snapshots so motion looks smooth at 60fps.
- The camera follows you. Spectators (before joining) watch the biggest snake's head.
- Each person's color comes from their pid, so the snake is a rainbow. Your dot has a
  white ring and a "YOU" label. Each head has a 👑 and eyes.
- An arrow at the screen edge points to your snake's head.
- HUD: live player count, your position and lead ETA, a leaderboard of snakes, and a minimap.
- Steering by pointer, touch or arrow keys. `touch-action: none` on mobile.

---

## 3. Built to spread

- **Landing overlay over the live game:** "pls follow me 🐍 — 2,847 strangers are in a
  snake right now. [Join the tail]". The live snake moves in the background.
- **Share button:** "I was #412 in a snake of 2,847 strangers 🐍 plsfollow.me". Uses
  `navigator.share` on mobile and copies to the clipboard on desktop.
- **Shareable card (v1.1):** a canvas-rendered PNG of your snake with your position
  highlighted.
- **Moment toasts:** "💥 The snake bit itself!", "😈 You stole 37 people!",
  "👑 YOU ARE THE HEAD".
- **Session stats at exit (v1.1):** time in the snake, times you led, people you stole.
- **OG and Twitter meta tags** with a preview image, so links look good in chats.
- **Launch tactic:** announce a fixed start time ("the snake opens Friday 8pm UTC") so
  there's a crowd in the first minute. Post a screen recording of the first big snake.

---

## 3a. Competing for the head

**Every head gets exactly 30 seconds.** Nobody can knock them off early, and the head never
gets a pop-up.

| Phase | What happens |
|---|---|
| **0–20s: the head leads** | The head steers, steals, and grabs ⚡ boosts. Followers watch the spotlight card and follow the head. The race board shows "starts in 0:12". |
| **20–30s: race for next head** | Every follower (everyone except the head) gets the reaction pad automatically, and it turns green **at the same instant for everyone**. The fastest tap wins. A live top-3 board shows the times as they come in. Tapping before green counts as a miss. The head keeps steering and sees "your followers are racing for your spot". |
| **30s: handover** | The race winner becomes the head, and the old head goes to the tail. If nobody tapped, the next person in line leads. Then the next turn starts. |

Other competition:
- **⚡ Speed boosts:** pickups around the arena give the head 1.6× speed for 3s. They're good for chasing down another snake to steal people, or for escaping one.
- **🥊 Head-on clash:** when two heads collide, the bigger snake captures the other head (who joins the winner's tail). The losing snake's next person becomes its head and gets a fresh 30s.
- **😈 Steal / 💥 bite:** hit another snake's body to take everyone behind that point, or bite your own body and split.

**Fairness and anti-cheat:**
- The server picks the green moment and sends it with a short warning, and every client measures the reaction locally. The server also checks the timing against when the tap message arrives. Reactions under 120ms are rejected as bots or cheating.
- Network lag doesn't decide the winner, because each client measures its own reaction time.
- Each person gets one tap per race.

Later ideas: different race games on different days (reaction, tap count, quick math),
a daily "most crowns won" leaderboard, and a paid "second chance" tap (cosmetic only if it
feels unfair).

---

## 3b. Getting followers on real social media

The core idea: **being the head is a spotlight.** Whoever leads is shown to everyone in the
snake, and anyone can follow them with one tap.

### How it works
- **Add your socials (optional) when you join:** an Instagram, TikTok, X, YouTube or
  Twitch handle, plus an optional avatar. Players who skip this still play as anonymous dots.
- **Spotlight card:** while you're the head, everyone in your snake sees a card at the
  bottom of their screen: avatar, @handle, and a **Follow** button for each platform.
  The button opens your real profile in that app (deep link). The person taps Follow there.
- **Tap any dot:** tapping a segment shows that person's handle. You can follow people near
  you in the line, not only the head.
- **"Followed you" signal:** when someone taps Follow on your card, you see a
  "🔔 23 people opened your profile" toast. That's the dopamine loop.
- **Leading stats:** after your turn, a summary like "Your 30s as head: shown to 412 people,
  37 opened your Instagram."
- **Bigger snake, bigger audience.** This gives people a reason to steal followers and to
  bring friends into the snake.

### What we can and can't do (platform rules)
- No platform lets a third-party site follow on someone's behalf (Instagram and TikTok
  have no follow API, and X's is paid and restricted). Every follow is a **real person
  tapping Follow in the real app**. This is the right approach anyway: it keeps accounts safe.
- We count **profile opens (clicks)**, not confirmed follows, and say so clearly.
- No "follow-for-follow required" rules and no "guaranteed followers" promises. Instagram
  and others treat incentivized follow schemes as spam and can penalize the accounts involved.
  Following stays voluntary, and the game is the reason people are here.
- Moderation: a filter for banned words in handles, a report button on the spotlight card,
  and handles shown only after the player is old enough to have the account (13+).

### Making money from it
| Feature | Price idea |
|---|---|
| **Spotlight boost:** lead for 60s instead of 30s, with a glowing head | $1–2 per boost |
| **Skip the line:** jump to the next turn as head | $1 per skip, with a limited number per hour so it stays fair |
| **Pro profile:** custom color or skin, link to your own page, detailed stats | $3–5/mo |
| **Creator rooms:** a streamer gets `plsfollow.me/their-name` with their own snake where they are the permanent head | $10–30/mo |
| **Brand snake:** a sponsored head during launch events | Custom deals |

Payments go through Stripe Checkout. Keep the free game fully playable, so paid features
add visibility and never decide who wins.

### Data changes
- Join message gets `{handle, platform, avatarUrl?}`. The server validates the format and
  stores it only for the session (no accounts in v1).
- A new message `profile {pid, handles}` is sent when someone becomes head, plus
  `click {pid, platform}` from viewers, which the server counts and relays to the head.
- Click counts and boost purchases are stored in Supabase so creators can see their stats.

---

## 4. Milestones

**M0 – Setup**
- [x] Install Node 20+ (private copy in `~/.local/node`, see README)
- [x] `npm init`, add `ws`, create the folder structure

**M1 – Playable locally (about 1 day)**
- [x] `server.js` + `src/game.js`: static file serving, WebSocket, game loop, bots, leadership, race, split and steal
- [x] `public/index.html` + `public/app.js`: canvas renderer, interpolation, HUD, input, landing overlay, spotlight, share card
- [x] `scripts/load-test.js`: 200 fake clients → ~4 ms average tick

**M2 – Fun pass**
- [ ] Tune speed, spacing and turn rate, and the 30s lead time (maybe shorter for small snakes)
- [ ] Toasts, the 👑 marker, the head-direction arrow, the minimap, the leaderboard
- [ ] Mobile testing on iOS Safari and Android Chrome

**M3 – Launch**
- [ ] Deploy to Fly.io: `fly launch`, a single machine to start, region near the expected audience
- [ ] Point `plsfollow.me` DNS to Fly and set up TLS (`fly certs add plsfollow.me`)
- [ ] OG image, favicon, privacy note (no accounts, no tracking beyond counts)
- [ ] Basic abuse protection: per-IP connection cap, message rate limit, `maxPayload`

**M4 – After launch (only once there's traction)**
- [ ] Optional nickname and country flag on segments (GeoIP from Fly's request header)
- [x] Shareable PNG card (three styles) and session stats
- [ ] Line wars: let any head "call" followers, and add a "longest snake right now" board
- [ ] Scaling: send each client only the area near it instead of the whole state, and use
      delta compression. At about 5k concurrent users, shard into rooms or move to
      Cloudflare Durable Objects.

---

## 5. Open questions
- Should a self-bite *cut off* the tail (more chaos, more snakes) or be ignored? Current plan: split.
- Lead time: a fixed 30s, or scaled to snake length so long snakes rotate faster?
- Should bots be visible (honest, grey) or hidden once a few humans are online? Plan: visible, removed as humans join.

## 6. Cost
- Domain: already bought.
- Fly.io: one shared-cpu machine is about $2–5/mo. Bandwidth is the main cost if the game
  goes viral, which is why the per-viewport state in M4 matters.
