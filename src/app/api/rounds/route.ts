import { NextRequest, NextResponse } from 'next/server';
import {
  createRound,
  getActiveOrSpecifiedRound,
  getAllRegisteredUsers,
  getAllRounds,
  updateRound,
} from '@/lib/d1';
import { getAuthenticatedUser } from '@/lib/strava';

export const runtime = 'edge';

/**
 * GET /api/rounds
 * Returns all rounds (active and archived), the currently active or requested round,
 * and the list of all registered players so rounds can be configured with specific participants.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const roundIdParam = url.searchParams.get('roundId');

    const [rounds, currentRound, registeredUsers] = await Promise.all([
      getAllRounds(),
      getActiveOrSpecifiedRound(roundIdParam),
      getAllRegisteredUsers(),
    ]);

    return NextResponse.json(
      {
        rounds,
        currentRound,
        registeredUsers,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    console.error('[INTVL 2.0 Rounds GET Error]:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load rounds.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rounds
 * Creates a new Round / Season and assigns the selected registered players as participants.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Please log in to create a new round.' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      name?: string;
      description?: string;
      participantUserIds?: string[];
      endsAt?: string | null;
      setAsActive?: boolean;
    };

    const name = (body.name ?? '').trim();
    if (!name || name.length < 2 || name.length > 60) {
      return NextResponse.json(
        { error: 'Round name must be between 2 and 60 characters.' },
        { status: 400 }
      );
    }

    const participantIds = Array.isArray(body.participantUserIds)
      ? body.participantUserIds
      : [user.id];

    const created = await createRound({
      name,
      description: body.description ?? '',
      createdBy: user.id,
      participantUserIds: participantIds,
      endsAt: body.endsAt ?? null,
      setAsActive: body.setAsActive ?? true,
    });

    const rounds = await getAllRounds();

    return NextResponse.json(
      {
        ok: true,
        round: created,
        rounds,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[INTVL 2.0 Rounds POST Error]:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to create round.',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/rounds
 * Updates an existing round (name, description, status 'active' | 'archived', endsAt, or participants).
 * Enforces that only the Round Admin (`created_by`) can modify governance settings.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Please log in to manage rounds.' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      roundId?: string;
      name?: string;
      description?: string;
      status?: 'active' | 'archived';
      endsAt?: string | null;
      participantUserIds?: string[];
    };

    if (!body.roundId) {
      return NextResponse.json(
        { error: 'Missing roundId parameter.' },
        { status: 400 }
      );
    }

    const existingRound = await getActiveOrSpecifiedRound(body.roundId);
    if (existingRound.createdBy && existingRound.createdBy !== user.id) {
      return NextResponse.json(
        {
          error:
            'Only the round admin can modify round details, roster, or expiration settings.',
        },
        { status: 403 }
      );
    }

    const updated = await updateRound({
      roundId: body.roundId,
      name: body.name,
      description: body.description,
      status: body.status,
      endsAt: body.endsAt,
      participantUserIds: body.participantUserIds,
    });

    const rounds = await getAllRounds();

    return NextResponse.json({
      ok: true,
      round: updated,
      rounds,
    });
  } catch (err) {
    console.error('[INTVL 2.0 Rounds PATCH Error]:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to update round.',
      },
      { status: 500 }
    );
  }
}
