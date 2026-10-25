import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, isStravaConfigured } from '@/lib/strava';
import { updateUserProfile } from '@/lib/d1';
import { isValidTacticalColor } from '@/lib/utils';

export const runtime = 'edge';

/**
 * GET /api/auth/me
 * Returns the currently logged-in user's account, customizable display name, bio,
 * territory color, and Strava connection status.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        stravaConfigured: isStravaConfigured(),
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        colorHex: user.colorHex,
        homeLat: user.homeLat ?? null,
        homeLng: user.homeLng ?? null,
        homeZoom: user.homeZoom ?? 14,
        stravaAthleteId: user.stravaAthleteId,
        stravaConnected: Boolean(user.stravaAthleteId && user.refreshToken),
        createdAt: user.createdAt,
      },
      stravaConfigured: isStravaConfigured(),
    },
    { status: 200 }
  );
}

/**
 * PATCH /api/auth/me   (also exposed as PATCH /api/user/profile)
 * Updates the logged-in user's customizable display name, bio, signature hex color,
 * and/or personal Home Area (`homeLat`, `homeLng` in WGS84 degrees, optional `homeZoom`).
 * Send `homeLat: null` and `homeLng: null` to clear the home area.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    displayName?: string;
    bio?: string;
    colorHex?: string;
    homeLat?: number | null;
    homeLng?: number | null;
    homeZoom?: number | null;
  };

  if (body.colorHex !== undefined && !isValidTacticalColor(body.colorHex)) {
    return NextResponse.json(
      { error: 'Invalid hex color. Use #RRGGBB format.' },
      { status: 400 }
    );
  }

  if (body.displayName !== undefined) {
    const trimmed = body.displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 32) {
      return NextResponse.json(
        { error: 'Display Name must be between 1 and 32 characters.' },
        { status: 400 }
      );
    }
  }

  const homeProvided = body.homeLat !== undefined || body.homeLng !== undefined;
  if (homeProvided) {
    const clearing = body.homeLat === null && body.homeLng === null;
    if (!clearing) {
      const lat = body.homeLat;
      const lng = body.homeLng;
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return NextResponse.json(
          {
            error:
              'Home area needs a valid latitude (-90..90) and longitude (-180..180).',
          },
          { status: 400 }
        );
      }
    }
  }
  if (
    body.homeZoom !== undefined &&
    body.homeZoom !== null &&
    (!Number.isFinite(body.homeZoom) || body.homeZoom < 1 || body.homeZoom > 20)
  ) {
    return NextResponse.json(
      { error: 'Home zoom must be between 1 and 20.' },
      { status: 400 }
    );
  }

  const updated = await updateUserProfile(user.id, {
    displayName: body.displayName,
    bio: body.bio,
    colorHex: body.colorHex,
    homeLat: body.homeLat,
    homeLng: body.homeLng,
    homeZoom:
      body.homeZoom !== undefined && body.homeZoom !== null
        ? Math.round(body.homeZoom)
        : body.homeZoom,
  });

  return NextResponse.json({
    ok: true,
    user: updated
      ? {
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
          bio: updated.bio,
          colorHex: updated.colorHex,
          homeLat: updated.homeLat ?? null,
          homeLng: updated.homeLng ?? null,
          homeZoom: updated.homeZoom ?? 14,
          stravaAthleteId: updated.stravaAthleteId,
          stravaConnected: Boolean(
            updated.stravaAthleteId && updated.refreshToken
          ),
        }
      : null,
  });
}
