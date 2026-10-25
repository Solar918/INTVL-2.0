import { NextRequest, NextResponse } from 'next/server';
import { getAllRounds, getLeaderboardStandings } from '@/lib/d1';
import { getAuthenticatedUser, isStravaConfigured } from '@/lib/strava';

export const runtime = 'edge';

/**
 * GET /api/leaderboard
 * Ranks athletes in the requested (or active) round by total count of currently held H3 cells,
 * total kilometers, total area (km²), and activities count.
 * Also returns the active round metadata, all available rounds, and current session athlete metadata.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const roundIdParam = url.searchParams.get('roundId');

    const [
      { round, leaderboard, totalGridCells, totalGridAreaKm2 },
      allRounds,
      sessionUser,
    ] = await Promise.all([
      getLeaderboardStandings(roundIdParam),
      getAllRounds(),
      getAuthenticatedUser(request),
    ]);

    const currentAthlete = sessionUser
      ? leaderboard.find((entry) => entry.userId === sessionUser.id) ?? {
          rank: leaderboard.length + 1,
          userId: sessionUser.id,
          username: sessionUser.username,
          displayName: sessionUser.displayName,
          bio: sessionUser.bio,
          color: sessionUser.colorHex,
          stravaConnected: Boolean(
            sessionUser.stravaAthleteId && sessionUser.refreshToken
          ),
          stravaAthleteId: sessionUser.stravaAthleteId,
          activeCells: 0,
          activeAreaKm2: 0,
          dominancePercent: 0,
          totalDistanceKm: 0,
          activitiesCount: 0,
          totalCellsStolen: 0,
          lastActiveAt: null,
        }
      : null;

    return NextResponse.json(
      {
        round,
        rounds: allRounds,
        leaderboard,
        totalGridCells,
        totalGridAreaKm2,
        currentAthlete,
        isAuthenticated: Boolean(sessionUser),
        currentUserHome:
          sessionUser &&
          sessionUser.homeLat !== null &&
          sessionUser.homeLat !== undefined &&
          sessionUser.homeLng !== null &&
          sessionUser.homeLng !== undefined
            ? {
                lat: sessionUser.homeLat,
                lng: sessionUser.homeLng,
                zoom: sessionUser.homeZoom ?? 14,
              }
            : null,
        stravaConfigured: isStravaConfigured(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    console.error('[INTVL 2.0 Leaderboard API Error]:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to compute leaderboard.',
      },
      { status: 500 }
    );
  }
}
