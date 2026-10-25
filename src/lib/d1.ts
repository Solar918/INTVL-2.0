import type { D1Database } from '@cloudflare/workers-types';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';
import {
  processActivityCoordinates,
  calculateH3CellsAreaKm2,
  type CaptureMode,
  type TerritoryFeatureProperties,
} from './geo';
import { AUCKLAND_DEFAULT_CENTER, normalizePlayerColor } from './utils';

export interface RoundParticipantSummary {
  userId: string;
  username: string;
  displayName: string;
  colorHex: string;
}

export interface RoundSummary {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  createdBy: string | null;
  adminDisplayName: string | null;
  startedAt: string;
  endsAt: string | null;
  endedAt: string | null;
  isConcluded: boolean;
  createdAt: string;
  participantIds: string[];
  participants: RoundParticipantSummary[];
  totalCellsClaimed: number;
  totalActivitiesCount: number;
}

export const ROUND_CONCLUDED_ERROR_MESSAGE =
  'This round has concluded. New activities cannot be added unless extended by the round admin.';

export interface DeleteActivityRollbackResult {
  deletedActivityId: string;
  deletedActivityName: string;
  roundId: string;
  cellsAffected: number;
  cellsReverted: number;
  cellsCleared: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  color: string;
  stravaConnected: boolean;
  stravaAthleteId: number | null;
  activeCells: number;
  activeAreaKm2: number;
  dominancePercent: number;
  totalDistanceKm: number;
  activitiesCount: number;
  totalCellsStolen: number;
  lastActiveAt: string | null;
}

export interface ActivityFeedItem {
  id: string;
  stravaActivityId: string;
  roundId: string;
  roundName?: string;
  userId: string;
  username: string;
  displayName: string;
  userColor: string;
  name: string;
  sportType: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  captureMode: CaptureMode;
  cellsCaptured: number;
  cellsStolen: number;
  cellsStillHeld?: number;
  areaKm2: number;
  routeGeojson: string;
  startLat: number | null;
  startLng: number | null;
  startedAt: string;
  processedAt: string;
}

export interface UserProfileData {
  user: {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    colorHex: string;
    stravaConnected: boolean;
    stravaAthleteId: number | null;
    createdAt: string;
  };
  stats: {
    totalDistanceMeters: number;
    totalMovingTimeSeconds: number;
    totalLoopsCompleted: number;
    totalActivitiesCount: number;
    totalCellsCapturedEver: number;
    totalCellsStolenEver: number;
    totalAreaClaimedKm2: number;
    currentActiveCells: number;
  };
  activities: ActivityFeedItem[];
}

export interface IngestActivityInput {
  stravaActivityId: string;
  roundId: string;
  userId: string;
  name: string;
  sportType?: string;
  distanceMeters?: number;
  movingTimeSeconds?: number;
  startedAt?: string;
  latLngStream: [number, number][];
  requireClosedLoop?: boolean;
  forceLoop?: boolean;
  captureModeOverride?: CaptureMode;
}

export interface IngestActivityOutput {
  activityId: string;
  stravaActivityId: string;
  roundId: string;
  name: string;
  captureMode: CaptureMode;
  cellsCaptured: number;
  cellsStolen: number;
  cellsProtectedByChronology?: number;
  recordedAt?: string;
  areaKm2: number;
  distanceMeters: number;
  centroid: [number, number];
  alreadyProcessed: boolean;
}

const SCHEMA_SQL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_strava_athlete_id ON users(strava_athlete_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_color_hex ON users(color_hex)`,
  `CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME,
    ended_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status)`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS round_participants (
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (round_id, user_id),
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_round_participants_user_id ON round_participants(user_id)`,
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    strava_activity_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sport_type TEXT NOT NULL DEFAULT 'Run',
    distance_meters REAL NOT NULL DEFAULT 0,
    moving_time_seconds INTEGER NOT NULL DEFAULT 0,
    capture_mode TEXT NOT NULL DEFAULT 'loop',
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_round_id ON activities(round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_strava_id ON activities(strava_activity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS territories (
    round_id TEXT NOT NULL,
    h3_index TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (round_id, h3_index),
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_territories_round_id ON territories(round_id)`,
  `CREATE INDEX IF NOT EXISTS idx_territories_owner_id ON territories(round_id, owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_territories_activity_id ON territories(activity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_territories_captured_at ON territories(captured_at DESC)`,
];

let localD1Singleton: D1Database | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Creates a Cloudflare D1Database-compatible wrapper around `better-sqlite3` or `node:sqlite`
 * for local development when running outside of Cloudflare Wrangler.
 */
function createLocalSqliteD1Adapter(): D1Database | null {
  try {
    const evalRequire = eval('require') as NodeRequire;
    const dbPath = process.env.LOCAL_SQLITE_PATH || './.local-intvl2.sqlite';

    let runQuery: (
      sql: string,
      params: unknown[]
    ) => { changes: number; lastInsertRowid: number | bigint };
    let getQuery: (
      sql: string,
      params: unknown[]
    ) => Record<string, unknown> | undefined;
    let allQuery: (sql: string, params: unknown[]) => unknown[];
    let execSql: (sql: string) => void;

    try {
      const BetterSqlite3 = evalRequire('better-sqlite3');
      const sqlite = new BetterSqlite3(dbPath);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      runQuery = (q, p) => sqlite.prepare(q).run(...p);
      getQuery = (q, p) =>
        sqlite.prepare(q).get(...p) as Record<string, unknown> | undefined;
      allQuery = (q, p) => sqlite.prepare(q).all(...p) as unknown[];
      execSql = (q) => sqlite.exec(q);
    } catch {
      const nodeSqlite = evalRequire('node:sqlite');
      const sqlite = new nodeSqlite.DatabaseSync(dbPath);
      sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      runQuery = (q, p) => sqlite.prepare(q).run(...p);
      getQuery = (q, p) =>
        sqlite.prepare(q).get(...p) as Record<string, unknown> | undefined;
      allQuery = (q, p) => sqlite.prepare(q).all(...p) as unknown[];
      execSql = (q) => sqlite.exec(q);
    }

    const createStatement = (query: string, boundValues: unknown[] = []) => {
      return {
        bind(...values: unknown[]) {
          return createStatement(query, values);
        },
        async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
          const row = getQuery(query, boundValues);
          if (!row) return null;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        },
        async run() {
          const info = runQuery(query, boundValues);
          return {
            success: true,
            meta: {
              duration: 0,
              changes: Number(info.changes ?? 0),
              last_row_id: Number(info.lastInsertRowid ?? 0),
              changed_db: Number(info.changes ?? 0) > 0,
              size_after: 0,
              rows_read: 0,
              rows_written: Number(info.changes ?? 0),
            },
            results: [],
          };
        },
        async all<T = Record<string, unknown>>() {
          const upper = query.trim().toUpperCase();
          const isSelect =
            upper.startsWith('SELECT') || upper.startsWith('PRAGMA');
          const rows = isSelect ? (allQuery(query, boundValues) as T[]) : [];
          if (!isSelect) {
            runQuery(query, boundValues);
          }
          return {
            success: true,
            meta: {
              duration: 0,
              changes: 0,
              last_row_id: 0,
              changed_db: false,
              size_after: 0,
              rows_read: rows.length,
              rows_written: 0,
            },
            results: rows,
          };
        },
        async raw<T = unknown[]>() {
          return allQuery(query, boundValues) as T[];
        },
      };
    };

    const adapter = {
      prepare(query: string) {
        return createStatement(query);
      },
      async batch(statements: Array<{ run: () => Promise<unknown> }>) {
        const results: unknown[] = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        return results;
      },
      async exec(query: string) {
        execSql(query);
        return { count: 1, duration: 0 };
      },
      async dump() {
        return new ArrayBuffer(0);
      },
    };

    return adapter as unknown as D1Database;
  } catch (err) {
    console.error('[INTVL 2.0 Local SQLite Init Error]:', err);
    return null;
  }
}

/**
 * Resolves the active Cloudflare D1 database binding from:
 * 1. `@cloudflare/next-on-pages` request context (`getRequestContext().env.DB`)
 * 2. Global / `process.env.DB` binding
 * 3. Local SQLite D1 adapter fallback
 */
export async function getD1Database(): Promise<D1Database> {
  try {
    const nextOnPages = await import('@cloudflare/next-on-pages');
    const ctx = nextOnPages.getRequestContext?.();
    if (ctx?.env && (ctx.env as CloudflareEnv).DB) {
      const db = (ctx.env as CloudflareEnv).DB;
      await ensureDatabaseReady(db);
      return db;
    }
  } catch {
    // Running outside @cloudflare/next-on-pages request context
  }

  const globalDb =
    (process.env.DB as unknown as D1Database | undefined) ||
    ((globalThis as unknown as { DB?: D1Database }).DB ?? undefined);

  if (globalDb && typeof globalDb.prepare === 'function') {
    await ensureDatabaseReady(globalDb);
    return globalDb;
  }

  if (!localD1Singleton) {
    localD1Singleton = createLocalSqliteD1Adapter();
  }

  if (localD1Singleton) {
    await ensureDatabaseReady(localD1Singleton);
    return localD1Singleton;
  }

  throw new Error('Cloudflare D1 binding (DB) not found.');
}

/**
 * Returns a typed Drizzle ORM instance bound to the active D1 database.
 */
export async function getDrizzleDb(): Promise<DrizzleD1Database<typeof schema>> {
  const d1 = await getD1Database();
  return drizzle(d1, { schema });
}

/**
 * Ensures production schema tables exist, non-destructively migrates `users` if needed,
 * and initializes the default Round 1 if no rounds exist yet.
 */
async function ensureDatabaseReady(db: D1Database): Promise<void> {
  if (isInitialized) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      // 1. Check if `users` table exists and needs `display_name` / `bio` columns added
      try {
        const userColsRes = await db
          .prepare('PRAGMA table_info(users)')
          .all<{ name: string }>();
        const userCols = (userColsRes.results ?? []).map((c) => c.name);
        if (userCols.length > 0) {
          if (!userCols.includes('password_hash')) {
            await db.prepare('DROP TABLE IF EXISTS territories').run();
            await db.prepare('DROP TABLE IF EXISTS activities').run();
            await db.prepare('DROP TABLE IF EXISTS users').run();
          } else {
            if (!userCols.includes('display_name')) {
              await db
                .prepare(
                  "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"
                )
                .run();
              await db
                .prepare(
                  "UPDATE users SET display_name = username WHERE display_name = ''"
                )
                .run();
            }
            if (!userCols.includes('bio')) {
              await db
                .prepare("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''")
                .run();
            }
            if (!userCols.includes('home_lat')) {
              await db.prepare('ALTER TABLE users ADD COLUMN home_lat REAL').run();
            }
            if (!userCols.includes('home_lng')) {
              await db.prepare('ALTER TABLE users ADD COLUMN home_lng REAL').run();
            }
            if (!userCols.includes('home_zoom')) {
              await db
                .prepare(
                  'ALTER TABLE users ADD COLUMN home_zoom INTEGER DEFAULT 14'
                )
                .run();
            }
          }
        }
      } catch {
        // Ignore if users table does not exist yet
      }

      // 2. Check if `territories` or `activities` lacks `round_id` from pre-rounds schema
      try {
        const terrColsRes = await db
          .prepare('PRAGMA table_info(territories)')
          .all<{ name: string }>();
        const terrCols = (terrColsRes.results ?? []).map((c) => c.name);
        if (terrCols.length > 0 && !terrCols.includes('round_id')) {
          await db.prepare('DROP TABLE IF EXISTS territories').run();
          await db.prepare('DROP TABLE IF EXISTS activities').run();
        }
      } catch {
        // Ignore if territories table does not exist yet
      }

      // 3. Create all schema tables and indexes
      for (const sql of SCHEMA_SQL_STATEMENTS) {
        await db.prepare(sql).run();
      }

      // 4. Non-destructively add `ends_at` to `rounds` and `h3_indices_json` to `activities` if missing
      try {
        const roundColsRes = await db
          .prepare('PRAGMA table_info(rounds)')
          .all<{ name: string }>();
        const roundCols = (roundColsRes.results ?? []).map((c) => c.name);
        if (roundCols.length > 0 && !roundCols.includes('ends_at')) {
          await db.prepare('ALTER TABLE rounds ADD COLUMN ends_at DATETIME').run();
        }
      } catch {
        // Ignore if rounds table inspection fails
      }

      try {
        const actColsRes = await db
          .prepare('PRAGMA table_info(activities)')
          .all<{ name: string }>();
        const actCols = (actColsRes.results ?? []).map((c) => c.name);
        if (actCols.length > 0 && !actCols.includes('h3_indices_json')) {
          await db
            .prepare(
              "ALTER TABLE activities ADD COLUMN h3_indices_json TEXT NOT NULL DEFAULT '[]'"
            )
            .run();
        }
      } catch {
        // Ignore if activities table inspection fails
      }

      // 5. Backfill any territories whose captured_at differed from their parent activity's physical started_at
      try {
        await db
          .prepare(
            `UPDATE territories
             SET captured_at = (
               SELECT a.started_at FROM activities a WHERE a.id = territories.activity_id
             )
             WHERE EXISTS (
               SELECT 1 FROM activities a
               WHERE a.id = territories.activity_id
                 AND a.started_at IS NOT NULL
                 AND a.started_at != territories.captured_at
             )`
          )
          .run();
      } catch {
        // Ignore if empty
      }

      // 6. Ensure at least one Round exists ("Round 1 — Auckland Central") and assign admin if needed
      await ensureDefaultRoundWithDb(db);
      isInitialized = true;
    } catch (err) {
      isInitialized = false;
      console.error('[INTVL 2.0 D1] Database initialization warning:', err);
    } finally {
      initPromise = null;
    }
  })();

  await initPromise;
}

async function ensureDefaultRoundWithDb(db: D1Database): Promise<string> {
  const existingRound = await db
    .prepare('SELECT id FROM rounds ORDER BY created_at DESC LIMIT 1')
    .first<{ id: string }>();

  const primaryUser = await db
    .prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1')
    .first<{ id: string }>();

  let roundId = existingRound?.id;
  if (!roundId) {
    roundId = 'round-1-auckland';
    await db
      .prepare(
        `INSERT OR IGNORE INTO rounds (id, name, description, status, created_by, started_at, created_at)
         VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(
        roundId,
        'Round 1 — Auckland Central',
        'Inaugural Auckland closed-loop territory conquest season.',
        primaryUser?.id ?? null
      )
      .run();
  }

  // Ensure any round without created_by has the founding user assigned as Admin
  if (primaryUser?.id) {
    await db
      .prepare('UPDATE rounds SET created_by = ? WHERE created_by IS NULL')
      .bind(primaryUser.id)
      .run();
  }

  // Ensure any existing users are enrolled in this default round if round_participants is empty
  const partCount = await db
    .prepare('SELECT COUNT(*) as cnt FROM round_participants WHERE round_id = ?')
    .bind(roundId)
    .first<{ cnt: number }>();

  if (Number(partCount?.cnt ?? 0) === 0) {
    const allUsers = await db
      .prepare('SELECT id FROM users')
      .all<{ id: string }>();
    for (const u of allUsers.results ?? []) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO round_participants (round_id, user_id) VALUES (?, ?)'
        )
        .bind(roundId, u.id)
        .run();
    }
  }

  return roundId;
}

// ============================================================================
// User & Profile Management
// ============================================================================

export async function createUser(params: {
  username: string;
  displayName?: string;
  bio?: string;
  passwordHash: string;
  colorHex: string;
}): Promise<schema.UserRecord> {
  const db = await getD1Database();
  const id = crypto.randomUUID();
  const normalizedUsername = params.username.trim().toLowerCase();
  const displayName = (params.displayName ?? '').trim() || normalizedUsername;
  const bio = (params.bio ?? '').trim();
  const normalizedColor = normalizePlayerColor(params.colorHex);

  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, bio, password_hash, color_hex, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(id, normalizedUsername, displayName, bio, params.passwordHash, normalizedColor)
    .run();

  // If any round lacks a created_by admin, assign this founding user as Admin
  await db
    .prepare('UPDATE rounds SET created_by = ? WHERE created_by IS NULL')
    .bind(id)
    .run();

  // Auto-enroll new user in the current active round
  const activeRound = await getActiveOrSpecifiedRound();
  if (activeRound) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO round_participants (round_id, user_id) VALUES (?, ?)'
      )
      .bind(activeRound.id, id)
      .run();
  }

  const row = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) {
    throw new Error('Failed to retrieve newly created user record.');
  }

  return mapRowToUserRecord(row);
}

export async function getUserByUsername(
  username: string
): Promise<schema.UserRecord | null> {
  const db = await getD1Database();
  const normalized = username.trim().toLowerCase();
  const row = await db
    .prepare('SELECT * FROM users WHERE username = ?')
    .bind(normalized)
    .first<Record<string, unknown>>();

  return row ? mapRowToUserRecord(row) : null;
}

export async function getUserById(
  userId: string
): Promise<schema.UserRecord | null> {
  const db = await getD1Database();
  const row = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<Record<string, unknown>>();

  return row ? mapRowToUserRecord(row) : null;
}

export async function getUserByStravaAthleteId(
  stravaAthleteId: number
): Promise<schema.UserRecord | null> {
  const db = await getD1Database();
  const row = await db
    .prepare('SELECT * FROM users WHERE strava_athlete_id = ?')
    .bind(stravaAthleteId)
    .first<Record<string, unknown>>();

  return row ? mapRowToUserRecord(row) : null;
}

export async function getAllRegisteredUsers(): Promise<
  Array<{
    id: string;
    username: string;
    displayName: string;
    bio: string;
    colorHex: string;
    stravaConnected: boolean;
    createdAt: string;
  }>
> {
  const db = await getD1Database();
  const res = await db
    .prepare(
      'SELECT id, username, display_name, bio, color_hex, strava_athlete_id, refresh_token, created_at FROM users ORDER BY created_at ASC'
    )
    .all<Record<string, unknown>>();

  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    username: String(r.username ?? ''),
    displayName: String(r.display_name || r.username || 'Player'),
    bio: String(r.bio ?? ''),
    colorHex: String(r.color_hex ?? '#00f0ff'),
    stravaConnected: Boolean(r.strava_athlete_id && r.refresh_token),
    createdAt: String(r.created_at ?? ''),
  }));
}

export async function linkStravaAccountToUser(params: {
  userId: string;
  stravaAthleteId: number;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
}): Promise<schema.UserRecord> {
  const db = await getD1Database();

  await db
    .prepare(
      `UPDATE users
       SET strava_athlete_id = NULL, access_token = NULL, refresh_token = NULL, token_expires_at = NULL
       WHERE strava_athlete_id = ? AND id != ?`
    )
    .bind(params.stravaAthleteId, params.userId)
    .run();

  await db
    .prepare(
      `UPDATE users
       SET strava_athlete_id = ?, access_token = ?, refresh_token = ?, token_expires_at = ?
       WHERE id = ?`
    )
    .bind(
      params.stravaAthleteId,
      params.accessToken,
      params.refreshToken,
      params.tokenExpiresAt,
      params.userId
    )
    .run();

  const updated = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(params.userId)
    .first<Record<string, unknown>>();

  if (!updated) {
    throw new Error('User record not found while linking Strava account.');
  }

  return mapRowToUserRecord(updated);
}

/**
 * Clears stored Strava OAuth credentials from a user record so the athlete slot is freed.
 */
export async function unlinkStravaAccountFromUser(
  userId: string
): Promise<schema.UserRecord | null> {
  const db = await getD1Database();
  await db
    .prepare(
      `UPDATE users
       SET strava_athlete_id = NULL,
           access_token = NULL,
           refresh_token = NULL,
           token_expires_at = NULL
       WHERE id = ?`
    )
    .bind(userId)
    .run();

  return getUserById(userId);
}

export async function updateUserProfile(
  userId: string,
  updates: {
    displayName?: string;
    bio?: string;
    colorHex?: string;
    /** Pass null for lat/lng to clear the home area */
    homeLat?: number | null;
    homeLng?: number | null;
    homeZoom?: number | null;
  }
): Promise<schema.UserRecord | null> {
  const db = await getD1Database();
  const existing = await getUserById(userId);
  if (!existing) return null;

  const nextDisplayName =
    updates.displayName !== undefined
      ? updates.displayName.trim() || existing.displayName
      : existing.displayName;
  const nextBio =
    updates.bio !== undefined ? updates.bio.trim() : existing.bio;
  const nextColor =
    updates.colorHex !== undefined
      ? normalizePlayerColor(updates.colorHex)
      : existing.colorHex;
  const nextHomeLat =
    updates.homeLat !== undefined ? updates.homeLat : existing.homeLat ?? null;
  const nextHomeLng =
    updates.homeLng !== undefined ? updates.homeLng : existing.homeLng ?? null;
  const nextHomeZoom =
    updates.homeZoom !== undefined
      ? updates.homeZoom ?? 14
      : existing.homeZoom ?? 14;

  await db
    .prepare(
      'UPDATE users SET display_name = ?, bio = ?, color_hex = ?, home_lat = ?, home_lng = ?, home_zoom = ? WHERE id = ?'
    )
    .bind(
      nextDisplayName,
      nextBio,
      nextColor,
      nextHomeLat,
      nextHomeLng,
      nextHomeZoom,
      userId
    )
    .run();

  return getUserById(userId);
}

export async function updateAthleteColor(
  userId: string,
  colorHex: string
): Promise<schema.UserRecord | null> {
  return updateUserProfile(userId, { colorHex });
}

export async function updateUserTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: number
): Promise<void> {
  const db = await getD1Database();
  await db
    .prepare(
      `UPDATE users
       SET access_token = ?, refresh_token = ?, token_expires_at = ?
       WHERE id = ?`
    )
    .bind(accessToken, refreshToken, tokenExpiresAt, userId)
    .run();
}

// ============================================================================
// Multi-Round / Season Management
// ============================================================================

/**
 * Checks whether a round is locked from accepting new activities
 * (either archived manually or past its hard `endsAt` expiration timestamp).
 */
export function isRoundLockedForIngestion(round: {
  status: 'active' | 'archived';
  endsAt?: string | null;
}): boolean {
  if (round.status === 'archived') return true;
  if (round.endsAt) {
    const endsMs = parseUtcTimestampMs(round.endsAt);
    if (endsMs > 0 && Date.now() >= endsMs) {
      return true;
    }
  }
  return false;
}

export async function getAllRounds(): Promise<RoundSummary[]> {
  const db = await getD1Database();
  await ensureDefaultRoundWithDb(db);

  const roundsRes = await db
    .prepare(
      `SELECT r.*, u.display_name AS admin_display_name, u.username AS admin_username
       FROM rounds r
       LEFT JOIN users u ON u.id = r.created_by
       ORDER BY r.status ASC, r.created_at DESC`
    )
    .all<Record<string, unknown>>();

  const participantsRes = await db
    .prepare(
      `SELECT rp.round_id, u.id AS user_id, u.username, u.display_name, u.color_hex
       FROM round_participants rp
       INNER JOIN users u ON u.id = rp.user_id`
    )
    .all<Record<string, unknown>>();

  const cellCountsRes = await db
    .prepare(
      'SELECT round_id, COUNT(*) AS cell_count FROM territories GROUP BY round_id'
    )
    .all<{ round_id: string; cell_count: number }>();

  const actCountsRes = await db
    .prepare(
      'SELECT round_id, COUNT(*) AS act_count FROM activities GROUP BY round_id'
    )
    .all<{ round_id: string; act_count: number }>();

  const partsByRound = new Map<string, RoundParticipantSummary[]>();
  for (const row of participantsRes.results ?? []) {
    const rid = String(row.round_id);
    const list = partsByRound.get(rid) ?? [];
    list.push({
      userId: String(row.user_id),
      username: String(row.username ?? ''),
      displayName: String(row.display_name || row.username || 'Player'),
      colorHex: String(row.color_hex ?? '#00f0ff'),
    });
    partsByRound.set(rid, list);
  }

  const cellsByRound = new Map<string, number>();
  for (const row of cellCountsRes.results ?? []) {
    cellsByRound.set(String(row.round_id), Number(row.cell_count ?? 0));
  }

  const actsByRound = new Map<string, number>();
  for (const row of actCountsRes.results ?? []) {
    actsByRound.set(String(row.round_id), Number(row.act_count ?? 0));
  }

  return (roundsRes.results ?? []).map((r) => {
    const rid = String(r.id);
    const participants = partsByRound.get(rid) ?? [];
    const status = ((r.status as 'active' | 'archived') || 'active');
    const endsAt = r.ends_at ? String(r.ends_at) : null;
    const isConcluded = isRoundLockedForIngestion({ status, endsAt });
    return {
      id: rid,
      name: String(r.name ?? 'Auckland Round'),
      description: String(r.description ?? ''),
      status,
      createdBy: r.created_by ? String(r.created_by) : null,
      adminDisplayName: r.admin_display_name
        ? String(r.admin_display_name)
        : r.admin_username
          ? String(r.admin_username)
          : null,
      startedAt: String(r.started_at ?? ''),
      endsAt,
      endedAt: r.ended_at ? String(r.ended_at) : null,
      isConcluded,
      createdAt: String(r.created_at ?? ''),
      participantIds: participants.map((p) => p.userId),
      participants,
      totalCellsClaimed: cellsByRound.get(rid) ?? 0,
      totalActivitiesCount: actsByRound.get(rid) ?? 0,
    };
  });
}

export async function getActiveOrSpecifiedRound(
  roundId?: string | null
): Promise<RoundSummary> {
  const allRounds = await getAllRounds();
  if (roundId) {
    const found = allRounds.find((r) => r.id === roundId);
    if (found) return found;
  }
  const active = allRounds.find((r) => r.status === 'active');
  return active ?? allRounds[0];
}

export async function createRound(params: {
  name: string;
  description?: string;
  createdBy?: string | null;
  participantUserIds: string[];
  endsAt?: string | null;
  setAsActive?: boolean;
}): Promise<RoundSummary> {
  const db = await getD1Database();
  const id = `round-${crypto.randomUUID().slice(0, 8)}`;

  if (params.setAsActive !== false) {
    await db
      .prepare(
        "UPDATE rounds SET status = 'archived', ended_at = CURRENT_TIMESTAMP WHERE status = 'active'"
      )
      .run();
  }

  const normalizedEndsAt =
    params.endsAt && params.endsAt.trim()
      ? normalizeUtcSqlTimestamp(params.endsAt)
      : null;

  await db
    .prepare(
      `INSERT INTO rounds (id, name, description, status, created_by, started_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      id,
      params.name.trim(),
      (params.description ?? '').trim(),
      params.setAsActive !== false ? 'active' : 'archived',
      params.createdBy ?? null,
      normalizedEndsAt
    )
    .run();

  const mergedIds = params.createdBy
    ? [...params.participantUserIds, params.createdBy]
    : params.participantUserIds;
  const uniqueUserIds = Array.from(new Set(mergedIds));
  for (const uid of uniqueUserIds) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO round_participants (round_id, user_id) VALUES (?, ?)'
      )
      .bind(id, uid)
      .run();
  }

  return getActiveOrSpecifiedRound(id);
}

export async function updateRound(params: {
  roundId: string;
  name?: string;
  description?: string;
  status?: 'active' | 'archived';
  endsAt?: string | null;
  participantUserIds?: string[];
}): Promise<RoundSummary> {
  const db = await getD1Database();
  const current = await getActiveOrSpecifiedRound(params.roundId);

  const nextName =
    params.name !== undefined ? params.name.trim() || current.name : current.name;
  const nextDesc =
    params.description !== undefined
      ? params.description.trim()
      : current.description;
  const nextStatus = params.status ?? current.status;
  const nextEndsAt =
    params.endsAt !== undefined
      ? params.endsAt && params.endsAt.trim()
        ? normalizeUtcSqlTimestamp(params.endsAt)
        : null
      : current.endsAt;

  if (nextStatus === 'active' && current.status !== 'active') {
    await db
      .prepare(
        "UPDATE rounds SET status = 'archived', ended_at = CURRENT_TIMESTAMP WHERE status = 'active' AND id != ?"
      )
      .bind(params.roundId)
      .run();
  }

  await db
    .prepare(
      `UPDATE rounds
       SET name = ?, description = ?, status = ?, ends_at = ?,
           ended_at = CASE WHEN ? = 'archived' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`
    )
    .bind(nextName, nextDesc, nextStatus, nextEndsAt, nextStatus, params.roundId)
    .run();

  if (params.participantUserIds) {
    await db
      .prepare('DELETE FROM round_participants WHERE round_id = ?')
      .bind(params.roundId)
      .run();

    const uniqueIds = Array.from(new Set(params.participantUserIds));
    for (const uid of uniqueIds) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO round_participants (round_id, user_id) VALUES (?, ?)'
        )
        .bind(params.roundId, uid)
        .run();
    }
  }

  return getActiveOrSpecifiedRound(params.roundId);
}

// ============================================================================
// Territory Capture, Steal & Round-Isolated Queries
// ============================================================================

export async function getImportedStravaActivityIdsForRound(
  roundId: string,
  stravaActivityIds: string[]
): Promise<Set<string>> {
  if (stravaActivityIds.length === 0) return new Set();
  const db = await getD1Database();
  const placeholders = stravaActivityIds.map(() => '?').join(', ');
  const res = await db
    .prepare(
      `SELECT strava_activity_id FROM activities WHERE round_id = ? AND strava_activity_id IN (${placeholders})`
    )
    .bind(roundId, ...stravaActivityIds)
    .all<{ strava_activity_id: string }>();

  return new Set((res.results ?? []).map((r) => String(r.strava_activity_id)));
}

/**
 * Normalizes any ISO-8601 or SQLite datetime string to UTC `YYYY-MM-DD HH:MM:SS`
 * so SQLite `datetime()` and lexicographical comparisons are deterministic.
 */
export function normalizeUtcSqlTimestamp(raw?: string | null): string {
  if (!raw || !raw.trim()) {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  const trimmed = raw.trim();
  const isoCandidate = trimmed.includes('T')
    ? trimmed
    : `${trimmed.replace(' ', 'T')}${trimmed.endsWith('Z') ? '' : 'Z'}`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Parses a UTC SQLite or ISO-8601 timestamp string into epoch milliseconds.
 */
export function parseUtcTimestampMs(raw?: string | null): number {
  if (!raw || !raw.trim()) return 0;
  const trimmed = raw.trim();
  const isoCandidate = trimmed.includes('T')
    ? trimmed
    : `${trimmed.replace(' ', 'T')}${trimmed.endsWith('Z') ? '' : 'Z'}`;
  const ms = Date.parse(isoCandidate);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Core Territory Capture & Chronological Steal Transaction (Isolated per Round):
 * 1. Enforces Hard Lock Ingestion Rule (`isRoundLockedForIngestion`).
 * 2. Processes raw GPS `[lat, lng][]` stream via `processActivityCoordinates`.
 * 3. Preserves the physical activity timestamp (`recordedAtSql = normalizeUtcSqlTimestamp(input.startedAt)`).
 * 4. Enforces Chronological Ownership Resolution (No Retroactive Stealing):
 *    An incoming walk only claims or steals an H3 cell if the cell is unclaimed OR
 *    `new_activity.recorded_at > existing_territory.captured_at`.
 * 5. Permanently records the activity, its `route_geojson`, and its full covered `h3_indices_json` in `activities`.
 * 6. Writes won H3 cells into `territories` with `captured_at = recordedAtSql` (never `CURRENT_TIMESTAMP`).
 */
export async function ingestActivityStream(
  input: IngestActivityInput
): Promise<IngestActivityOutput> {
  const db = await getD1Database();

  // Check if the round has concluded or expired
  const targetRound = await getActiveOrSpecifiedRound(input.roundId);
  if (isRoundLockedForIngestion(targetRound)) {
    throw new Error(ROUND_CONCLUDED_ERROR_MESSAGE);
  }

  const compositeActivityId = `${input.roundId}:${input.stravaActivityId}`;

  const existing = await db
    .prepare('SELECT * FROM activities WHERE id = ?')
    .bind(compositeActivityId)
    .first<Record<string, unknown>>();

  const hasExplicitOverride =
    input.forceLoop !== undefined || input.captureModeOverride !== undefined;

  if (existing && !hasExplicitOverride) {
    return {
      activityId: String(existing.id),
      stravaActivityId: String(existing.strava_activity_id),
      roundId: String(existing.round_id),
      name: String(existing.name),
      captureMode: (existing.capture_mode as CaptureMode) || 'loop',
      cellsCaptured: Number(existing.cells_captured ?? 0),
      cellsStolen: Number(existing.cells_stolen ?? 0),
      cellsProtectedByChronology: 0,
      recordedAt: String(existing.started_at ?? ''),
      areaKm2: Number(existing.area_km2 ?? 0),
      distanceMeters: Number(existing.distance_meters ?? 0),
      centroid: [
        Number(existing.start_lng ?? AUCKLAND_DEFAULT_CENTER[0]),
        Number(existing.start_lat ?? AUCKLAND_DEFAULT_CENTER[1]),
      ],
      alreadyProcessed: true,
    };
  }

  const spatial = processActivityCoordinates(input.latLngStream, {
    forceLoop: input.forceLoop,
    captureModeOverride: input.captureModeOverride,
  });

  if (
    input.requireClosedLoop &&
    !input.forceLoop &&
    !input.captureModeOverride &&
    spatial.captureMode !== 'loop'
  ) {
    throw new Error(
      `Activity "${input.name}" does not form a valid closed loop (within 150m).`
    );
  }

  const h3Indices = spatial.h3Indices;
  const finalDistance =
    input.distanceMeters && input.distanceMeters > 0
      ? input.distanceMeters
      : spatial.distanceMeters;

  const recordedAtSql = normalizeUtcSqlTimestamp(input.startedAt);
  const recordedAtMs = parseUtcTimestampMs(recordedAtSql);

  // Ensure the player is registered as a participant in this round
  await db
    .prepare(
      'INSERT OR IGNORE INTO round_participants (round_id, user_id) VALUES (?, ?)'
    )
    .bind(input.roundId, input.userId)
    .run();

  // If re-importing the same activity with an explicit override, clear its prior territory claims first
  if (existing && hasExplicitOverride) {
    await db
      .prepare('DELETE FROM territories WHERE round_id = ? AND activity_id = ?')
      .bind(input.roundId, compositeActivityId)
      .run();
  }

  // Inspect existing territories in this round to enforce Chronological Ownership Resolution
  const existingCellsMap = new Map<
    string,
    {
      ownerId: string;
      activityId: string;
      capturedAt: string;
      capturedAtMs: number;
    }
  >();

  const CHUNK_SIZE = 80;
  for (let i = 0; i < h3Indices.length; i += CHUNK_SIZE) {
    const slice = h3Indices.slice(i, i + CHUNK_SIZE);
    const placeholders = slice.map(() => '?').join(', ');
    const existingRows = await db
      .prepare(
        `SELECT h3_index, owner_id, activity_id, captured_at
         FROM territories
         WHERE round_id = ? AND h3_index IN (${placeholders})`
      )
      .bind(input.roundId, ...slice)
      .all<{
        h3_index: string;
        owner_id: string;
        activity_id: string;
        captured_at: string;
      }>();

    for (const row of existingRows.results ?? []) {
      const cellId = String(row.h3_index);
      const capturedAtStr = String(row.captured_at ?? '');
      existingCellsMap.set(cellId, {
        ownerId: String(row.owner_id),
        activityId: String(row.activity_id),
        capturedAt: capturedAtStr,
        capturedAtMs: parseUtcTimestampMs(capturedAtStr),
      });
    }
  }

  const winningH3Indices: string[] = [];
  let cellsStolen = 0;
  let cellsProtectedByChronology = 0;

  for (const h3Index of h3Indices) {
    const existingCell = existingCellsMap.get(h3Index);
    if (!existingCell) {
      // Unclaimed cell -> claimed at the walk's historical timestamp
      winningH3Indices.push(h3Index);
    } else if (existingCell.activityId === compositeActivityId) {
      // Same activity being re-processed
      winningH3Indices.push(h3Index);
    } else if (recordedAtMs > existingCell.capturedAtMs) {
      // Incoming walk is chronologically MORE RECENT than the existing cell capture
      winningH3Indices.push(h3Index);
      if (existingCell.ownerId !== input.userId) {
        cellsStolen += 1;
      }
    } else {
      // Existing cell was captured by a MORE RECENT walk -> cannot retroactively steal/overwrite
      cellsProtectedByChronology += 1;
    }
  }

  const wonAreaKm2 = calculateH3CellsAreaKm2(winningH3Indices);

  await db
    .prepare(
      `INSERT OR REPLACE INTO activities (
        id, strava_activity_id, round_id, user_id, name, sport_type,
        distance_meters, moving_time_seconds, capture_mode,
        cells_captured, cells_stolen, area_km2, route_geojson, h3_indices_json,
        start_lat, start_lng, started_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      compositeActivityId,
      input.stravaActivityId,
      input.roundId,
      input.userId,
      input.name,
      input.sportType ?? 'Run',
      finalDistance,
      input.movingTimeSeconds ?? 900,
      spatial.captureMode,
      winningH3Indices.length,
      cellsStolen,
      wonAreaKm2,
      JSON.stringify(spatial.simplifiedRouteGeoJSON),
      JSON.stringify(h3Indices),
      spatial.startLat,
      spatial.startLng,
      recordedAtSql
    )
    .run();

  // Chronological Upsert isolated per round:
  // Stores the physical activity timestamp (`recordedAtSql`) as `captured_at`
  // and enforces `datetime(excluded.captured_at) > datetime(territories.captured_at)` at the SQLite level.
  const BATCH_LIMIT = 50;
  for (let i = 0; i < winningH3Indices.length; i += BATCH_LIMIT) {
    const chunk = winningH3Indices.slice(i, i + BATCH_LIMIT);
    const statements = chunk.map((h3Index) =>
      db
        .prepare(
          `INSERT INTO territories (round_id, h3_index, owner_id, activity_id, captured_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(round_id, h3_index) DO UPDATE SET
             owner_id = excluded.owner_id,
             activity_id = excluded.activity_id,
             captured_at = excluded.captured_at
           WHERE datetime(excluded.captured_at) > datetime(territories.captured_at)
              OR territories.activity_id = excluded.activity_id`
        )
        .bind(
          input.roundId,
          h3Index,
          input.userId,
          compositeActivityId,
          recordedAtSql
        )
    );
    await db.batch(statements);
  }

  return {
    activityId: compositeActivityId,
    stravaActivityId: input.stravaActivityId,
    roundId: input.roundId,
    name: input.name,
    captureMode: spatial.captureMode,
    cellsCaptured: winningH3Indices.length,
    cellsStolen,
    cellsProtectedByChronology,
    recordedAt: recordedAtSql,
    areaKm2: wonAreaKm2,
    distanceMeters: finalDistance,
    centroid: spatial.centroid,
    alreadyProcessed: false,
  };
}

/**
 * Helper to resolve the full set of covered H3 indices for an activity record.
 * Uses `h3_indices_json` if present, or reconstructs from `route_geojson` if empty.
 */
function resolveCoveredH3SetForActivityRow(row: Record<string, unknown>): Set<string> {
  try {
    const rawH3 = String(row.h3_indices_json ?? '[]');
    const parsedH3 = JSON.parse(rawH3);
    if (Array.isArray(parsedH3) && parsedH3.length > 0) {
      return new Set(parsedH3.map((c) => String(c)));
    }
  } catch {
    // Fallback to route_geojson reconstruction
  }

  try {
    const routeJson = JSON.parse(String(row.route_geojson ?? '{}')) as {
      coordinates?: [number, number][];
    };
    const coords = routeJson.coordinates ?? [];
    if (coords.length >= 2) {
      const latLng: [number, number][] = coords.map(([lng, lat]) => [lat, lng]);
      const mode = ((row.capture_mode as CaptureMode) || 'loop');
      const spatial = processActivityCoordinates(latLng, {
        captureModeOverride: mode,
      });
      return new Set(spatial.h3Indices);
    }
  } catch {
    // Ignore parse error
  }

  return new Set();
}

/**
 * Activity Deletion & State Rollback Engine:
 * 1. Verifies the requester is either the activity owner or the round admin.
 * 2. Finds all H3 cells in `territories` currently held by `activity_id = :id`.
 * 3. Queries all remaining valid activities in the round ordered by `datetime(started_at) DESC, datetime(processed_at) DESC`.
 * 4. For each affected H3 cell:
 *    - Reverts ownership (`owner_id`, `activity_id`, `captured_at`) to the most recent preceding activity covering that cell;
 *    - Otherwise deletes the cell record from `territories`.
 * 5. Deletes the activity row from `activities`.
 */
export async function deleteActivityAndRollbackState(params: {
  activityId: string;
  requesterUserId: string;
}): Promise<DeleteActivityRollbackResult> {
  const db = await getD1Database();
  const decodedId = decodeURIComponent(params.activityId);

  let activityRow = await db
    .prepare('SELECT * FROM activities WHERE id = ?')
    .bind(decodedId)
    .first<Record<string, unknown>>();

  if (!activityRow) {
    activityRow = await db
      .prepare('SELECT * FROM activities WHERE strava_activity_id = ? ORDER BY processed_at DESC LIMIT 1')
      .bind(decodedId)
      .first<Record<string, unknown>>();
  }

  if (!activityRow) {
    const err = new Error('Activity not found.') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const targetActivityId = String(activityRow.id);
  const targetRoundId = String(activityRow.round_id);
  const activityOwnerId = String(activityRow.user_id);
  const activityName = String(activityRow.name ?? 'Activity');

  const round = await getActiveOrSpecifiedRound(targetRoundId);
  const isOwner = activityOwnerId === params.requesterUserId;
  const isRoundAdmin = Boolean(
    round.createdBy && round.createdBy === params.requesterUserId
  );

  if (!isOwner && !isRoundAdmin) {
    const err = new Error(
      'Forbidden: Only the activity owner or the round admin can remove this activity.'
    ) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  // 1. Find all H3 cells in `territories` currently owned by this activity
  const heldCellsRes = await db
    .prepare(
      'SELECT h3_index FROM territories WHERE round_id = ? AND activity_id = ?'
    )
    .bind(targetRoundId, targetActivityId)
    .all<{ h3_index: string }>();

  const affectedCells = (heldCellsRes.results ?? []).map((r) => String(r.h3_index));

  // 2. Load remaining valid activities in this round ordered newest-first (`ORDER BY datetime(started_at) DESC`)
  const remainingActivitiesRes = await db
    .prepare(
      `SELECT id, user_id, started_at, capture_mode, route_geojson, h3_indices_json
       FROM activities
       WHERE round_id = ? AND id != ?
       ORDER BY datetime(started_at) DESC, datetime(processed_at) DESC`
    )
    .bind(targetRoundId, targetActivityId)
    .all<Record<string, unknown>>();

  const candidatePrecedingActivities = (remainingActivitiesRes.results ?? []).map(
    (r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      startedAt: normalizeUtcSqlTimestamp(String(r.started_at ?? '')),
      coveredCells: resolveCoveredH3SetForActivityRow(r),
    })
  );

  let cellsReverted = 0;
  let cellsCleared = 0;

  const statements: Array<{ run: () => Promise<unknown> }> = [];

  for (const h3Index of affectedCells) {
    // Find the most recent valid activity covering this cell (`ORDER BY recorded_at DESC LIMIT 1`)
    const preceding = candidatePrecedingActivities.find((cand) =>
      cand.coveredCells.has(h3Index)
    );

    if (preceding) {
      cellsReverted += 1;
      statements.push(
        db
          .prepare(
            `UPDATE territories
             SET owner_id = ?, activity_id = ?, captured_at = ?
             WHERE round_id = ? AND h3_index = ?`
          )
          .bind(
            preceding.userId,
            preceding.id,
            preceding.startedAt,
            targetRoundId,
            h3Index
          )
      );
    } else {
      cellsCleared += 1;
      statements.push(
        db
          .prepare(
            'DELETE FROM territories WHERE round_id = ? AND h3_index = ?'
          )
          .bind(targetRoundId, h3Index)
      );
    }
  }

  const BATCH_LIMIT = 50;
  for (let i = 0; i < statements.length; i += BATCH_LIMIT) {
    await db.batch(
      statements.slice(i, i + BATCH_LIMIT) as Parameters<typeof db.batch>[0]
    );
  }

  // 3. Delete the activity record from `activities`
  await db
    .prepare('DELETE FROM activities WHERE id = ?')
    .bind(targetActivityId)
    .run();

  return {
    deletedActivityId: targetActivityId,
    deletedActivityName: activityName,
    roundId: targetRoundId,
    cellsAffected: affectedCells.length,
    cellsReverted,
    cellsCleared,
  };
}

/**
 * Fetches all captured territories for a specific Round joined with owner and activity metadata.
 */
export async function getAllTerritories(
  roundId?: string | null
): Promise<TerritoryFeatureProperties[]> {
  const db = await getD1Database();
  const targetRound = await getActiveOrSpecifiedRound(roundId);

  const res = await db
    .prepare(
      `SELECT
        t.round_id,
        t.h3_index,
        t.owner_id,
        t.activity_id,
        t.captured_at,
        u.username,
        u.display_name,
        u.color_hex,
        a.name AS activity_name,
        a.capture_mode
      FROM territories t
      INNER JOIN users u ON u.id = t.owner_id
      LEFT JOIN activities a ON a.id = t.activity_id
      WHERE t.round_id = ?
      ORDER BY t.captured_at DESC`
    )
    .bind(targetRound.id)
    .all<Record<string, unknown>>();

  const rows = res.results ?? [];
  return rows.map((r) => ({
    h3Index: String(r.h3_index),
    roundId: String(r.round_id),
    ownerId: String(r.owner_id),
    ownerUsername: String(r.username ?? 'unknown'),
    ownerDisplayName: String(r.display_name || r.username || 'Player'),
    ownerColor: String(r.color_hex ?? '#00f0ff'),
    activityId: String(r.activity_id),
    activityName: String(r.activity_name ?? 'Loop Conquest'),
    captureMode: (r.capture_mode as CaptureMode) || 'loop',
    capturedAt: String(r.captured_at),
    areaKm2: 0.1053,
  }));
}

/**
 * Computes the live Territory Dominance Leaderboard isolated to a specific Round.
 */
export async function getLeaderboardStandings(roundId?: string | null): Promise<{
  round: RoundSummary;
  leaderboard: LeaderboardEntry[];
  totalGridCells: number;
  totalGridAreaKm2: number;
}> {
  const db = await getD1Database();
  const round = await getActiveOrSpecifiedRound(roundId);

  const usersRes = await db
    .prepare(
      'SELECT id, username, display_name, bio, color_hex, strava_athlete_id, refresh_token FROM users'
    )
    .all<Record<string, unknown>>();

  const territoryRes = await db
    .prepare('SELECT h3_index, owner_id FROM territories WHERE round_id = ?')
    .bind(round.id)
    .all<{ h3_index: string; owner_id: string }>();

  const activityStatsRes = await db
    .prepare(
      `SELECT
        user_id,
        COUNT(*) AS activities_count,
        COALESCE(SUM(distance_meters), 0) AS total_distance_meters,
        COALESCE(SUM(cells_stolen), 0) AS total_cells_stolen,
        MAX(processed_at) AS last_active_at
      FROM activities
      WHERE round_id = ?
      GROUP BY user_id`
    )
    .bind(round.id)
    .all<Record<string, unknown>>();

  const cellsByUser = new Map<string, string[]>();
  const allCells: string[] = [];
  for (const row of territoryRes.results ?? []) {
    const uid = String(row.owner_id);
    const cell = String(row.h3_index);
    allCells.push(cell);
    const list = cellsByUser.get(uid) ?? [];
    list.push(cell);
    cellsByUser.set(uid, list);
  }

  const totalGridCells = allCells.length;
  const totalGridAreaKm2 = calculateH3CellsAreaKm2(allCells);

  const statsByUser = new Map<
    string,
    {
      activitiesCount: number;
      totalDistanceMeters: number;
      totalCellsStolen: number;
      lastActiveAt: string | null;
    }
  >();

  for (const row of activityStatsRes.results ?? []) {
    statsByUser.set(String(row.user_id), {
      activitiesCount: Number(row.activities_count ?? 0),
      totalDistanceMeters: Number(row.total_distance_meters ?? 0),
      totalCellsStolen: Number(row.total_cells_stolen ?? 0),
      lastActiveAt: row.last_active_at ? String(row.last_active_at) : null,
    });
  }

  const participantSet = new Set(round.participantIds);
  // Filter to users participating in this round (or holding cells/activities in this round)
  const allUserRows = usersRes.results ?? [];
  const relevantUsers =
    participantSet.size > 0
      ? allUserRows.filter(
          (u) =>
            participantSet.has(String(u.id)) ||
            cellsByUser.has(String(u.id)) ||
            statsByUser.has(String(u.id))
        )
      : allUserRows;

  const entries: Omit<LeaderboardEntry, 'rank'>[] = relevantUsers.map((u) => {
    const userId = String(u.id);
    const heldCells = cellsByUser.get(userId) ?? [];
    const activeAreaKm2 = calculateH3CellsAreaKm2(heldCells);
    const actStats = statsByUser.get(userId);
    const stravaAthleteId =
      u.strava_athlete_id !== null && u.strava_athlete_id !== undefined
        ? Number(u.strava_athlete_id)
        : null;

    return {
      userId,
      username: String(u.username ?? ''),
      displayName: String(u.display_name || u.username || 'Player'),
      bio: String(u.bio ?? ''),
      color: String(u.color_hex ?? '#00f0ff'),
      stravaConnected: Boolean(stravaAthleteId && u.refresh_token),
      stravaAthleteId,
      activeCells: heldCells.length,
      activeAreaKm2,
      dominancePercent:
        totalGridCells > 0
          ? Number(((heldCells.length / totalGridCells) * 100).toFixed(1))
          : 0,
      totalDistanceKm: Number(
        ((actStats?.totalDistanceMeters ?? 0) / 1000).toFixed(2)
      ),
      activitiesCount: actStats?.activitiesCount ?? 0,
      totalCellsStolen: actStats?.totalCellsStolen ?? 0,
      lastActiveAt: actStats?.lastActiveAt ?? null,
    };
  });

  entries.sort((a, b) => {
    if (b.activeCells !== a.activeCells) return b.activeCells - a.activeCells;
    return b.totalDistanceKm - a.totalDistanceKm;
  });

  const leaderboard: LeaderboardEntry[] = entries.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));

  return {
    round,
    leaderboard,
    totalGridCells,
    totalGridAreaKm2,
  };
}

/**
 * Fetches recent ingested activities for a specific Round with athlete display name and telemetry.
 */
export async function getRecentActivityFeed(
  roundId?: string | null,
  limit = 25
): Promise<ActivityFeedItem[]> {
  const db = await getD1Database();
  const targetRound = await getActiveOrSpecifiedRound(roundId);

  const res = await db
    .prepare(
      `SELECT
        a.*,
        u.username,
        u.display_name,
        u.color_hex,
        r.name AS round_name
      FROM activities a
      INNER JOIN users u ON u.id = a.user_id
      LEFT JOIN rounds r ON r.id = a.round_id
      WHERE a.round_id = ?
      ORDER BY a.started_at DESC, a.processed_at DESC
      LIMIT ?`
    )
    .bind(targetRound.id, limit)
    .all<Record<string, unknown>>();

  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    stravaActivityId: String(r.strava_activity_id ?? r.id),
    roundId: String(r.round_id),
    roundName: r.round_name ? String(r.round_name) : targetRound.name,
    userId: String(r.user_id),
    username: String(r.username ?? 'unknown'),
    displayName: String(r.display_name || r.username || 'Player'),
    userColor: String(r.color_hex ?? '#00f0ff'),
    name: String(r.name),
    sportType: String(r.sport_type ?? 'Run'),
    distanceMeters: Number(r.distance_meters ?? 0),
    movingTimeSeconds: Number(r.moving_time_seconds ?? 0),
    captureMode: (r.capture_mode as CaptureMode) || 'loop',
    cellsCaptured: Number(r.cells_captured ?? 0),
    cellsStolen: Number(r.cells_stolen ?? 0),
    areaKm2: Number(r.area_km2 ?? 0),
    routeGeojson: String(r.route_geojson ?? '{"type":"LineString","coordinates":[]}'),
    startLat:
      r.start_lat !== null && r.start_lat !== undefined
        ? Number(r.start_lat)
        : null,
    startLng:
      r.start_lng !== null && r.start_lng !== undefined
        ? Number(r.start_lng)
        : null,
    startedAt: String(r.started_at),
    processedAt: String(r.processed_at),
  }));
}

// ============================================================================
// Dedicated User Profile & Permanent Activity History
// ============================================================================

export async function getUserProfileWithHistory(
  userId: string
): Promise<UserProfileData | null> {
  const db = await getD1Database();
  const user = await getUserById(userId);
  if (!user) return null;

  const activitiesRes = await db
    .prepare(
      `SELECT
        a.*,
        r.name AS round_name,
        (
          SELECT COUNT(*)
          FROM territories t
          WHERE t.activity_id = a.id AND t.owner_id = a.user_id
        ) AS cells_still_held
      FROM activities a
      LEFT JOIN rounds r ON r.id = a.round_id
      WHERE a.user_id = ?
      ORDER BY a.started_at DESC, a.processed_at DESC`
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  const activeRound = await getActiveOrSpecifiedRound();
  const activeHeldRes = await db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM territories WHERE round_id = ? AND owner_id = ?'
    )
    .bind(activeRound.id, userId)
    .first<{ cnt: number }>();

  const rows = activitiesRes.results ?? [];

  // Deduplicate by strava_activity_id when computing physical distance/time/loop stats
  // so importing the same physical run into two different rounds doesn't double-count physical km
  const seenStravaIds = new Set<string>();
  let totalDistanceMeters = 0;
  let totalMovingTimeSeconds = 0;
  let totalLoopsCompleted = 0;
  let totalCellsCapturedEver = 0;
  let totalCellsStolenEver = 0;
  let totalAreaClaimedKm2 = 0;

  const activities: ActivityFeedItem[] = rows.map((r) => {
    const stravaId = String(r.strava_activity_id ?? r.id);
    const dist = Number(r.distance_meters ?? 0);
    const time = Number(r.moving_time_seconds ?? 0);
    const mode = ((r.capture_mode as CaptureMode) || 'loop');
    const captured = Number(r.cells_captured ?? 0);
    const stolen = Number(r.cells_stolen ?? 0);
    const area = Number(r.area_km2 ?? 0);

    totalCellsCapturedEver += captured;
    totalCellsStolenEver += stolen;
    totalAreaClaimedKm2 += area;

    if (!seenStravaIds.has(stravaId)) {
      seenStravaIds.add(stravaId);
      totalDistanceMeters += dist;
      totalMovingTimeSeconds += time;
      if (mode === 'loop') {
        totalLoopsCompleted += 1;
      }
    }

    return {
      id: String(r.id),
      stravaActivityId: stravaId,
      roundId: String(r.round_id),
      roundName: r.round_name ? String(r.round_name) : 'Auckland Round',
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      userColor: user.colorHex,
      name: String(r.name),
      sportType: String(r.sport_type ?? 'Run'),
      distanceMeters: dist,
      movingTimeSeconds: time,
      captureMode: mode,
      cellsCaptured: captured,
      cellsStolen: stolen,
      cellsStillHeld: Number(r.cells_still_held ?? 0),
      areaKm2: area,
      routeGeojson: String(
        r.route_geojson ?? '{"type":"LineString","coordinates":[]}'
      ),
      startLat:
        r.start_lat !== null && r.start_lat !== undefined
          ? Number(r.start_lat)
          : null,
      startLng:
        r.start_lng !== null && r.start_lng !== undefined
          ? Number(r.start_lng)
          : null,
      startedAt: String(r.started_at),
      processedAt: String(r.processed_at),
    };
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      colorHex: user.colorHex,
      stravaConnected: Boolean(user.stravaAthleteId && user.refreshToken),
      stravaAthleteId: user.stravaAthleteId,
      createdAt: user.createdAt,
    },
    stats: {
      totalDistanceMeters: Number(totalDistanceMeters.toFixed(1)),
      totalMovingTimeSeconds,
      totalLoopsCompleted,
      totalActivitiesCount: activities.length,
      totalCellsCapturedEver,
      totalCellsStolenEver,
      totalAreaClaimedKm2: Number(totalAreaClaimedKm2.toFixed(2)),
      currentActiveCells: Number(activeHeldRes?.cnt ?? 0),
    },
    activities,
  };
}

function mapRowToUserRecord(row: Record<string, unknown>): schema.UserRecord {
  const username = String(row.username ?? '');
  return {
    id: String(row.id),
    username,
    displayName: String(row.display_name || username || 'Player'),
    bio: String(row.bio ?? ''),
    passwordHash: String(row.password_hash ?? ''),
    stravaAthleteId:
      row.strava_athlete_id !== null && row.strava_athlete_id !== undefined
        ? Number(row.strava_athlete_id)
        : null,
    accessToken: row.access_token ? String(row.access_token) : null,
    refreshToken: row.refresh_token ? String(row.refresh_token) : null,
    tokenExpiresAt:
      row.token_expires_at !== null && row.token_expires_at !== undefined
        ? Number(row.token_expires_at)
        : null,
    colorHex: String(row.color_hex ?? '#00f0ff'),
    homeLat:
      row.home_lat !== null && row.home_lat !== undefined
        ? Number(row.home_lat)
        : null,
    homeLng:
      row.home_lng !== null && row.home_lng !== undefined
        ? Number(row.home_lng)
        : null,
    homeZoom:
      row.home_zoom !== null && row.home_zoom !== undefined
        ? Number(row.home_zoom)
        : 14,
    createdAt: String(row.created_at ?? ''),
  };
}
