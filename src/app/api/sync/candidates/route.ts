import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveOrSpecifiedRound,
  getImportedStravaActivityIdsForRound,
} from '@/lib/d1';
import {
  fetchAthleteActivitiesLastDays,
  fetchStravaActivityLatLngStream,
  getAuthenticatedUser,
  isEligibleConquestSport,
  refreshStravaAccessToken,
  type StravaSummaryActivity,
} from '@/lib/strava';
import {
  decodePolyline,
  processActivityCoordinates,
  type LoopDetectionStatus,
} from '@/lib/geo';

export const runtime = 'edge';

export interface StravaSyncCandidate {
  stravaActivityId: string;
  name: string;
  sportType: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  startedAt: string;
  isLoop: boolean;
  captureMode: 'loop' | 'corridor' | 'no_gps';
  detectionStatus: LoopDetectionStatus | 'no_gps';
  detectionReason: string;
  pointsProcessed: number;
  closureDistanceMeters: number | null;
  internalClosureDistanceMeters: number | null;
  estimatedCells: number;
  estimatedAreaKm2: number;
  loopPreviewCellsCount: number;
  loopPreviewAreaKm2: number;
  corridorPreviewCellsCount: number;
  corridorPreviewAreaKm2: number;
  routeGeojson: string | null;
  alreadyImportedInRound: boolean;
}

async function evaluateActivityCandidate(
  act: StravaSummaryActivity,
  accessToken: string,
  importedIds: Set<string>
): Promise<StravaSyncCandidate> {
  const stravaId = String(act.id);
  const encodedPoly = act.map?.summary_polyline || act.map?.polyline || '';

  let latLngs: [number, number][] = [];
  if (encodedPoly) {
    latLngs = decodePolyline(encodedPoly);
  }

  // Always fetch high-resolution GPS stream if summary_polyline is empty or has < 2 points
  // (e.g., when Strava Privacy Zones hide summary_polyline on the list endpoint)
  if (latLngs.length < 2) {
    try {
      const stream = await fetchStravaActivityLatLngStream(act.id, accessToken);
      if (stream && stream.length >= 2) {
        latLngs = stream;
      }
    } catch {
      // Activity has no GPS stream on Strava
    }
  }

  if (latLngs.length < 2) {
    return {
      stravaActivityId: stravaId,
      name: act.name || `Strava ${act.sport_type || 'Activity'}`,
      sportType: act.sport_type || act.type || 'Run',
      distanceMeters: Number(act.distance ?? 0),
      movingTimeSeconds: Number(act.moving_time ?? 0),
      startedAt: act.start_date,
      isLoop: false,
      captureMode: 'no_gps',
      detectionStatus: 'no_gps',
      detectionReason: 'No GPS coordinates recorded on this activity',
      pointsProcessed: latLngs.length,
      closureDistanceMeters: null,
      internalClosureDistanceMeters: null,
      estimatedCells: 0,
      estimatedAreaKm2: 0,
      loopPreviewCellsCount: 0,
      loopPreviewAreaKm2: 0,
      corridorPreviewCellsCount: 0,
      corridorPreviewAreaKm2: 0,
      routeGeojson: null,
      alreadyImportedInRound: importedIds.has(stravaId),
    };
  }

  let spatial = processActivityCoordinates(latLngs);

  // If we only used summary_polyline and it didn't auto-detect as a loop,
  // also check the full-resolution stream in case summary_polyline simplified away an internal loop
  if (!spatial.isAutoLoop && encodedPoly) {
    try {
      const fullStream = await fetchStravaActivityLatLngStream(
        act.id,
        accessToken
      );
      if (fullStream && fullStream.length > latLngs.length) {
        spatial = processActivityCoordinates(fullStream);
      }
    } catch {
      // Keep summary_polyline result
    }
  }

  const isLoop = spatial.isAutoLoop && spatial.loopPreviewCellsCount > 0;

  return {
    stravaActivityId: stravaId,
    name: act.name || `Strava ${act.sport_type || 'Run'}`,
    sportType: act.sport_type || act.type || 'Run',
    distanceMeters: Number(act.distance ?? spatial.distanceMeters),
    movingTimeSeconds: Number(act.moving_time ?? 0),
    startedAt: act.start_date,
    isLoop,
    captureMode: isLoop ? 'loop' : 'corridor',
    detectionStatus: spatial.detectionStatus,
    detectionReason: spatial.detectionReason,
    pointsProcessed: spatial.pointsProcessed,
    closureDistanceMeters: spatial.closureDistanceMeters,
    internalClosureDistanceMeters: spatial.internalClosureDistanceMeters,
    estimatedCells: isLoop
      ? spatial.loopPreviewCellsCount
      : spatial.corridorPreviewCellsCount,
    estimatedAreaKm2: isLoop
      ? spatial.loopPreviewAreaKm2
      : spatial.corridorPreviewAreaKm2,
    loopPreviewCellsCount: spatial.loopPreviewCellsCount,
    loopPreviewAreaKm2: spatial.loopPreviewAreaKm2,
    corridorPreviewCellsCount: spatial.corridorPreviewCellsCount,
    corridorPreviewAreaKm2: spatial.corridorPreviewAreaKm2,
    routeGeojson: JSON.stringify(spatial.simplifiedRouteGeoJSON),
    alreadyImportedInRound: importedIds.has(stravaId),
  };
}

/**
 * GET /api/sync/candidates
 * Fetches all walks, runs, and hikes recorded by the logged-in user in the past 30 days (newest first).
 * Evaluates each activity's GPS trajectory using the resilient 150m start/end & 100m internal
 * loop detector, returning both loop and 25m corridor cell estimates plus debug telemetry
 * for the interactive Activity Selection & Override Modal.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Please log in to scan your Strava activities.' },
        { status: 401 }
      );
    }

    if (!user.stravaAthleteId || !user.refreshToken) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Connect Strava first to scan your recent walks and runs.',
        },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const roundIdParam = url.searchParams.get('roundId');
    const daysParam = Number(url.searchParams.get('days') || 30);
    const days = Number.isFinite(daysParam)
      ? Math.min(Math.max(1, daysParam), 90)
      : 30;

    const targetRound = await getActiveOrSpecifiedRound(roundIdParam);
    const accessToken = await refreshStravaAccessToken(user);

    const recentActivities = await fetchAthleteActivitiesLastDays(
      accessToken,
      days
    );

    const eligibleActivities = recentActivities.filter((act) =>
      isEligibleConquestSport(act.sport_type, act.type)
    );

    const candidateIds = eligibleActivities.map((act) => String(act.id));
    const importedIds = await getImportedStravaActivityIdsForRound(
      targetRound.id,
      candidateIds
    );

    // Process candidates in concurrent batches of 6 so all activities get full GPS stream evaluation quickly
    const candidates: StravaSyncCandidate[] = [];
    const BATCH_CONCURRENCY = 6;
    for (let i = 0; i < eligibleActivities.length; i += BATCH_CONCURRENCY) {
      const batch = eligibleActivities.slice(i, i + BATCH_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((act) =>
          evaluateActivityCandidate(act, accessToken, importedIds)
        )
      );
      candidates.push(...batchResults);
    }

    const validLoopCount = candidates.filter((c) => c.isLoop).length;
    const nonLoopCount = candidates.filter((c) => !c.isLoop).length;

    return NextResponse.json({
      ok: true,
      daysScanned: days,
      round: targetRound,
      totalActivitiesFetched: recentActivities.length,
      eligibleSportCount: eligibleActivities.length,
      validLoopCount,
      nonLoopCount,
      candidates,
    });
  } catch (err) {
    console.error('[INTVL 2.0 Sync Candidates Error]:', err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to scan recent Strava activities.',
      },
      { status: 500 }
    );
  }
}
