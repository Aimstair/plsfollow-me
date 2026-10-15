# plsfollow.me

One giant multiplayer snake made of strangers. Every visitor is one segment; only the head steers.
Each head leads for 30 seconds, the last 10 are a reaction race for next head, and while you lead
the whole snake sees your profile. See `PLAN.md` for the design.

## Run it locally

Node 20+ is required. On this Mac a private copy lives in `~/.local/node` (not on the PATH by default):

```sh
export PATH="$HOME/.local/node/bin:$PATH"
npm install
npm start            # http://localhost:8080
```

Open it in two browser windows to play against yourself. `npm run dev` restarts on file changes.

## Load test

```sh
MAX_CONN_PER_IP=1000 npm start          # in one terminal (the default cap is 12 per IP)
node scripts/load-test.js 200 60        # 200 fake players for 60 seconds
```

It prints messages received, race taps accepted/rejected, and the server's tick time from `/healthz`.

## Layout

| Path | What it is |
|---|---|
| `server.js` | HTTP static files, `/healthz`, avatar images at `/a/<boot>/<pid>`, WebSocket at `/ws` |
| `src/house.js` | Host accounts played by the server (edit `GROUPS` at the top to change them) |
| `src/boss.js` | The 3 bosses (Algorithm, Influencer, Comment Section): cycle, telegraphed attacks, hits, fight-back tokens (`BOSS_FIRST_MS` shortens the first landing and `BOSS_KIND` forces one boss, both for local testing) |
| `public/boss.js` | Draws each boss, its warnings and attacks, tokens, the boss bar and minimap marker, and times its sounds |
| `src/paid.js` | Paid bots: $5 Stripe Checkout, signed webhook, 30-day orders saved to `DATA_DIR` |
| `src/fame.js` | Today's spotlight hall of fame (most-opened profiles), saved to `DATA_DIR` |
| `src/stats.js` | Traffic stats: sources (referrer or in-app browser), utm campaigns, invite links, countries (from timezone), devices, and joins/spectates per day. No cookies or IPs stored; saved to `DATA_DIR/stats.json` for 120 days |
| `src/game.js` | Authoritative 20 Hz simulation: snakes, turns, races, steals, bites, trolls, binary state encoding |
| `public/index.html` | Markup and styles |
| `public/app.js` | Client: interpolation, rendering, input, race pad, spotlight card, share card |
| `scripts/load-test.js` | Scripted players for testing |
| `mockup.html` | The original single-file mockup (all players simulated) |

## Deploy to Fly.io

The game state lives in one process's memory, so it must run on **exactly one machine**.

```sh
brew install flyctl        # or: curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy --copy-config --name plsfollow-me   # keeps fly.toml
fly deploy --ha=false
fly certs add plsfollow.me
fly certs add www.plsfollow.me
```

Then at your domain registrar, point DNS at the app (the `fly certs add` output lists the exact records):
- `A` record `@` → the app's IPv4 (`fly ips list`)
- `AAAA` record `@` → the app's IPv6
- `CNAME` `www` → `plsfollow-me.fly.dev`

A shared-cpu-1x machine with 512 MB costs a few dollars a month. The hall of fame is saved on a 1 GB Fly volume named `pf_data`, mounted at `/data`.

### Automatic deploys

`.github/workflows/fly-deploy.yml` deploys on every push to `main` (and can be run by hand from the
Actions tab). It needs a repo secret named `FLY_API_TOKEN` containing a deploy token from
`fly tokens create deploy -a plsfollow-me`.

### Paid bots ($5 / 30 days)

Players can pay to have a bot play as their profile for 30 days (tagged ✦ promoted). Setup:

1. In the Stripe dashboard → Developers → Webhooks, add an endpoint
   `https://plsfollow.me/api/stripe-webhook` for the event `checkout.session.completed`.
2. Set the keys (the app restarts by itself):
   `fly secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... -a plsfollow-me`
3. See or remove paid bots: `https://plsfollow.me/admin/bots?token=<ADMIN_TOKEN>`
   (add `&remove=<id>` to take one down).

Until the Stripe keys are set, the button explains that payments aren't set up yet.

## Traffic stats

`https://plsfollow.me/admin/stats?token=<ADMIN_TOKEN>` shows visitors per day, where they came from,
utm campaigns, invite links, countries, devices, and how many joined, spectated or left without playing.
Add `&days=7` (up to 120) or `&format=json`. Tag share links like `https://plsfollow.me/?utm_source=threads&utm_campaign=launch`
to tell campaigns apart. Days follow `STATS_TZ` (default `Asia/Manila`).

## Limits to know about

- Every client receives the whole world 20 times a second (about 8 bytes per player per frame).
  At 200 players that's ~34 KB/s per viewer. Past roughly 1,000 concurrent players, add
  per-viewport culling (PLAN.md, M4) before bandwidth gets expensive.
- Profile photos are kept in memory only for the session and are never written to disk.
- Profile opens are counted once per viewer per profile per session. They are opens, not follows.
