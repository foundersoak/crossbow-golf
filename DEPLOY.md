# Going live

Total cost: $0/month. No credit card is required at any step. Time: about 15 minutes.

## What you need

- A free Cloudflare account: https://dash.cloudflare.com/sign-up (email + password, no card)
- Node.js 20 or newer on your machine
- This repository cloned locally

## One-time setup

Run everything from the repository root.

```sh
# 1. Install dependencies
npm install

# 2. Sign in to Cloudflare (opens a browser window)
npx wrangler login

# 3. Create the database. This prints a database_id.
npx wrangler d1 create crossbow-golf
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing the placeholder zeros on the `database_id` line.

```sh
# 4. Create the storage bucket for photos and the drone overlay
npx wrangler r2 bucket create crossbow-golf-media

# 5. Create your local secrets file and fill in the real values:
#    property center, bounds, zoom, and a long random invite code.
cp .dev.vars.example .dev.vars
#    (edit .dev.vars in any editor; it is gitignored and never leaves your machine
#     except as encrypted Worker secrets in step 8)

# 6. Create the database tables
npm run db:migrate:remote

# 7. Build and deploy. This prints your app URL, like
#    https://crossbow-golf.<your-subdomain>.workers.dev
npm run deploy

# 8. Push the property location and invite code to the deployed Worker
#    as encrypted secrets (reads your .dev.vars)
bash scripts/push-secrets.sh
```

No terminal handy? Secrets can also be added in the dashboard: the Worker, then Settings, then Variables and Secrets, each added as type "Secret". The quick mobile path is two secrets: `INVITE_CODE`, plus `PROPERTY_CONFIG` whose value is a single JSON object carrying all seven property values under their standard names (`PROPERTY_CENTER_LAT`, `PROPERTY_CENTER_LNG`, `PROPERTY_BOUNDS_NE_LAT`, `PROPERTY_BOUNDS_NE_LNG`, `PROPERTY_BOUNDS_SW_LAT`, `PROPERTY_BOUNDS_SW_LNG`, `PROPERTY_DEFAULT_ZOOM`). Individual secrets win over the JSON if both are set.

Open the printed URL on your phone. Until step 8 runs, the app shows a readable "map not configured" screen; after it, the satellite map of the ranch.

## First run

1. Enter the invite code you chose in `.dev.vars`.
2. Add yourself by name. The first person to join becomes the admin.
3. Share the URL and invite code with the family, or just text them a round link later; joining a round through its link needs no code at all.
4. On iPhone: open in Safari, tap Share, then Add to Home Screen. That installs it as an app and protects offline scores from Safari's storage cleanup. Androids offer an install prompt automatically.

## Setting up the nine holes

You have two good ways, and they combine well:

**Walk the course (recommended).** Open the app on your phone at the ranch, go to the Map tab, tap Edit. Add a hole, stand on the tee, tap "I'm standing on it" for the tee, walk to the pin, tap "I'm standing on it" for the pin. The yardage computes as you go. Repeat for all nine, then tap Publish version and name it (for example "Opening day"). Published versions are permanent; rounds played on them keep their exact geometry forever.

**Drag on the satellite photo.** Any hole can also be placed by dragging the tee and pin markers on the imagery, or with "Place at map center". Useful for rough placement before a walk, and for fine tuning after. Public imagery of the ranch predates the course, so for real precision use your feet or the drone overlay.

**Drone overlay (the endgame).** After a drone flight, go to More, then Drone photo overlay: upload the photo, drag its four corners until fences and features line up with the basemap, save the alignment, and show it on the map. From then on you are placing pins against a current picture of the actual course.

Pins move? Open Edit, drag (or re-walk) the changed holes, publish a new version. Old rounds and leaderboards stay tied to the version they were played on.

## Updating the app later

```sh
git pull
npm install
npm run deploy
```

Database migrations, when a change ships one: `npm run db:migrate:remote` before deploying.

## Costs and quotas, for the record

Everything sits far inside Cloudflare's free tier: static assets are free and unlimited, a full 6-phone round bills roughly 25 Durable Object requests against a 100,000/day allowance, and D1/R2 usage is a rounding error. Nothing pauses when the app sits idle over winter. The only optional cost ever: a custom domain (about $10/year) if you outgrow the free workers.dev URL.

## Privacy notes

- The property coordinates live only in `.dev.vars` (your machine) and as encrypted Worker secrets. They are served to signed-in family members only and never appear in the repository or the public JS bundle.
- Tee and pin coordinates live in the database.
- Photos and the drone overlay live in a private R2 bucket and are served only to signed-in sessions.
- The invite code is stored as a hash. Rotate it any time from More, Admin.
