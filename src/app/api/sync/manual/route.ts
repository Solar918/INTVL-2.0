import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveOrSpecifiedRound,
  getImportedStravaActivityIdsForRound,
  ingestActivityStream,
  isRoundLockedForIngestion,
  ROUND_CONCLUDED_ERROR_MESSAGE,
  type IngestActivityOutput,
} from '@/lib/d1';
import {
  fetchAthleteActivitiesLastDays,
  fetchStravaActivityDetail,
  fetchStravaActivityLatLngStream,
  getAuthenticatedUser,
  isEligibleConquestSport,
  refreshStravaAccessToken,
} from '@/lib/strava';
import {
  decodePolyline,
  processActivityCoordinates,
  type CaptureMode,
} from '@/lib/geo';

export const runtime = 'edge';

export interface ActivityImportOverride {
  forceLoop?: boolean;
  captureMode?: CaptureMode;
}

export interface ManualSyncRequestBody {
  activityIds?: string[];
  roundId?: string;
  forceLoop?: boolean;
  captureMode?: CaptureMode;
  activityOverrides?: Record<string, ActivityImportOverride>;
}

/**
 * POST /api/sync/manual
 * Imports the user's selected Strava activities into the specified (or active) Round:
 * 1. Authenticates the user session from the HTTP-only cookie.
 * 2. Verifies the target round is not concluded (`status !== 'archived'` and `now < ends_at`).
 * 3. Fetches high-resolution GPS streams for the selected `activityIds`.
 * 4. Honors optional `forceLoop` and `captureMode: "loop" | "corridor"` overrides (both global and per-activity)
 *    so the player is never locked out from claiming an activity as either a forced loop or a 25m corridor.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Please log in to sync your Strava activities.' },
        { status: 401 }
      );
    }

    let body: ManualSyncRequestBody = {};
    try {
      body = (await request.json()) as ManualSyncRequestBody;
    } catch {
      body = {};
    }

    const targetRound = await getActiveOrSpecifiedRound(body.roundId);
    if (isRoundLockedForIngestion(targetRound)) {
      return NextResponse.json(
        {
          ok: false,
          error: ROUND_CONCLUDED_ERROR_MESSAGE,
        },
        { status: 403 }
      );
    }

    if (!user.stravaAthleteId || !user.refreshToken) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Connect Strava to start claiming territory.',
        },
        { status: 400 }
      );
    }

    const accessToken = await refreshStravaAccessToken(user);
    const recentActivities = await fetchAthleteActivitiesLastDays(
      accessToken,
      30
    );

    const activityLookup = new Map(
      recentActivities.map((act) => [String(act.id), act])
    );

    const isExplicitSelection =
      Array.isArray(body.activityIds) && body.activityIds.length > 0;

    let targetActivityIds: string[];
    if (isExplicitSelection) {
      targetActivityIds = body.activityIds!.map((id) => String(id));
    } else {
      const eligible = recentActivities.filter((act) =>
        isEligibleConquestSport(act.sport_type, act.type)
      );
      const importedSet = await getImportedStravaActivityIdsForRound(
        targetRound.id,
        eligible.map((a) => String(a.id))
      );
      targetActivityIds = eligible
        .filter((act) => {
          if (importedSet.has(String(act.id))) return false;
          const poly = act.map?.summary_polyline || act.map?.polyline || '';
          if (!poly) return false;
          const coords = decodePolyline(poly);
          if (body.forceLoop || body.captureMode === 'corridor') return true;
          return processActivityCoordinates(coords).isAutoLoop;
        })
        .map((a) => String(a.id));
    }

    const processedResults: IngestActivityOutput[] = [];
    const skippedActivities: string[] = [];
    let totalNewCells = 0;
    let totalStolenCells = 0;

    for (const actId of targetActivityIds) {
      try {
        let actSummary = activityLookup.get(actId) ?? null;
        if (!actSummary) {
          actSummary = await fetchStravaActivityDetail(actId, accessToken);
        }

        if (
          !actSummary ||
          !isEligibleConquestSport(actSummary.sport_type, actSummary.type)
        ) {
          skippedActivities.push(actSummary?.name || actId);
          continue;
        }

        let latLngStream = await fetchStravaActivityLatLngStream(
          actId,
          accessToken
        );

        if (
          (!latLngStream || latLngStream.length < 2) &&
          actSummary?.map?.summary_polyline
        ) {
          latLngStream = decodePolyline(actSummary.map.summary_polyline);
        }

        if (!latLngStream || latLngStream.length < 2) {
          skippedActivities.push(actSummary?.name || actId);
          continue;
        }

        // Resolve per-activity or request-level override flags
        const itemOverride = body.activityOverrides?.[actId];
        const forceLoop =
          itemOverride?.forceLoop ??
          body.forceLoop ??
          (itemOverride?.captureMode === 'loop' || body.captureMode === 'loop');
        const captureModeOverride: CaptureMode | undefined =
          itemOverride?.captureMode ??
          body.captureMode ??
          (forceLoop ? 'loop' : undefined);

        const ingested = await ingestActivityStream({
          stravaActivityId: actId,
          roundId: targetRound.id,
          userId: user.id,
          name:
            actSummary?.name ||
            `Strava ${actSummary?.sport_type || 'Walk'}`,
          sportType: actSummary?.sport_type || actSummary?.type || 'Walk',
          distanceMeters: Number(actSummary?.distance ?? 0),
          movingTimeSeconds: Number(actSummary?.moving_time ?? 0),
          startedAt: actSummary?.start_date || new Date().toISOString(),
          latLngStream,
          requireClosedLoop: false,
          forceLoop,
          captureModeOverride,
        });

        processedResults.push(ingested);
        totalNewCells += ingested.cellsCaptured;
        totalStolenCells += ingested.cellsStolen;
      } catch (streamErr) {
        console.warn(
          `[INTVL 2.0 Manual Sync] Error processing activity ${actId}:`,
          streamErr
        );
        skippedActivities.push(actId);
      }
    }

    return NextResponse.json({
      ok: true,
      source: 'strava_api',
      roundId: targetRound.id,
      roundName: targetRound.name,
      scannedCount: recentActivities.length,
      requestedCount: targetActivityIds.length,
      ingestedCount: processedResults.length,
      skippedNonLoops: skippedActivities,
      totalCellsCaptured: totalNewCells,
      totalCellsStolen: totalStolenCells,
      activities: processedResults,
    });
  } catch (err) {
    console.error('[INTVL 2.0 Manual Sync Error]:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Manual Strava sync failed.',
      },
      { status: 500 }
    );
  }
}
