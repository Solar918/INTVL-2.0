import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

export const runtime = 'edge';

/**
 * POST /api/auth/logout
 * Clears the HTTP-only session cookie.
 */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
