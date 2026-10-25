import type { NextRequest } from 'next/server';
import {
  getUserById,
  unlinkStravaAccountFromUser,
  updateUserTokens,
} from './d1';
import {
  decodeSessionCookie,
  encodeSessionCookie,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from './auth';
import type { UserRecord } from './schema';

export {
  SESSION_COOKIE_NAME,
  decodeSessionCookie,
  encodeSessionCookie,
  type SessionPayload,
};

export const STRAVA_OAUTH_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const STRAVA_OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';
export const STRAVA_OAUTH_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
export const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';

export interface StravaAthleteProfile {
  id: number;
  username: string | null;
  firstname: string;
  lastname: string;
  profile_medium?: string | null;
  profile?: string | null;
}

export interface StravaTokenExchangeResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete: StravaAthleteProfile;
}

export interface StravaRefreshTokenResponse {
  token_type: string;
  access_token: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
}

export interface StravaSummaryActivity {
  id: number | string;
  name: string;
  type?: string;
  sport_type?: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  start_date: string;
  start_latlng?: [number, number] | null;
  end_latlng?: [number, number] | null;
  map?: {
    id?: string;
    summary_polyline?: string | null;
    polyline?: string | null;
  };
}

export interface StravaStreamsByTypeResponse {
  latlng?: {
    data: [number, number][];
    series_type: string;
    original_size: number;
    resolution: string;
  };
  time?: {
    data: number[];
  };
  distance?: {
    data: number[];
  };
}

/**
 * Checks whether real Strava OAuth credentials are configured in the environment.
 */
export function isStravaConfigured(): boolean {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  return Boolean(
    clientId &&
      clientSecret &&
      clientId !== 'your_strava_client_id' &&
      clientSecret !== 'your_strava_client_secret'
  );
}

/**
 * Builds the Strava OAuth 2.0 authorization redirect URL requesting `read,activity:read_all`.
 */
export function buildStravaAuthorizeUrl(
  origin: string,
  state = 'intvl2_auth'
): string {
  const clientId = process.env.STRAVA_CLIENT_ID || '';
  const appBase = process.env.NEXT_PUBLIC_APP_URL || origin;
  const redirectUri = `${appBase.replace(/\/$/, '')}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  });

  return `${STRAVA_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchanges an OAuth 2.0 authorization `code` for `access_token`, `refresh_token`, and `athlete` metadata.
 */
export async function exchangeStravaCodeForToken(
  code: string
): Promise<StravaTokenExchangeResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET environment variables.'
    );
  }

  const response = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Strava token exchange failed (${response.status}): ${errorBody}`
    );
  }

  const data = (await response.json()) as StravaTokenExchangeResponse;
  if (!data.access_token || !data.refresh_token || !data.athlete?.id) {
    throw new Error(
      'Strava token response missing required token or athlete fields.'
    );
  }

  return data;
}

/**
 * Refreshes an athlete's Strava access token using their stored `refresh_token`
 * and updates the D1 `users` record.
 */
export async function refreshStravaAccessToken(user: UserRecord): Promise<string> {
  if (!user.refreshToken) {
    throw new Error('User has not connected a Strava account yet.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    user.tokenExpiresAt &&
    user.tokenExpiresAt > nowSeconds + 300 &&
    user.accessToken
  ) {
    return user.accessToken;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Cannot refresh Strava token: STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET not configured.'
    );
  }

  const response = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: user.refreshToken,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown refresh error');
    throw new Error(`Strava token refresh failed (${response.status}): ${errText}`);
  }

  const refreshed = (await response.json()) as StravaRefreshTokenResponse;
  await updateUserTokens(
    user.id,
    refreshed.access_token,
    refreshed.refresh_token || user.refreshToken,
    refreshed.expires_at
  );

  return refreshed.access_token;
}

/**
 * Fetches raw GPS coordinate streams for an activity from Strava API v3:
 * `GET https://www.strava.com/api/v3/activities/{id}/streams?keys=latlng&key_by_type=true`
 */
export async function fetchStravaActivityLatLngStream(
  activityId: string | number,
  accessToken: string
): Promise<[number, number][]> {
  const url = `${STRAVA_API_BASE_URL}/activities/${encodeURIComponent(
    String(activityId)
  )}/streams?keys=latlng&key_by_type=true`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    const errText = await response.text().catch(() => 'Stream fetch failed');
    throw new Error(
      `Failed to fetch Strava streams for activity ${activityId} (${response.status}): ${errText}`
    );
  }

  const payload = (await response.json()) as
    | StravaStreamsByTypeResponse
    | Array<{ type: string; data: [number, number][] }>;

  if (Array.isArray(payload)) {
    const latlngEntry = payload.find((item) => item.type === 'latlng');
    return latlngEntry?.data ?? [];
  }

  return payload.latlng?.data ?? [];
}

/**
 * Fetches metadata for a single Strava activity (`GET /api/v3/activities/{id}`).
 */
export async function fetchStravaActivityDetail(
  activityId: string | number,
  accessToken: string
): Promise<StravaSummaryActivity | null> {
  const url = `${STRAVA_API_BASE_URL}/activities/${encodeURIComponent(
    String(activityId)
  )}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as StravaSummaryActivity;
}

/**
 * Fetches the authenticated athlete's activities from the past N days (`GET /api/v3/athlete/activities?after=...`),
 * sorted newest-first so recent walks/runs appear at the top.
 */
export async function fetchAthleteActivitiesLastDays(
  accessToken: string,
  days = 30
): Promise<StravaSummaryActivity[]> {
  const afterEpochSeconds = Math.floor(
    (Date.now() - days * 24 * 60 * 60 * 1000) / 1000
  );
  const url = `${STRAVA_API_BASE_URL}/athlete/activities?after=${afterEpochSeconds}&per_page=100`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Failed to fetch athlete activities from Strava (${response.status}): ${errText}`
    );
  }

  const list = (await response.json()) as StravaSummaryActivity[];
  if (!Array.isArray(list)) return [];

  return list.sort(
    (a, b) =>
      new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  );
}

/**
 * Revokes the athlete's Strava OAuth token via `POST https://www.strava.com/oauth/deauthorize`
 * and clears `strava_athlete_id`, `access_token`, `refresh_token`, and `token_expires_at` in D1.
 */
export async function deauthorizeStravaAccount(user: UserRecord): Promise<{
  revokedRemote: boolean;
  updatedUser: UserRecord | null;
}> {
  let revokedRemote = false;

  try {
    let tokenToRevoke = user.accessToken;
    if (user.refreshToken) {
      try {
        tokenToRevoke = await refreshStravaAccessToken(user);
      } catch {
        tokenToRevoke = user.accessToken;
      }
    }

    if (tokenToRevoke) {
      const response = await fetch(
        `${STRAVA_OAUTH_DEAUTHORIZE_URL}?access_token=${encodeURIComponent(
          tokenToRevoke
        )}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            access_token: tokenToRevoke,
          }).toString(),
        }
      );
      revokedRemote = response.ok;
    }
  } catch (err) {
    console.warn('[INTVL 2.0 Strava Deauthorize Warning]:', err);
  }

  const updatedUser = await unlinkStravaAccountFromUser(user.id);
  return { revokedRemote, updatedUser };
}

/**
 * Strict Activity Type Whitelist:
 * ONLY accepts `Walk`, `Run`, and `Hike`.
 * Immediately rejects `Ride`, `VirtualRide`, `EBikeRide`, `Swim`, `Workout`, `VirtualRun`, etc.
 */
export const ALLOWED_CONQUEST_SPORT_TYPES = ['Walk', 'Run', 'Hike'] as const;

export function isEligibleConquestSport(
  sportType?: string | null,
  legacyType?: string | null
): boolean {
  const allowed = new Set(['walk', 'run', 'hike']);
  const primary = (sportType ?? '').trim().toLowerCase();
  if (primary) {
    return allowed.has(primary);
  }
  const fallback = (legacyType ?? '').trim().toLowerCase();
  if (fallback) {
    return allowed.has(fallback);
  }
  return false;
}

/**
 * Resolves the currently authenticated UserRecord from the incoming request's HTTP-only session cookie.
 */
export async function getAuthenticatedUser(
  req: NextRequest
): Promise<UserRecord | null> {
  const rawCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await decodeSessionCookie(rawCookie);
  if (!session) return null;
  return getUserById(session.userId);
}
