import { NextRequest, NextResponse } from 'next/server';
import { deauthorizeStravaAccount, getAuthenticatedUser } from '@/lib/strava';

export const runtime = 'edge';

/**
 * POST /api/auth/strava/disconnect
 * Calls Strava's OAuth revocation endpoint (`POST https://www.strava.com/oauth/deauthorize`)
 * using the athlete's current access token, clears `strava_athlete_id`, `access_token`,
 * `refresh_token`, and `token_expires_at` in D1, and returns the updated user state.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required to disconnect Strava.' },
      { status: 401 }
    );
  }

  try {
    const { revokedRemote, updatedUser } = await deauthorizeStravaAccount(user);

    return NextResponse.json(
      {
        ok: true,
        revokedRemote,
        user: updatedUser
          ? {
              id: updatedUser.id,
              username: updatedUser.username,
              displayName: updatedUser.displayName,
              bio: updatedUser.bio,
              colorHex: updatedUser.colorHex,
              stravaAthleteId: null,
              stravaConnected: false,
            }
          : null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[INTVL 2.0 Strava Disconnect Error]:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to disconnect Strava account.',
      },
      { status: 500 }
    );
  }
}
