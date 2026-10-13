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
| `src/game.js` | Authoritative 20 Hz simulation: snakes, turns, races, steals, bites, ghosts, binary state encoding |
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

A shared-cpu-1x machine with 512 MB costs a few dollars a month.

### Automatic deploys

`.github/workflows/fly-deploy.yml` deploys on every push to `main` (and can be run by hand from the
Actions tab). It needs a repo secret named `FLY_API_TOKEN` containing a deploy token from
`fly tokens create deploy -a plsfollow-me`.

## Limits to know about

- Every client receives the whole world 20 times a second (about 8 bytes per player per frame).
  At 200 players that's ~34 KB/s per viewer. Past roughly 1,000 concurrent players, add
  per-viewport culling (PLAN.md, M4) before bandwidth gets expensive.
- Profile photos are kept in memory only for the session and are never written to disk.
- Profile opens are counted once per viewer per profile per session. They are opens, not follows.
