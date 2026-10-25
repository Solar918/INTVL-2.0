import { NextRequest, NextResponse } from 'next/server';
import {
  deleteActivityAndRollbackState,
  getLeaderboardStandings,
  getRecentActivityFeed,
} from '@/lib/d1';
import { getAuthenticatedUser } from '@/lib/strava';

export const runtime = 'edge';

/**
 * DELETE /api/activities/[id]
 * Authenticates the session, verifies the requester is either the activity owner
 * or the round admin, deletes the activity from `activities`, and reverts each
 * affected H3 cell in `territories` to the most recent preceding valid activity
 * in the round (or deletes the cell if none).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required to delete an activity.' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Missing activity ID.' },
        { status: 400 }
      );
    }

    const rollbackResult = await deleteActivityAndRollbackState({
      activityId: id,
      requesterUserId: user.id,
    });

    const [standings, recentActivities] = await Promise.all([
      getLeaderboardStandings(rollbackResult.roundId),
      getRecentActivityFeed(rollbackResult.roundId, 25),
    ]);

    return NextResponse.json(
      {
        ok: true,
        rollback: rollbackResult,
        leaderboard: standings.leaderboard,
        totalGridCells: standings.totalGridCells,
        totalGridAreaKm2: standings.totalGridAreaKm2,
        recentActivities,
      },
      { status: 200 }
    );
  } catch (err) {
    const statusCode =
      (err as { statusCode?: number })?.statusCode &&
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;

    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to delete activity and revert territory state.',
      },
      { status: statusCode }
    );
  }
}
