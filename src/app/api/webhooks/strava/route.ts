import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveOrSpecifiedRound,
  getUserByStravaAthleteId,
  ingestActivityStream,
  isRoundLockedForIngestion,
  ROUND_CONCLUDED_ERROR_MESSAGE,
} from '@/lib/d1';
import {
  fetchStravaActivityDetail,
  fetchStravaActivityLatLngStream,
  isEligibleConquestSport,
  refreshStravaAccessToken,
} from '@/lib/strava';
import { processActivityCoordinates } from '@/lib/geo';

export const runtime = 'edge';

export interface StravaWebhookEventPayload {
  object_type: 'activity' | 'athlete';
  object_id: number | string;
  aspect_type: 'create' | 'update' | 'delete';
  updates?: Record<string, unknown>;
  owner_id: number;
  subscription_id?: number;
  event_time?: number;
}

/**
 * GET /api/webhooks/strava
 * Handles the Strava Webhook Subscription Verification Challenge handshake.
 * Query params: `hub.mode`, `hub.verify_token`, `hub.challenge`
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const hubMode = searchParams.get('hub.mode');
  const hubVerifyToken = searchParams.get('hub.verify_token');
  const hubChallenge = searchParams.get('hub.challenge');

  const expectedVerifyToken =
    process.env.STRAVA_VERIFY_TOKEN || 'INTVL2_WEBHOOK_SECRET_2025';

  if (
    hubMode === 'subscribe' &&
    hubVerifyToken === expectedVerifyToken &&
    hubChallenge
  ) {
    return NextResponse.json({ 'hub.challenge': hubChallenge }, { status: 200 });
  }

  return NextResponse.json(
    {
      error: 'Webhook verification failed. Invalid hub.mode or hub.verify_token.',
    },
    { status: 403 }
  );
}

/**
 * POST /api/webhooks/strava
 * Processes incoming Strava activity creation events (`object_type: "activity"`, `aspect_type: "create"`):
 * 1. Queries D1 for the user where `strava_athlete_id = event.owner_id`.
 * 2. Verifies the active round is not concluded (`isRoundLockedForIngestion`).
 * 3. Refreshes that user's Strava OAuth access token via their stored refresh token.
 * 4. Queries `GET /api/v3/activities/{id}/streams?keys=latlng&key_by_type=true`.
 * 5. Evaluates if the GPS stream forms a closed loop; if so, assigns H3 cells to `user.id` in the active round.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: StravaWebhookEventPayload;

  try {
    payload = (await request.json()) as StravaWebhookEventPayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON webhook payload.' },
      { status: 400 }
    );
  }

  if (payload.object_type !== 'activity' || payload.aspect_type !== 'create') {
    return NextResponse.json(
      {
        acknowledged: true,
        ignored: true,
        reason: `Ignored event (${payload.object_type}:${payload.aspect_type})`,
      },
      { status: 200 }
    );
  }

  const stravaOwnerId = Number(payload.owner_id);
  const activityId = String(payload.object_id);

  if (!stravaOwnerId || !activityId) {
    return NextResponse.json(
      { error: 'Missing owner_id or object_id in Strava webhook event.' },
      { status: 400 }
    );
  }

  const earlySportType =
    typeof payload.updates?.sport_type === 'string'
      ? payload.updates.sport_type
      : typeof payload.updates?.type === 'string'
      ? payload.updates.type
      : null;

  if (earlySportType && !isEligibleConquestSport(earlySportType, earlySportType)) {
    return NextResponse.json(
      {
        acknowledged: true,
        processed: false,
        rejectedSportType: earlySportType,
        reason: `Activity type "${earlySportType}" rejected. Only Walk, Run, and Hike are accepted.`,
      },
      { status: 200 }
    );
  }

  try {
    const user = await getUserByStravaAthleteId(stravaOwnerId);
    if (!user) {
      return NextResponse.json(
        {
          acknowledged: true,
          processed: false,
          reason: `No registered INTVL 2.0 user linked to Strava athlete ID ${stravaOwnerId}.`,
        },
        { status: 200 }
      );
    }

    const activeRound = await getActiveOrSpecifiedRound();
    if (isRoundLockedForIngestion(activeRound)) {
      return NextResponse.json(
        {
          acknowledged: true,
          processed: false,
          reason: ROUND_CONCLUDED_ERROR_MESSAGE,
        },
        { status: 200 }
      );
    }

    const validAccessToken = await refreshStravaAccessToken(user);

    const [activityDetail, latLngStream] = await Promise.all([
      fetchStravaActivityDetail(activityId, validAccessToken),
      fetchStravaActivityLatLngStream(activityId, validAccessToken),
    ]);

    const rawSportType =
      activityDetail?.sport_type ||
      activityDetail?.type ||
      (typeof payload.updates?.sport_type === 'string'
        ? payload.updates.sport_type
        : typeof payload.updates?.type === 'string'
        ? payload.updates.type
        : null);

    if (
      !isEligibleConquestSport(
        activityDetail?.sport_type ?? rawSportType,
        activityDetail?.type ?? rawSportType
      )
    ) {
      return NextResponse.json(
        {
          acknowledged: true,
          processed: false,
          rejectedSportType: rawSportType ?? 'Unknown',
          reason: `Activity type "${
            rawSportType ?? 'Unknown'
          }" rejected. Only Walk, Run, and Hike are accepted.`,
        },
        { status: 200 }
      );
    }

    const activityName =
      activityDetail?.name ||
      (typeof payload.updates?.title === 'string'
        ? payload.updates.title
        : null) ||
      `Strava ${rawSportType || 'Walk'} #${activityId}`;
    const sportType =
      activityDetail?.sport_type || activityDetail?.type || rawSportType || 'Walk';
    const distanceMeters = Number(activityDetail?.distance ?? 0);
    const movingTimeSeconds = Number(activityDetail?.moving_time ?? 0);
    const startedAt =
      activityDetail?.start_date ||
      (payload.event_time
        ? new Date(payload.event_time * 1000).toISOString()
        : new Date().toISOString());

    if (!latLngStream || latLngStream.length < 2) {
      return NextResponse.json(
        {
          acknowledged: true,
          processed: false,
          reason: `Activity ${activityId} contains no GPS latlng stream.`,
        },
        { status: 200 }
      );
    }

    const captureSummary = await ingestActivityStream({
      stravaActivityId: activityId,
      roundId: activeRound.id,
      userId: user.id,
      name: activityName,
      sportType,
      distanceMeters,
      movingTimeSeconds,
      startedAt,
      latLngStream,
      requireClosedLoop: false,
    });

    return NextResponse.json(
      {
        acknowledged: true,
        processed: true,
        roundId: activeRound.id,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        capture: captureSummary,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[INTVL 2.0 Strava Webhook Error for activity ${activityId}]:`, err);
    return NextResponse.json(
      {
        acknowledged: true,
        processed: false,
        error: err instanceof Error ? err.message : 'Webhook processing error',
      },
      { status: 200 }
    );
  }
}
