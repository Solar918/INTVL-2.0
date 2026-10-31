import { NextRequest, NextResponse } from 'next/server';
import {
  deleteActivityAndRollbackState,
  getLeaderboardStandings,
  getRecentActivityFeed,
  updateActivityCopilots,
} from '@/lib/d1';
import { getAuthenticatedUser } from '@/lib/strava';

export const runtime = 'edge';

/**
 * PATCH /api/activities/[id]
 * Updates the tagged co-walkers ("Walked with Friends" `copilotUserIds`) on an existing activity,
 * sharing ownership of its currently held H3 cells across all co-owners and updating leaderboard standings.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required to update co-walkers.' },
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

    let body: { copilotUserIds?: string[] } = {};
    try {
      body = (await request.json()) as { copilotUserIds?: string[] };
    } catch {
      body = {};
    }

    const copilotUserIds = Array.isArray(body.copilotUserIds)
      ? body.copilotUserIds.map((uid) => String(uid))
      : [];

    const updated = await updateActivityCopilots({
      activityId: id,
      requesterUserId: user.id,
      copilotUserIds,
    });

    const [standings, recentActivities] = await Promise.all([
      getLeaderboardStandings(updated.roundId),
      getRecentActivityFeed(updated.roundId, 25),
    ]);

    return NextResponse.json(
      {
        ok: true,
        updated,
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
            : 'Failed to update co-walkers on activity.',
      },
      { status: statusCode }
    );
  }
}

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
