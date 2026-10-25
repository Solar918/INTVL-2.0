import { NextRequest, NextResponse } from 'next/server';
import { getAllTerritories } from '@/lib/d1';
import { territoriesToGeoJSON } from '@/lib/geo';

export const runtime = 'edge';

/**
 * GET /api/territories
 * Returns a GeoJSON FeatureCollection of all captured H3 Resolution 9 cells
 * for the requested (or currently active) round, converted to polygon boundaries via `h3.cellToBoundary`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const ownerFilter = url.searchParams.get('ownerId');
    const roundId = url.searchParams.get('roundId');

    let records = await getAllTerritories(roundId);
    if (ownerFilter) {
      records = records.filter((r) => r.ownerId === ownerFilter);
    }

    const featureCollection = territoriesToGeoJSON(records);

    return NextResponse.json(featureCollection, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    console.error('[INTVL 2.0 Territories API Error]:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to load H3 territory GeoJSON.',
      },
      { status: 500 }
    );
  }
}
