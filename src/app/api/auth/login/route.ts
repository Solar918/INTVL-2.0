import { NextRequest, NextResponse } from 'next/server';
import { getUserByUsername } from '@/lib/d1';
import {
  encodeSessionCookie,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from '@/lib/auth';

export const runtime = 'edge';

interface LoginRequestBody {
  username?: string;
  password?: string;
}

/**
 * POST /api/auth/login
 * Authenticates a user by username and password, setting an HTTP-only session cookie.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as LoginRequestBody;
    const rawUsername = (body.username ?? '').trim().toLowerCase();
    const password = body.password ?? '';

    if (!rawUsername || !password) {
      return NextResponse.json(
        { error: 'Please enter both your username and password.' },
        { status: 400 }
      );
    }

    const user = await getUserByUsername(rawUsername);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid username or password.' },
        { status: 401 }
      );
    }

    const sessionToken = await encodeSessionCookie(user.id, user.username);
    const response = NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          bio: user.bio,
          colorHex: user.colorHex,
          stravaAthleteId: user.stravaAthleteId,
          stravaConnected: Boolean(user.stravaAthleteId && user.refreshToken),
        },
      },
      { status: 200 }
    );

    const isHttps = new URL(request.url).protocol === 'https:';
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (err) {
    console.error('[INTVL 2.0 Login Error]:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Login failed.',
      },
      { status: 500 }
    );
  }
}
