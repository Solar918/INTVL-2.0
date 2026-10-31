import { NextRequest, NextResponse } from 'next/server';
import {
  encodeSessionCookie,
  exchangeStravaCodeForToken,
  getAuthenticatedUser,
  SESSION_COOKIE_NAME,
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

    const linkedUser = await linkStravaAccountToUser({
      userId: user.id,
      stravaAthleteId: athlete.id,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: expires_at,
    });

    const sessionCookieValue = await encodeSessionCookie(
      linkedUser.id,
      linkedUser.username
    );

    const homeUrl = new URL('/?strava=connected', url.origin);
    const acceptHeader = request.headers.get('accept') || '';

    // When opened in a new browser tab/popup (target="_blank"), notify the opener tab via
    // BroadcastChannel + localStorage, attempt window.close(), and fall back to redirecting cleanly to /?strava=connected
    if (acceptHeader.includes('text/html') || url.searchParams.get('popup') === '1') {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Strava Connected — INTVL 2.0</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #05070b;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .card {
      padding: 2rem;
      border-radius: 1rem;
      border: 1px solid rgba(252, 76, 2, 0.35);
      background: rgba(10, 14, 23, 0.95);
      text-align: center;
      max-width: 380px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
    }
    .badge {
      display: inline-block;
      padding: 0.35rem 0.75rem;
      border-radius: 999px;
      background: rgba(252, 76, 2, 0.15);
      color: #fc4c02;
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 0.75rem;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
    }
    p {
      margin: 0 0 1.25rem;
      font-size: 0.85rem;
      color: #94a3b8;
    }
    a {
      display: inline-block;
      padding: 0.65rem 1.25rem;
      border-radius: 0.75rem;
      background: #fc4c02;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      font-size: 0.8rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">GPS Uplink Active</div>
    <h1>Strava Account Linked</h1>
    <p>Returning to your INTVL 2.0 tactical dashboard...</p>
    <a href="${homeUrl.toString()}">Continue to Dashboard</a>
  </div>
  <script>
    (function() {
      var targetUrl = ${JSON.stringify(homeUrl.toString())};
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel('intvl_strava_auth');
          bc.postMessage({ type: 'STRAVA_CONNECTED', timestamp: Date.now() });
          bc.close();
        }
      } catch (e) {}
      try {
        localStorage.setItem('intvl_strava_connected_at', String(Date.now()));
      } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'STRAVA_CONNECTED' }, window.location.origin);
          window.close();
        }
      } catch (e) {}
      setTimeout(function() {
        try { window.close(); } catch (e) {}
        window.location.replace(targetUrl);
      }, 250);
    })();
  </script>
</body>
</html>`;

      const response = new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
        },
      });
      response.cookies.set(SESSION_COOKIE_NAME, sessionCookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }

    const redirectResponse = NextResponse.redirect(homeUrl.toString(), {
      status: 302,
    });
    redirectResponse.cookies.set(SESSION_COOKIE_NAME, sessionCookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return redirectResponse;
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
