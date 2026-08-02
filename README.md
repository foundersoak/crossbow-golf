# Crossbow Ranch Pitch 'n Putt

A private web app for a nine-hole pitch-and-putt course: course map on satellite imagery, an admin course editor with draggable tees and pins, immutable published layout versions, live multi-device scoring that tolerates WiFi dropouts, and leaderboards per layout version.

Runs entirely on Cloudflare's free tier: one Worker (static app + API), a Durable Object per live round, D1 for history, R2 for photos. No credit card required anywhere.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in the real property values
npm run db:migrate:local
npm run dev
```

The map reads the property location from `.dev.vars`, which is gitignored. Without it the app shows a readable "map not configured" screen instead of a map. Never put real coordinates in committed files; see the privacy notes below.

## Tests

```sh
npm test
```

Includes the haversine sanity checks and (from Phase 3) the reconnect merge test suite, including the device-offline-at-hole-3 scenario.

## Deploying (summary)

Full step-by-step instructions live in [DEPLOY.md](DEPLOY.md).

1. Create a free Cloudflare account, then `npx wrangler login`.
2. `npx wrangler d1 create crossbow-golf` and paste the printed `database_id` into `wrangler.jsonc`.
3. `npx wrangler r2 bucket create crossbow-golf-media`
4. `npm run db:migrate:remote`
5. Set the secrets (property location + invite code): `bash scripts/push-secrets.sh`
6. `npm run deploy`

## Privacy rules for this repo

- Real coordinates (tees, pins, property bounds) live only in the database and in Wrangler secrets / `.dev.vars`. Committed examples and tests use obviously fake coordinates.
- Drone imagery and photos are stored in R2, never in the repo.
- `wrangler.jsonc` must never gain a `vars` section with real values; use secrets.
