import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(), // UUID
    username: text('username').notNull().unique(), // Strictly for login/auth
    displayName: text('display_name').notNull(), // Public player name
    bio: text('bio').notNull().default(''),
    passwordHash: text('password_hash').notNull(),
    stravaAthleteId: integer('strava_athlete_id').unique(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: integer('token_expires_at'),
    colorHex: text('color_hex').notNull().default('#00f0ff'),
    homeLat: real('home_lat'),
    homeLng: real('home_lng'),
    homeZoom: integer('home_zoom').default(14),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    usernameIdx: uniqueIndex('idx_users_username').on(table.username),
    stravaAthleteIdIdx: uniqueIndex('idx_users_strava_athlete_id').on(
      table.stravaAthleteId
    ),
    colorHexIdx: index('idx_users_color_hex').on(table.colorHex),
  })
);

export const rounds = sqliteTable(
  'rounds',
  {
    id: text('id').primaryKey(), // UUID
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    startedAt: text('started_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    endsAt: text('ends_at'),
    endedAt: text('ended_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    statusIdx: index('idx_rounds_status').on(table.status),
    createdAtIdx: index('idx_rounds_created_at').on(table.createdAt),
  })
);

export const roundParticipants = sqliteTable(
  'round_participants',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: text('joined_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roundId, table.userId] }),
    userIdIdx: index('idx_round_participants_user_id').on(table.userId),
  })
);

export const activities = sqliteTable(
  'activities',
  {
    id: text('id').primaryKey(), // `${roundId}:${stravaActivityId}`
    stravaActivityId: text('strava_activity_id').notNull(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sportType: text('sport_type').notNull().default('Run'),
    distanceMeters: real('distance_meters').notNull().default(0),
    movingTimeSeconds: integer('moving_time_seconds').notNull().default(0),
    captureMode: text('capture_mode', { enum: ['loop', 'corridor'] })
      .notNull()
      .default('loop'),
    cellsCaptured: integer('cells_captured').notNull().default(0),
    cellsStolen: integer('cells_stolen').notNull().default(0),
    areaKm2: real('area_km2').notNull().default(0),
    routeGeojson: text('route_geojson').notNull(),
    h3IndicesJson: text('h3_indices_json').notNull().default('[]'),
    startLat: real('start_lat'),
    startLng: real('start_lng'),
    startedAt: text('started_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    processedAt: text('processed_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    userIdIdx: index('idx_activities_user_id').on(table.userId),
    roundIdIdx: index('idx_activities_round_id').on(table.roundId),
    stravaIdIdx: index('idx_activities_strava_id').on(table.stravaActivityId),
    startedAtIdx: index('idx_activities_started_at').on(table.startedAt),
  })
);

export const territories = sqliteTable(
  'territories',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    h3Index: text('h3_index').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    capturedAt: text('captured_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roundId, table.h3Index] }),
    roundIdIdx: index('idx_territories_round_id').on(table.roundId),
    ownerIdIdx: index('idx_territories_owner_id').on(
      table.roundId,
      table.ownerId
    ),
    activityIdIdx: index('idx_territories_activity_id').on(table.activityId),
    capturedAtIdx: index('idx_territories_captured_at').on(table.capturedAt),
  })
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type RoundRecord = typeof rounds.$inferSelect;
export type NewRoundRecord = typeof rounds.$inferInsert;
export type ActivityRecord = typeof activities.$inferSelect;
export type NewActivityRecord = typeof activities.$inferInsert;
export type TerritoryRecord = typeof territories.$inferSelect;
export type NewTerritoryRecord = typeof territories.$inferInsert;
