import { NextRequest, NextResponse } from 'next/server';
import {
  buildStravaAuthorizeUrl,
  getAuthenticatedUser,
  isStravaConfigured,
} from '@/lib/strava';

export const runtime = 'edge';

/**
 * GET /api/auth/strava
 * Initiates the Strava OAuth 2.0 authorization redirect to:
 * `https://www.strava.com/oauth/authorize` requesting `read,activity:read_all`
 * for the currently authenticated user session.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.redirect(new URL('/login', url.origin).toString(), {
      status: 302,
    });
  }

  if (!isStravaConfigured()) {
    const homeUrl = new URL('/', url.origin);
    homeUrl.searchParams.set(
      'auth_error',
      'Strava OAuth is not configured yet. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in your environment.'
    );
    return NextResponse.redirect(homeUrl.toString(), { status: 302 });
  }

  const stravaAuthorizeUrl = buildStravaAuthorizeUrl(url.origin, user.id);
  return NextResponse.redirect(stravaAuthorizeUrl, { status: 302 });
}
