import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeStravaCodeForToken,
  getAuthenticatedUser,
} from '@/lib/strava';
import {
  getUserById,
  linkStravaAccountToUser,
  updateUserProfile,
} from '@/lib/d1';
import { isValidTacticalColor } from '@/lib/utils';

export const runtime = 'edge';

/**
 * GET /api/auth/callback
 * Strava OAuth 2.0 callback handler:
 * 1. Verifies the user's authenticated session (or state userId fallback).
 * 2. Exchanges authorization `code` for `access_token`, `refresh_token`, and `athlete.id`.
 * 3. Binds `strava_athlete_id`, `access_token`, `refresh_token`, and `token_expires_at` to the user in D1.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const stateUserId = url.searchParams.get('state');

  if (errorParam) {
    const redirectUrl = new URL('/', url.origin);
    redirectUrl.searchParams.set('auth_error', errorParam);
    return NextResponse.redirect(redirectUrl.toString(), { status: 302 });
  }

  if (!code) {
    return NextResponse.json(
      { error: 'Missing authorization code parameter from Strava OAuth callback.' },
      { status: 400 }
    );
  }

  try {
    let user = await getAuthenticatedUser(request);
    if (!user && stateUserId) {
      user = await getUserById(stateUserId);
    }

    if (!user) {
      return NextResponse.redirect(new URL('/login', url.origin).toString(), {
        status: 302,
      });
    }

    const tokenData = await exchangeStravaCodeForToken(code);
    const { athlete, access_token, refresh_token, expires_at } = tokenData;

    await linkStravaAccountToUser({
      userId: user.id,
      stravaAthleteId: athlete.id,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: expires_at,
    });

    const homeUrl = new URL('/?strava=connected', url.origin);
    return NextResponse.redirect(homeUrl.toString(), { status: 302 });
  } catch (err) {
    console.error('[INTVL 2.0 OAuth Callback Error]:', err);
    const errorUrl = new URL('/', url.origin);
    errorUrl.searchParams.set(
      'auth_error',
      err instanceof Error ? err.message : 'Strava authentication failed'
    );
    return NextResponse.redirect(errorUrl.toString(), { status: 302 });
  }
}

/**
 * POST /api/auth/callback
 * Updates the authenticated athlete's displayName, bio, and/or signature neon hex color.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Please log in to update your player profile.' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      color?: string;
      colorHex?: string;
      displayName?: string;
      bio?: string;
    };
    const nextColor = body.colorHex || body.color;

    if (nextColor !== undefined && !isValidTacticalColor(nextColor)) {
      return NextResponse.json(
        { error: 'Invalid tactical color hex.' },
        { status: 400 }
      );
    }

    const updated =
      (await updateUserProfile(user.id, {
        colorHex: nextColor,
        displayName: body.displayName,
        bio: body.bio,
      })) ?? user;

    return NextResponse.json({
      ok: true,
      athlete: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        bio: updated.bio,
        colorHex: updated.colorHex,
        stravaAthleteId: updated.stravaAthleteId,
        stravaConnected: Boolean(
          updated.stravaAthleteId && updated.refreshToken
        ),
      },
    });
  } catch (err) {
    console.error('[INTVL 2.0 Profile Update Error]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update player profile' },
      { status: 500 }
    );
  }
}
