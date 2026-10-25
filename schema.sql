-- ============================================================================
-- INTVL 2.0 // Multiplayer Rounds & Spatial Territory Conquest Schema (D1)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Users / Athletes Table
-- `username` is strictly used for login/authentication; `display_name` is the public in-game name.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  strava_athlete_id INTEGER UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  color_hex TEXT NOT NULL DEFAULT '#00f0ff',
  home_lat REAL,
  home_lng REAL,
  home_zoom INTEGER DEFAULT 14,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_strava_athlete_id ON users(strava_athlete_id);
CREATE INDEX IF NOT EXISTS idx_users_color_hex ON users(color_hex);

-- 2. Rounds / Seasons Table
-- `created_by` permanently designates the Round Admin.
-- `ends_at` defines an optional hard expiration timestamp after which new activities are locked.
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  created_by TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME,
  ended_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);
CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds(created_at DESC);

-- 3. Round Participants Table (tracks which registered players participate in each round)
CREATE TABLE IF NOT EXISTS round_participants (
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (round_id, user_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_round_participants_user_id ON round_participants(user_id);

-- 4. Imported GPS Activities Table (permanently stores route_geojson, h3_indices_json & telemetry)
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, -- Composite `${round_id}:${strava_activity_id}`
  strava_activity_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sport_type TEXT NOT NULL DEFAULT 'Run',
  distance_meters REAL NOT NULL DEFAULT 0,
  moving_time_seconds INTEGER NOT NULL DEFAULT 0,
  capture_mode TEXT NOT NULL DEFAULT 'loop', -- 'loop' | 'corridor'
  cells_captured INTEGER NOT NULL DEFAULT 0,
  cells_stolen INTEGER NOT NULL DEFAULT 0,
  area_km2 REAL NOT NULL DEFAULT 0,
  route_geojson TEXT NOT NULL,
  h3_indices_json TEXT NOT NULL DEFAULT '[]',
  start_lat REAL,
  start_lng REAL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_round_id ON activities(round_id);
CREATE INDEX IF NOT EXISTS idx_activities_strava_id ON activities(strava_activity_id);
CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities(started_at DESC);

-- 5. Round-Isolated H3 Resolution 9 Territories Table
CREATE TABLE IF NOT EXISTS territories (
  round_id TEXT NOT NULL,
  h3_index TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (round_id, h3_index),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_territories_round_id ON territories(round_id);
CREATE INDEX IF NOT EXISTS idx_territories_owner_id ON territories(round_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_territories_activity_id ON territories(activity_id);
CREATE INDEX IF NOT EXISTS idx_territories_captured_at ON territories(captured_at DESC);
