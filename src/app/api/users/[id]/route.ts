import { NextRequest, NextResponse } from 'next/server';
import { getUserProfileWithHistory } from '@/lib/d1';
import { getAuthenticatedUser } from '@/lib/strava';

export const runtime = 'edge';

/**
 * GET /api/users/[id]
 * Returns a registered user's public profile, aggregate career telemetry
 * (total distance, active time, average pace/speed, total loops completed),
 * and permanent Strava-style activity feed with route GeoJSON paths.
 * Supports `/api/users/me` as a shortcut for the currently logged-in user.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const sessionUser = await getAuthenticatedUser(request);

    const targetId = id === 'me' ? sessionUser?.id : id;
    if (!targetId) {
      return NextResponse.json(
        { error: 'User not found or not logged in.' },
        { status: 404 }
      );
    }

    const profile = await getUserProfileWithHistory(targetId);
    if (!profile) {
      return NextResponse.json(
        { error: 'Player profile not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ...profile,
        isOwnProfile: Boolean(sessionUser && sessionUser.id === profile.user.id),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    console.error('[INTVL 2.0 User Profile API Error]:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to load user profile and activity history.',
      },
      { status: 500 }
    );
  }
}
