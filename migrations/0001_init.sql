-- Crossbow Ranch Pitch 'n Putt: full schema.
-- Layout versioning boundary: rounds.layout_id is written once and never
-- changes; published layouts and their holes are immutable; score history
-- is append-only. Publishing only ever INSERTs.

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE layouts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  version_number INTEGER,
  name TEXT,
  notes TEXT,
  published_at INTEGER,
  published_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_layouts_version
  ON layouts(course_id, version_number) WHERE version_number IS NOT NULL;
CREATE UNIQUE INDEX idx_layouts_one_draft
  ON layouts(course_id) WHERE status = 'draft';

CREATE TABLE layout_holes (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  hole_number INTEGER NOT NULL,
  name TEXT,
  par INTEGER NOT NULL DEFAULT 3,
  tee_lat REAL,
  tee_lng REAL,
  pin_lat REAL,
  pin_lng REAL,
  distance_yards INTEGER,
  notes TEXT,
  photo_key TEXT,
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_layout_holes_layout ON layout_holes(layout_id, sort_order);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_players_name ON players(name COLLATE NOCASE);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  played_on TEXT NOT NULL,
  created_by TEXT,
  join_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'final')),
  completed_at INTEGER,
  completed_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_rounds_join_code_active
  ON rounds(join_code) WHERE status = 'active';

CREATE TABLE round_players (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  joined_at INTEGER,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id)
);

-- Append-only audit log and sync source of truth. Never UPDATEd or DELETEd.
CREATE TABLE score_events (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('set', 'clear')),
  strokes INTEGER,
  author_player_id TEXT NOT NULL,
  device_id TEXT,
  client_write_id TEXT NOT NULL UNIQUE,
  entered_at INTEGER NOT NULL,
  server_received_at INTEGER NOT NULL,
  applied INTEGER NOT NULL
);
CREATE INDEX idx_score_events_round ON score_events(round_id);

-- Materialized latest cell per (round, player, hole).
CREATE TABLE scores (
  round_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  strokes INTEGER,
  entered_at INTEGER NOT NULL,
  author_player_id TEXT,
  client_write_id TEXT,
  PRIMARY KEY (round_id, player_id, hole_number)
);

CREATE TABLE overlays (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  name TEXT,
  image_key TEXT NOT NULL,
  nw_lat REAL, nw_lng REAL,
  ne_lat REAL, ne_lng REAL,
  se_lat REAL, se_lng REAL,
  sw_lat REAL, sw_lng REAL,
  opacity REAL NOT NULL DEFAULT 0.9,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
