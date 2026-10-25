import { NextRequest, NextResponse } from 'next/server';
import { getRecentActivityFeed } from '@/lib/d1';

export const runtime = 'edge';

/**
 * GET /api/activities
 * Returns the recent activity conquest feed for the requested (or active) round
 * with athlete displayName, capture mode, cells captured, cells stolen, and route GeoJSON.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const roundIdParam = url.searchParams.get('roundId');
    const limitParam = Number(url.searchParams.get('limit') || 25);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(1, limitParam), 100)
      : 25;

    const activities = await getRecentActivityFeed(roundIdParam, limit);

    return NextResponse.json(
      {
        activities,
        count: activities.length,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    console.error('[INTVL 2.0 Activities API Error]:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load activity feed.',
      },
      { status: 500 }
    );
  }
}
