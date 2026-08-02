# Crossbow Ranch Pitch 'n Putt

A private web app for a family nine-hole pitch-and-putt course.

- **Course map** on satellite imagery: tees, pins, lines, live-computed yardages, per-hole notes and photos. Switchable imagery sources, plus a privately stored drone photo overlay aligned by dragging its four corners.
- **Course editor** for admins: drag markers or stand on the spot and tap "I'm standing on it". Publishing creates an immutable layout version; tee boxes and pins can move weekly without ever rewriting history.
- **Live scoring**: start a round, share a code or link, everyone scores on their own phone and sees the shared card update within a couple of seconds. Self-entry and scorekeeper modes work simultaneously. Rounds survive dropped WiFi, page refreshes, and locked screens; scores queue on the device and merge back losslessly on reconnect.
- **Boards**: per-layout leaderboards with a version picker, hole difficulty stats, all-time records clearly labeled when they span layouts, an ace log, and player profiles with trends.
- **Installable PWA**, designed for a phone in bright sun.

Runs entirely on Cloudflare's free tier: one Worker serving the app and API, one Durable Object per live round, D1 for history, R2 for images. $0/month, no credit card, nothing pauses when idle. See [DEPLOY.md](DEPLOY.md) for the 15-minute go-live guide.

## Architecture in one paragraph

The client is a Vite + React SPA served as Worker static assets. Score writes travel exactly one path: an IndexedDB outbox that coalesces per cell (round, player, hole) and POSTs to the round's Durable Object, which applies last-write-wins by skew-corrected entry time (ties broken deterministically), appends to an event log in its own SQLite, broadcasts over hibernating WebSockets, and write-through-replicates to D1 with alarm retries. A null value can never overwrite a score; clears are explicit events. Leaderboards read D1 only. Published layouts are append-only and rounds pin their layout version forever.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in real values (gitignored)
npm run db:migrate:local
npm run dev
```

Without `.dev.vars` the app runs but shows a readable "map not configured" screen instead of a map.

## Tests

```sh
npm test          # unit suite + Durable Object integration suite
npm run test:unit
npm run test:worker
```

The worker suite runs the real RoundRoom Durable Object and covers the reconnect contract: the offline-at-hole-3 scenario end to end, null-never-overwrites, idempotent replay, clock skew clamping, and final-round locking. The unit suite covers the haversine yardage math (including the latitude sanity constants from the design brief) and outbox coalescing/ack semantics.

## Privacy rules for this repository

- Real coordinates (property, tees, pins) never enter the repo: they live in `.dev.vars` locally, Worker secrets in production, and the database. Committed tests and examples use obviously fake coordinates.
- `wrangler.jsonc` must never gain a `vars` section with real values. Use `bash scripts/push-secrets.sh`.
- Drone imagery and photos live in a private R2 bucket, never in the repo, and are served only to signed-in sessions. The client bundle contains no coordinates; the map loads them from a session-gated endpoint.

## Future considerations (deliberately not built)

Handicaps, multi-course support, match play and other formats, weather, GPS shot tracking. The schema keeps the first two cheap: a `courses` table exists from day one, and the append-only per-hole event log is exactly the history handicap math needs.
