# PLAN.md: Crossbow Ranch Pitch 'n Putt

A private nine-hole pitch-and-putt web app for family and friends. Course map on a satellite basemap, admin course editor with draggable tee and pin markers, immutable published layout versions, live multi-device scoring with a reconnect path that provably loses nothing, and leaderboards scoped by layout version.

This plan resolves the four technical questions from the brief with research current as of August 2026. Sources are linked inline. No code has been written. Implementation starts only after this plan is approved.

---

## 1. Assumptions and batched questions

None of these blocked planning; I made the call listed and flagged it here. Correct any of them at approval time and I will adjust before building.

1. **Frontend framework.** The brief does not name one. I chose Vite + React + TypeScript as a plain SPA (no SSR). Rationale in section 3. Swappable now at zero cost, expensive later.
2. **Local env file name.** The brief specifies `.env.local`. Wrangler's convention for local secrets is `.dev.vars`. I plan to use `.dev.vars` (gitignored, same variable names) for the Worker and document it in the README. Section 9 explains why the coordinates should live server-side rather than in the client bundle.
3. **Admin designation.** Admins are flagged on the player roster (an `is_admin` column) rather than a separate login. First admin is seeded; admins can promote others. No separate admin password.
4. **Round links double as entry.** A device that opens a round share link with no prior session gets to pick a name from that round's roster and receives a full device session. The family invite code is only needed when entering the app without a round link. This is the frictionless-join interpretation; tighten it if you want the invite code required always.
5. **Leaderboard eligibility.** Only completed rounds count toward leaderboards and records. Active rounds appear on the home screen but not in stats.
6. **Spectators.** Anyone with a session can open a live round read-only. Only players in the round (or admins) can write scores.

---

## 2. Recommended stack

**Cloudflare Workers (single Worker with static assets) + Durable Objects (one per live round, via PartyServer) + D1 (history and leaderboards) + R2 (photos and the drone overlay). Frontend: Vite + React + TypeScript SPA with Leaflet. Deployed with Wrangler; local dev via the Cloudflare Vite plugin.**

The brief said to weight the decision heavily on live multi-device sync with the least custom infrastructure, and to compare Supabase Realtime and Durable Objects directly rather than defaulting. Both were researched; the comparison follows.

### Durable Objects vs Supabase Realtime, head to head

| Dimension | Cloudflare: DO room per round | Supabase Realtime channel |
|---|---|---|
| Sync fit | One DO per round is the canonical pattern: `idFromName(joinCode)`, WebSocket per phone, in-memory fan-out, per-room SQLite state. PartyServer (Cloudflare-acquired PartyKit successor, actively maintained, v0.5.9 July 2026) reduces the room server to ~50 lines and its client `partysocket` is a battle-tested reconnecting WebSocket with outgoing-message buffering | Low-code too: channel subscribe plus Postgres upsert plus a trigger calling `broadcast_changes()`. But done right it needs RLS policies, `realtime.messages` authorization for private channels, and auth setup: more console configuration, less owned code |
| Free tier fit | Absurd headroom. DOs are on the Workers free plan since April 2025 (SQLite-backed). 100k DO requests/day; WebSocket incoming messages billed 20:1, so a 6-phone round of ~500 updates is ~25 billed requests. Hibernation makes idle open sockets cost nothing. Static asset requests free and unlimited | Also huge headroom on paper (200 concurrent connections, 2M messages/month). Capacity is not the problem |
| Idle-for-weeks risk | **Near zero. Nothing pauses.** Workers, DO, and D1 scale to zero with no inactivity policy | **The dealbreaker. Free projects pause after ~7 days of low activity** and resume is a manual dashboard click. A family app idle from November to March will be dead at the first spring tee time, unless you run a keep-alive cron hack or pay $25/month Pro ([supabase.com/docs/guides/platform/free-project-pausing](https://supabase.com/docs/guides/platform/free-project-pausing)) |
| Reconnect merge | Server-side dedupe and last-write-wins are trivial and race-free because a DO processes messages one at a time per room. Rejoin gets a full snapshot from DO storage. We write the merge logic ourselves, ~30 lines, correct by construction | Slightly less custom code: upserts keyed on (round, player, hole) are naturally idempotent and Broadcast Replay gives 72h catch-up. Real strength, but not enough to offset the pause policy |
| Lock-in | High API lock-in (DO and hibernation are proprietary; PartyServer is OSS but Cloudflare-only). Data stays portable SQL | Lower lock-in; Postgres is maximally portable |
| Operator experience | You already deploy on Cloudflare Workers | New dashboard, RLS mental model, two vendors (Vercel + Supabase) |

Verdict: Cloudflare wins on the two weighted criteria (least custom infra for sync that actually stays alive, and hobby economics) and matches your existing deploy experience. The cost is proprietary architecture, acceptable for a family app whose data (plain SQL) remains exportable.

Sources: [DO free tier changelog](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [PartyServer](https://github.com/cloudflare/partykit), [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Vercel WebSocket beta limits](https://vercel.com/changelog/websocket-support-is-now-in-public-beta).

### Stack details

- **Single Worker, not Cloudflare Pages.** Pages is being absorbed into Workers and, decisively, Pages Functions cannot define Durable Objects. Workers static assets serve the SPA free and unlimited ([migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)).
- **Vite + React SPA.** Deploys trivially via `@cloudflare/vite-plugin` (GA since 2025) with SPA fallback routing. React chosen over SvelteKit because no SSR is needed (the app is behind an auth gate, so SEO is irrelevant), the Leaflet ecosystem is React-friendly, and it keeps the toolchain to one Vite config. If you prefer Svelte, say so at approval; nothing else in this plan changes.
- **Data placement.** The round Durable Object is the authority while a round is live: it holds the scorecard state and the append-only event log in its own SQLite storage. Every accepted event is also written through to D1 asynchronously with retry, and completing a round finalizes it in D1. Leaderboards, records, profiles, and layout history read only from D1. Course layouts, drafts, players, and sessions live only in D1 (no realtime need).
- **R2** stores hole photos and the drone overlay image. Nothing binary in the repo or D1.
- **Tests** run under Vitest with `@cloudflare/vitest-pool-workers`, which can instantiate the real DO class in tests. The reconnect scenario from the brief becomes an automated integration test (section 5).
- **Hard constraint: $0/month.** Everything in this plan runs on free tiers with no credit card on file. Concretely: Cloudflare free plan (Workers, DO, D1, R2 all have free quotas with orders-of-magnitude headroom at 15 users, and nothing pauses when idle), the free `workers.dev` URL instead of a custom domain, keyless Esri imagery (moving to Esri's free-key tier only if the keyless endpoint tightens), public-domain NAIP, and no email or auth service. The Google Maps layer stays unwired by default partly because enabling it requires a card on file. Any future change that would introduce a cost or require payment details gets flagged for explicit sign-off first, not made silently.

---

## 3. The four technical decisions

### 3.1 Imagery

Recommendation: **default to Esri World Imagery, add TxGIO NAIP as a switchable second layer, and build the drone-photo overlay in v1 as the endgame.** Google and Mapbox are documented as optional keyed upgrades but not wired by default. All layers sit behind a runtime layer switcher so sources can be compared live and abandoned if one degrades.

| Option | Facts found (Aug 2026) | Call |
|---|---|---|
| **Esri World Imagery** | Classic keyless tile endpoint still live (`server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}`). Imagery services are exempt from Esri's legacy raster basemap retirement. Maxar Vivid coverage, roughly 30 to 60 cm in rural Texas, refreshed annually; typically fresher than Mapbox in rural areas. Attribution required; esri-leaflet injects it. The officially supported path is a free ArcGIS Location Platform key with 2M tiles/month free | **Default basemap.** Start keyless with attribution; move to the free Location Platform key if the keyless endpoint ever tightens. Capture dates verifiable via the [Wayback app](https://livingatlas.arcgis.com/wayback/) |
| **USDA NAIP via TxGIO** | Public domain, no key, no license. TNRIS hosts are dead; the current host is `imagery.geographic.texas.gov`. Newest web service found: **NAIP 2022, 60 cm** (`.../NAIP/NAIP22_NCCIR_60cm/ImageServer`). NAIP 2024 exists only as county mosaic downloads so far, no 2024 ImageServer yet. Consumed via esri-leaflet `imageMapLayer`. The gov-only 6-inch Texas Imagery Service is excluded per the brief | **Second layer** in the switcher. Public domain and often the most honest picture of rural land, but 2022 vintage predates the course. CORS needs a live check in Phase 0; if it fails, drop the layer with no architectural impact |
| **Mapbox Satellite** | 200k free raster tile requests/month, token required, no credit card. But rural US imagery leans on NAIP collected around 2018 to 2019 per Mapbox's own docs | Documented optional layer. Stale rural imagery makes it pointless as a default |
| **Google Maps JS API satellite** | Since March 2025: 10k free dynamic map loads/month, then $7 per 1k. Requires a billing account with a credit card before you get a key. ToS forbids using the tiles outside Google's own renderer and forbids offline tile caching, which conflicts with a PWA | Documented optional layer, off by default. The renderer lock-in means it cannot share our Leaflet layer switcher; it would be a separate map mode. Lowest priority |
| **Drone overlay (endgame)** | Leaflet.DistortableImage (Public Lab) is the only ready-made 4-corner drag/rotate/scale UI; repo is active and works with Leaflet 1.9.x, though the npm release is stale (Oct 2022). Core `L.imageOverlay` is the zero-risk fallback (axis-aligned bounds, no rotation). MapLibre GL has a clean 4-corner image source primitive but no alignment UI | **In v1** (Phase 5). Admin uploads a high-altitude photo to R2, drags four corners over the reference basemap, corners persist to D1 so the overlay is reproducible, opacity slider for comparison. Try DistortableImage first; if its stale packaging fights the build, fall back to a hand-rolled 4-corner-handle affine mode over `L.imageOverlay.rotated`, and accept axis-aligned `L.imageOverlay` only as a last resort |

One privacy finding worth flagging: **OpenAerialMap was evaluated for hosting the drone ortho and rejected.** Uploads there become public CC-BY imagery. The overlay stays in private R2.

Map library: **Leaflet 1.9.x** (not MapLibre GL). Reasons: DistortableImage exists only for Leaflet, esri-leaflet handles both the Esri tiles and the NAIP ImageServer, raster satellite tiles get no benefit from a vector GL renderer, and Leaflet is lighter on old phones.

### 3.2 Stack

Resolved above in section 2: Cloudflare Workers + DO + D1 + R2, Vite + React SPA, PartyServer/partysocket for the room layer.

### 3.3 Auth

Recommendation: **family invite code, then pick yourself from the roster, then a long-lived server-minted device session. No passwords, no email round trips, no OAuth.**

How it works:

1. First visit: enter the family invite code (a long random string, also embeddable in an invite link so nobody types it). Server rate-limits attempts.
2. Pick your name from the roster (or an admin adds you first). The device receives a random session token (HTTP-only cookie plus localStorage fallback), stored server-side so individual devices can be revoked without rotating the family code.
3. That's it. The session lives for a year and refreshes on use. Rejoining a round is: tap the shared link, and if the device already has a session you are in; if not, pick your name and you are in.

Why not the alternatives, from research:

- **Magic links (Supabase or hand-rolled with Resend).** Supabase's built-in sender allows 2 auth emails per hour project-wide, which dies the moment four family members join in the parking lot. Fixable with custom SMTP (Resend free tier: 3,000/month, 100/day) but still adds an email round trip on exactly the flaky WiFi this app must tolerate. Rejected as the primary flow.
- **Google sign-in.** Publishing with basic scopes avoids verification, but OAuth is blocked inside in-app browsers (`disallowed_useragent`), and round links shared in a group chat will very often open in exactly those WebViews. Rejected for v1; possible later upgrade if impersonation ever becomes a real problem.
- Known tradeoff of the invite-code model, accepted deliberately for a trusted group: anyone with the code can claim any name. Score attribution (section 4) makes mischief visible rather than impossible.

Admins are roster players with `is_admin = true`. Admin-only surfaces: edit mode, publishing, roster management, overlay upload, unlocking completed rounds, device revocation.

### 3.4 Reconnect merge, not full offline-first

Recommendation: **hand-rolled IndexedDB outbox (via the `idb` library, ~1.2 kB) + partysocket + explicit resync triggers. No CRDT, no local-first framework, no Background Sync API.**

Research findings that shaped this:

- **Background Sync API is still unsupported on Safari/iOS and Firefox in 2026** ([caniuse](https://caniuse.com/background-sync)). For an iPhone-heavy family it is dead weight. The replacement triggers that actually fire: `online` event, `visibilitychange` to visible, `pageshow`, app start, and a backoff timer.
- **iOS suspends the page on screen lock and kills the WebSocket without firing `close`.** Outdoors this happens constantly. Rule: on every resume (`visibilitychange` to visible), assume the socket is dead: force reconnect, flush the outbox, refetch the round snapshot.
- **Storage safety on iOS:** IndexedDB survives process kill. WebKit's 7-day eviction still exists, but an installed home-screen PWA gets its own days-of-use counter, and `navigator.storage.persist()` (supported since iOS 17) further protects it. We call `persist()` on first run and the README tells the family to Add to Home Screen.
- **Every light local-first library was evaluated and rejected:** Replicache was archived June 2026; Zero 1.0 requires running zero-cache plus Postgres; PowerSync is a hosted service; ElectricSQL only syncs the read path; TinyBase's Durable Object sync module is the closest fit but rides on its CRDT-ish MergeableStore, which the brief explicitly excludes. The hand-rolled outbox is roughly 100 to 150 lines and is genuinely the least code.

Full sync semantics are specified in section 4, and the UI states in section 4c.

---

## 4. Sync design (the load-bearing part)

### 4a. Data flow

Every score entry, online or not, becomes an **event**:

```
{ clientWriteId: uuid,          // idempotency key, generated at tap time
  roundId, playerId, holeNumber,
  action: 'set' | 'clear',      // clear is an explicit user action, never implicit
  strokes: int | null,          // null only valid with action 'clear'
  authorPlayerId,               // who entered it (self-entry vs scorekeeper)
  enteredAt }                   // skew-corrected entry timestamp (see 4b)
```

The client applies the event optimistically to its local state, writes it to the IndexedDB outbox, and attempts to send over the socket. The outbox coalesces: a newer event for the same cell replaces the queued older one. An outbox entry is deleted only when the server acknowledges that `clientWriteId`.

The round DO processes events one at a time (single-threaded per room, so no races):

1. Dedupe on `clientWriteId` (replays are acked but not reapplied).
2. Validate: author is in the round (or admin); `strokes` null requires `action = 'clear'`; round not finalized (unless admin).
3. Last-write-wins per cell by ordering timestamp (4b). A losing event is still logged, but the cell keeps the winning value.
4. Append to the event log (DO SQLite, then write-through to D1), update the materialized cell, broadcast the new cell state plus ack to all sockets.

On join or rejoin, a client receives a full snapshot of the round (all cells with their timestamps and authors), then live deltas. Snapshots flow server to client only; **a client never pushes whole-round state in any direction.** The only thing a reconnecting client uploads is its outbox, which by construction contains only cells that device actually changed.

### 4b. Ordering and clock skew

Server receipt time is wrong for the offline case (a queued write from 2:05 would beat a deliberate online correction made at 2:30 just because it arrived at 3:00). Raw device clocks are forbidden by the brief. So:

- While connected, the client continuously estimates its clock offset against the server (standard ping halving, refreshed on every connect).
- `enteredAt` = device clock at tap time + last known offset. A device must have connected at least once to be in a round at all, so an offset always exists.
- The server clamps `enteredAt` to at most its own current time (no future-dated wins) and resolves LWW on it, tie-breaking deterministically on `clientWriteId`.

Result: whichever human touched the cell most recently wins, regardless of when the packet arrived. Two people editing the same cell get silent last-write-wins, no dialogs, per the brief.

### 4c. UI states

- Cell entered on this device, not yet acked: value shows normally with a small pending dot. No spinners, no blocking.
- Disconnected: a single quiet pill ("Offline, 4 scores queued"). Scoring continues untouched. No error banners, no red. Brief dropouts on the outer holes should be invisible unless you look for the pill.
- Reconnected and flushed: pill fades out. No celebration needed.
- Cell entered by someone other than the player: small attribution marker; tapping the cell shows "entered by Dad, 3:42pm".
- Round state survives refresh: local round state and outbox live in IndexedDB, so a page reload mid-round rehydrates instantly and re-syncs.

### 4d. The reconnect tests (committed in Phase 3, per the brief)

Integration tests against the real DO class via `vitest-pool-workers`:

1. **The hole-3 scenario.** Device A goes offline at hole 3, scores holes 3 through 9 locally. Devices B and C keep scoring online, including entering scores for player A on holes B touched. A reconnects. Assert: every cell equals the latest human entry by skew-corrected time; nothing A queued is lost; nothing B or C entered is clobbered by A's replay; cells A never touched are untouched by A's reconnect.
2. **Null never overwrites.** A stale client replays a cell with `strokes: null` without `action: 'clear'`: rejected. A blank cell in a client's local state generates no event at all. An explicit clear beats an older set, and an older clear loses to a newer set.
3. **Idempotent replay.** The same outbox flushed twice (ack lost mid-flush) produces identical state.
4. **Clock skew.** A device with a clock 40 minutes fast does not win future-dated LWW battles after clamping; one 40 minutes slow still orders correctly via offset correction.
5. **Coalescing.** Ten rapid edits to one cell offline produce one queued event and one final value.

---

## 5. Data model

D1 is canonical for everything except live rounds, where the round DO's SQLite is authoritative until completion (write-through keeps D1 close behind). All ids are short random strings generated server-side.

```
courses            id, name, created_at
                   One row in v1 (Crossbow Ranch). Exists so multi-course later
                   is an insert, not a migration.

layouts            id, course_id -> courses, status ('draft' | 'published'),
                   version_number (null while draft), name, notes,
                   published_at, published_by -> players
                   Published rows are IMMUTABLE. Exactly one draft per course.
                   Publish = snapshot the draft into a new published row with
                   the next version_number. Append-only; nothing is ever
                   updated or deleted after publish.

layout_holes       id, layout_id -> layouts, hole_number, name, par (default 3),
                   tee_lat, tee_lng, pin_lat, pin_lng,
                   distance_yards (computed and frozen at publish),
                   notes, photo_key (R2), sort_order
                   Rows belonging to published layouts are immutable.

players            id, name, is_admin, created_at
                   The roster. Doubles as identity.

sessions           token_hash, player_id -> players (null until claimed),
                   created_at, last_seen_at, revoked_at
                   Device sessions; per-device revocation without rotating
                   the family code.

rounds             id, layout_id -> layouts  (permanent, never changes),
                   played_on (date), created_by -> players,
                   join_code (short, unique among active rounds),
                   status ('active' | 'final'), completed_at, completed_by

round_players      round_id -> rounds, player_id -> players, joined_at, sort_order
                   1 to 6 players enforced at the API layer.

score_events       id, round_id, player_id, hole_number,
                   action ('set' | 'clear'), strokes (null only for clear),
                   author_player_id -> players, device_id,
                   client_write_id (UNIQUE: idempotent replay),
                   entered_at (skew-corrected, ordering key),
                   server_received_at (forensics only), applied (bool: LWW winner?)
                   APPEND-ONLY. Never deleted, including on layout publish and
                   round lock. This is the audit trail and the future handicap
                   data source.

scores             (round_id, player_id, hole_number) PK,
                   strokes (nullable), entered_at, author_player_id, client_write_id
                   Materialized latest cell, rebuilt from score_events if ever
                   in doubt. Attribution renders when author_player_id != player_id.

overlays           id, course_id -> courses, name, image_key (R2),
                   nw_lat, nw_lng, ne_lat, ne_lng, se_lat, se_lng, sw_lat, sw_lng,
                   opacity, is_active, created_at
                   Corner coordinates make the drone overlay reproducible.
```

**The layout-versioning boundary, explicitly:** `rounds.layout_id` is written once at round creation and never changes. Publishing a new layout only inserts rows (`layouts`, `layout_holes`); it touches nothing historical. Leaderboards are `GROUP BY rounds.layout_id`. The all-time view queries across layout_ids and is labeled as spanning multiple layouts. Yardage and par for a historical round always come from its own layout version, so a hole that moved last month cannot rewrite what par was in March. Deleting scores is impossible through any code path; even explicit cell clears are events in the log.

Derived, not stored: leaderboards (best round, average, rounds played per player per layout), hole difficulty (average vs par per hole per layout), records (low round, most birdies), and the ace log (`strokes = 1` joined to layout_holes and rounds for player, hole, date, layout version). All are queries over completed rounds; no denormalized stats tables until a real performance problem appears, which at 15 users is never.

Future considerations kept unblocked: multi-course (courses table already keyed everywhere it matters), handicaps (full per-hole event history retained forever), other formats (rounds are just containers of per-hole events; a format column can be added to rounds without touching scores).

## 6. Screen inventory

1. **Gate.** Family invite code entry, then pick-yourself roster claim. Only ever seen once per device.
2. **Home.** Current layout name and hole count, map preview, Start Round button, prominent "round in progress, join" banner when one is live, links to leaderboards and records.
3. **Course map.** Satellite basemap, per-hole tee marker, pin marker, connecting line, hole number chips. Tap a hole for a bottom sheet: number, name, yardage, par, notes, photo. Layer switcher (Esri / NAIP / overlay on-off / any keyed extras). Attribution line.
4. **Edit mode** (admin). Same map with draggable tee and pin markers, yardage recalculating live during drag, hole list with add, remove, and drag-to-reorder, per-hole form (number, name, par, notes, photo upload), persistent "editing draft" banner, Publish flow (confirm dialog: version name, auto-assigned version number, what changes).
5. **Layout history** (admin-visible, read-only for all). Version list with names, dates, hole counts, publisher.
6. **New round.** Date (defaults today), player multi-select from roster, inline add-new-player, start button. Result screen: big join code and share link with native share sheet.
7. **Join round.** Opened from link or code entry: pick which roster player you are (players already claimed by another device are marked), then straight to scoring.
8. **Scoring, one hole per screen.** The screen the app exists for. Hole number, par, and yardage header; giant per-player stroke steppers (one-thumb reachable, tap targets 64px+); own row pinned first and largest; running total vs par for self and group always visible in a sticky bar; pending-sync dots; attribution markers; swipe or arrow navigation between holes; offline pill when disconnected. Self-entry and scorekeeper modes are not modes at all: everyone can edit anyone, the UI just defaults focus to your own row.
9. **Full scorecard grid.** All players by all holes, totals and vs-par, tap any cell to edit (jumps to that hole's entry screen). Complete Round button with confirm.
10. **Round summary.** Final card, winner, notable stats (birdies, aces), share. Locked badge; admins see an unlock control.
11. **Leaderboards.** Layout version picker defaulting to current published layout. Best round, scoring average, rounds played per player. Hole-by-hole stats: per-player average by hole, hardest and easiest holes. All-time tab visually labeled "spans multiple course layouts".
12. **Records.** Low round (per layout and all-time, labeled), most birdies, ace log (player, hole, date, layout version).
13. **Player profile.** Round history with per-round vs-par, trend over time, personal bests.
14. **Admin settings.** Roster management (add, rename, admin flag), device/session revocation, family code rotation, overlay upload and 4-corner alignment screen, default basemap choice, unlock-round tool.

Design language (applies everywhere): mobile-first, high-contrast for direct sunlight (near-black on near-white, WCAG AAA where possible, no gray-on-gray), large type, minimal chrome, no dashboard-template look. No em dashes in any user-facing copy (recorded here as a copy rule for all UI text).

## 7. Phased build order

Each phase ends with a working deploy, a summary of what changed, and what to test by hand.

**Phase 0: Skeleton that proves the platform.**
Repo hygiene first (`.gitignore` before any commit: env files, `.dev.vars`, build output, uploads, seeds with real coordinates). Vite + React + TS scaffold, single Worker with static assets, deployed to a workers.dev URL. Leaflet map with Esri World Imagery, center and bounds from server config (fails with a readable full-screen message when unset, never a silent ocean). `fitBounds` on the configured box rather than trusting fixed zoom. Layer switcher with the NAIP ImageServer layer, including the CORS check that decides whether NAIP stays. Haversine utility with unit tests, including the latitude-band sanity check from the brief (100 yards is about 0.00082 degrees of latitude and about 0.00097 degrees of longitude at latitude 32; test uses synthetic coordinates on that parallel, not the real property). PWA manifest and service worker shell (app-shell precache only). README with setup steps.

**Phase 1: Course editor and layout versioning.**
D1 schema and migrations for courses, layouts, layout_holes, players, sessions. Auth gate (invite code, roster claim, sessions). Course map view with tee/pin/line rendering and hole bottom sheets. Admin edit mode: draggable markers with live yardage, hole CRUD and reorder, per-hole fields, photo upload to R2. Draft-then-publish flow producing immutable versions. Layout history screen. Gitignored seed script for the real course data.

**Phase 2: Rounds and live scoring, online path.**
Round DO with PartyServer, join codes and share links, join flow, the hole-by-hole scoring screen, full scorecard grid, LWW cell semantics with server-side validation and attribution, running totals, round completion and lock, admin unlock. Multi-phone manual test protocol documented. This phase is built online-only on purpose; the outbox comes next and layers on top, per the brief's "build the online path first".

**Phase 3: Reconnect resilience.**
IndexedDB outbox with coalescing and ack-based deletion, resync triggers (`online`, `visibilitychange`, `pageshow`, startup, backoff timer), forced socket teardown and snapshot refetch on resume, clock-offset estimation, offline pill and pending dots, `navigator.storage.persist()`. The full test suite from section 4d, especially the hole-3 scenario.

**Phase 4: Leaderboards, records, profiles.**
Per-layout leaderboards with version picker, hole difficulty stats, all-time view with multi-layout labeling, records board, ace log, player profiles with trends.

**Phase 5: Drone overlay (v1 scope, not deferred).**
Overlay upload to R2, 4-corner drag alignment over the reference basemap (DistortableImage, with the fallback chain from section 3.1), persisted corners, opacity control, overlay entry in the layer switcher.

**Phase 6: Polish and hardening.**
PWA install flow and icons, sunlight contrast pass on real phones outdoors, empty states, error copy review (no em dashes), performance pass on mid-tier Android, final README, backup/export note (D1 Time Travel plus a manual export script).

## 8. Repo hygiene and privacy review

Flagged per the brief: **where this stack would push identifying data into the repo by default, and what we do instead.**

- **Wrangler config is the main leak vector.** `wrangler.jsonc` conventionally holds `[vars]` in plaintext and is committed. Rule: property coordinates never go in `[vars]`. They are set as Wrangler secrets in production and in gitignored `.dev.vars` locally, and the committed `wrangler.jsonc` carries only non-identifying config (bindings, compat date).
- **Vite bakes `VITE_`-prefixed env vars into the public JS bundle**, and Workers static assets are served unauthenticated. So the coordinates are not build-time env at all: the Worker serves them from a session-gated `/api/config` endpoint, and the map initializes after auth. Nothing identifying ships in the static bundle.
- **Seeds and fixtures.** The real course seed script is gitignored by pattern (`seeds/*.real.*`). Committed tests and examples use synthetic coordinates on latitude 32 or obviously fake values, never the property.
- **`.env.example` / `.dev.vars.example`** ship with clearly fake placeholders far from Texas (equator-adjacent nonsense values) plus a comment saying so.
- **Imagery and photos** live in R2 only. `.gitignore` covers common image extensions in an `uploads/` path as a belt-and-suspenders measure. The drone overlay is never committed and never leaves private storage (OpenAerialMap explicitly rejected for making uploads public).
- **D1 database itself** is remote; local dev uses Wrangler's local D1 state directory, which is gitignored.
- **PLAN.md and README** describe the location only as rural central Texas. This file contains no coordinates by design.

## 9. Explicit non-goals for v1 (recorded)

Handicaps, multi-course support, match play and other formats, weather, GPS shot tracking, club recommendations. All noted as future considerations. The schema decisions that keep the first two cheap later: a courses table from day one, and a permanent append-only per-hole event log (handicap math needs exactly that history).

---

*Awaiting approval. On sign-off, implementation starts at Phase 0 in the order above, with a summary and manual test list at the end of each phase.*
