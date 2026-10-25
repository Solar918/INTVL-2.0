import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByUsername } from '@/lib/d1';
import {
  encodeSessionCookie,
  hashPassword,
  SESSION_COOKIE_NAME,
} from '@/lib/auth';
import { normalizePlayerColor } from '@/lib/utils';

export const runtime = 'edge';

interface RegisterRequestBody {
  username?: string;
  displayName?: string;
  bio?: string;
  password?: string;
  colorHex?: string;
}

/**
 * POST /api/auth/register
 * Registers a new player account:
 * - Normalizes login username (trimmed, lowercase, 3-24 chars)
 * - Stores customizable public displayName (decoupled from login credentials)
 * - Hashes password using Web Crypto PBKDF2-SHA256
 * - Assigns chosen signature neon color
 * - Sets HTTP-only session cookie
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as RegisterRequestBody;
    const rawUsername = (body.username ?? '').trim().toLowerCase();
    const displayName = (body.displayName ?? '').trim() || rawUsername;
    const bio = (body.bio ?? '').trim();
    const password = body.password ?? '';
    const colorHex = normalizePlayerColor(body.colorHex);

    if (!rawUsername || rawUsername.length < 3 || rawUsername.length > 24) {
      return NextResponse.json(
        { error: 'Username must be between 3 and 24 characters.' },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9_.-]+$/.test(rawUsername)) {
      return NextResponse.json(
        {
          error:
            'Username may only contain lowercase letters, numbers, underscores, dots, and hyphens.',
        },
        { status: 400 }
      );
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    const existing = await getUserByUsername(rawUsername);
    if (existing) {
      return NextResponse.json(
        { error: `Username "${rawUsername}" is already taken.` },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({
      username: rawUsername,
      displayName: displayName.slice(0, 32),
      bio: bio.slice(0, 180),
      passwordHash,
      colorHex,
    });

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
      { status: 201 }
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
    console.error('[INTVL 2.0 Register Error]:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Registration failed.',
      },
      { status: 500 }
    );
  }
}
