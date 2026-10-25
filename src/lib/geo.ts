import * as turf from '@turf/turf';
import * as h3 from 'h3-js';
import type {
  Feature,
  FeatureCollection,
  LineString,
  Polygon,
  MultiPolygon,
  Position,
} from 'geojson';

export const H3_CONQUEST_RESOLUTION = 9;
export const LOOP_CLOSURE_THRESHOLD_METERS = 150;
export const INTERNAL_LOOP_THRESHOLD_METERS = 100;
export const MIN_LOOP_PATH_DISTANCE_METERS = 180;
export const CORRIDOR_BUFFER_METERS = 25;
export const RDP_SIMPLIFY_TOLERANCE = 0.000045; // ~5m tolerance in degrees

export type CaptureMode = 'loop' | 'corridor';

export type LoopDetectionStatus =
  | 'valid_start_end_loop'
  | 'valid_internal_loop'
  | 'forced_loop'
  | 'open_corridor';

export interface ProcessActivityOptions {
  forceLoop?: boolean;
  captureModeOverride?: CaptureMode;
}

export interface ProcessedTerritoryResult {
  captureMode: CaptureMode;
  isAutoLoop: boolean;
  detectionStatus: LoopDetectionStatus;
  detectionReason: string;
  pointsProcessed: number;
  simplifiedPointsCount: number;
  h3Indices: string[];
  areaKm2: number;
  distanceMeters: number;
  closureDistanceMeters: number | null;
  internalClosureDistanceMeters: number | null;
  loopPreviewCellsCount: number;
  loopPreviewAreaKm2: number;
  corridorPreviewCellsCount: number;
  corridorPreviewAreaKm2: number;
  simplifiedRouteGeoJSON: LineString;
  capturePolygonGeoJSON: Polygon | MultiPolygon | null;
  startLat: number;
  startLng: number;
  centroid: [number, number]; // [lng, lat]
  bbox: [number, number, number, number];
}

export interface TerritoryFeatureProperties {
  h3Index: string;
  roundId: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  ownerColor: string;
  activityId: string;
  activityName: string;
  captureMode: CaptureMode;
  capturedAt: string;
  areaKm2: number;
}

/**
 * Decodes a Google-encoded polyline string (such as Strava's `map.summary_polyline`)
 * into an array of `[lat, lng]` coordinate pairs.
 */
export function decodePolyline(encoded: string): [number, number][] {
  if (!encoded || typeof encoded !== 'string') return [];

  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index <= len);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index <= len);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/**
 * Sanitizes raw Strava [lat, lng] coordinate streams, removing NaNs, out-of-range coordinates,
 * consecutive duplicate GPS readings, and micro-jitter (< 1.5m).
 */
export function sanitizeLatLngStream(rawLatLngs: [number, number][]): [number, number][] {
  if (!Array.isArray(rawLatLngs)) return [];

  const cleaned: [number, number][] = [];
  for (const pair of rawLatLngs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lat = Number(pair[0]);
    const lng = Number(pair[1]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      continue;
    }

    if (cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.abs(prev[0] - lat) < 1e-6 && Math.abs(prev[1] - lng) < 1e-6) {
        continue;
      }
    }
    cleaned.push([lat, lng]);
  }

  return cleaned;
}

/**
 * Removes hairpin backtrack spikes (A -> B -> C where A and C are within ~4 meters)
 * and near-duplicate vertices so polygon construction & `turf.unkinkPolygon` do not fail
 * on street turnarounds or crosswalk pauses.
 */
function removeSpikesAndDuplicates(coords: Position[]): Position[] {
  if (coords.length < 4) return coords;

  const deduped: Position[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = coords[i];
    if (
      Math.abs(prev[0] - curr[0]) < 0.000018 &&
      Math.abs(prev[1] - curr[1]) < 0.000018
    ) {
      continue;
    }
    deduped.push(curr);
  }

  if (deduped.length < 4) return coords;

  const despiked: Position[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const curr = deduped[i];
    if (despiked.length >= 2) {
      const prev2 = despiked[despiked.length - 2];
      const d = turf.distance(turf.point(prev2), turf.point(curr), {
        units: 'meters',
      });
      if (d < 4.5) {
        // Pop the spike tip (`despiked[despiked.length - 1]`)
        despiked.pop();
        continue;
      }
    }
    despiked.push(curr);
  }

  return despiked.length >= 4 ? despiked : deduped;
}

/**
 * Ensures a GeoJSON LinearRing is properly closed (first === last vertex) and has at least 4 positions.
 */
function ensureClosedRing(coords: Position[]): Position[] {
  if (coords.length === 0) return [];
  const ring = coords.map((pt) => [pt[0], pt[1]]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/**
 * Computes the unsigned 2D planar area (in m²) and compactness ratio ($4\pi A / P^2$)
 * of a candidate ring so we can distinguish genuine 2D loops from thin out-and-back street lines.
 */
function evaluateRingGeometry(ringCoords: Position[]): {
  areaMeters2: number;
  perimeterMeters: number;
  isGenuine2DLoop: boolean;
} {
  const closed = ensureClosedRing(ringCoords);
  if (closed.length < 4) {
    return { areaMeters2: 0, perimeterMeters: 0, isGenuine2DLoop: false };
  }

  try {
    const line = turf.lineString(closed);
    const perimeterMeters = turf.length(line, { units: 'meters' });
    const poly = turf.polygon([closed]);
    let areaMeters2 = 0;

    try {
      const unkinked = turf.unkinkPolygon(poly);
      for (const f of unkinked.features) {
        areaMeters2 += turf.area(f);
      }
    } catch {
      areaMeters2 = turf.area(poly);
    }

    // Compactness / isoperimetric quotient: 1.0 for a circle, ~0 for a flat out-and-back line
    const compactness =
      perimeterMeters > 0
        ? (4 * Math.PI * areaMeters2) / (perimeterMeters * perimeterMeters)
        : 0;

    // A genuine loop encloses at least 1,200 m² and isn't a paper-thin 1D backtrack sliver
    const isGenuine2DLoop = areaMeters2 >= 1200 && compactness >= 0.025;
    return { areaMeters2, perimeterMeters, isGenuine2DLoop };
  } catch {
    return { areaMeters2: 0, perimeterMeters: 0, isGenuine2DLoop: false };
  }
}

/**
 * Extracts all H3 resolution 9 cells along a sequence of GeoJSON [lng, lat] coordinates,
 * using `gridPathCells` between consecutive cells to guarantee continuous connectivity.
 */
function rasterizeLineToH3Cells(
  lngLatCoords: Position[],
  resolution = H3_CONQUEST_RESOLUTION
): Set<string> {
  const cellSet = new Set<string>();
  let prevCell: string | null = null;

  for (const coord of lngLatCoords) {
    const [lng, lat] = coord;
    const currentCell = h3.latLngToCell(lat, lng, resolution);
    cellSet.add(currentCell);

    if (prevCell && prevCell !== currentCell) {
      try {
        const pathCells = h3.gridPathCells(prevCell, currentCell);
        for (const c of pathCells) {
          cellSet.add(c);
        }
      } catch {
        const prevCoord = h3.cellToLatLng(prevCell);
        const steps = 6;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const interpLat = prevCoord[0] + (lat - prevCoord[0]) * t;
          const interpLng = prevCoord[1] + (lng - prevCoord[1]) * t;
          cellSet.add(h3.latLngToCell(interpLat, interpLng, resolution));
        }
      }
    }
    prevCell = currentCell;
  }

  return cellSet;
}

/**
 * Resilient Loop Detection Engine:
 * 1. Primary endpoint check: Start and Finish meet within `LOOP_CLOSURE_THRESHOLD_METERS` (150m).
 * 2. Internal sub-loop check: Any two vertices along the route come within `INTERNAL_LOOP_THRESHOLD_METERS` (100m)
 *    with at least `MIN_LOOP_PATH_DISTANCE_METERS` (180m) of path between them and enclose a genuine 2D area
 *    (handling lollipop / stem-and-loop routes and overlapping start/end extensions).
 */
function detectClosedLoopRings(lngLatCoords: Position[]): {
  isLoop: boolean;
  status: LoopDetectionStatus;
  reason: string;
  loopRings: Position[][];
  closureDistanceMeters: number | null;
  internalClosureDistanceMeters: number | null;
} {
  if (lngLatCoords.length < 4) {
    return {
      isLoop: false,
      status: 'open_corridor',
      reason: `Too few GPS points (${lngLatCoords.length} pts)`,
      loopRings: [],
      closureDistanceMeters: null,
      internalClosureDistanceMeters: null,
    };
  }

  const cumulativeDist: number[] = [0];
  for (let i = 1; i < lngLatCoords.length; i++) {
    const segDist = turf.distance(
      turf.point(lngLatCoords[i - 1]),
      turf.point(lngLatCoords[i]),
      { units: 'meters' }
    );
    cumulativeDist.push(cumulativeDist[i - 1] + segDist);
  }

  const totalPathDistance = cumulativeDist[cumulativeDist.length - 1];
  const startPt = turf.point(lngLatCoords[0]);
  const endPt = turf.point(lngLatCoords[lngLatCoords.length - 1]);
  const startEndDist = turf.distance(startPt, endPt, { units: 'meters' });

  if (totalPathDistance < MIN_LOOP_PATH_DISTANCE_METERS) {
    return {
      isLoop: false,
      status: 'open_corridor',
      reason: `Route distance (${Math.round(totalPathDistance)}m) is shorter than minimum ${MIN_LOOP_PATH_DISTANCE_METERS}m loop perimeter`,
      loopRings: [],
      closureDistanceMeters: startEndDist,
      internalClosureDistanceMeters: null,
    };
  }

  // 1. Check primary start-to-end closure within 150m
  if (startEndDist <= LOOP_CLOSURE_THRESHOLD_METERS) {
    const closedRing = ensureClosedRing(removeSpikesAndDuplicates(lngLatCoords));
    if (closedRing.length >= 4) {
      return {
        isLoop: true,
        status: 'valid_start_end_loop',
        reason: `Start & finish meet within ${Math.round(startEndDist)}m (≤${LOOP_CLOSURE_THRESHOLD_METERS}m threshold)`,
        loopRings: [closedRing],
        closureDistanceMeters: startEndDist,
        internalClosureDistanceMeters: startEndDist,
      };
    }
  }

  // 2. Inspect for internal closed loops (e.g. stem-and-loop / lollipop route or cul-de-sac extension)
  // Downsample index step slightly if > 250 vertices for fast O(N^2) scanning
  const n = lngLatCoords.length;
  const step = n > 300 ? Math.ceil(n / 250) : 1;

  let bestStartIdx = -1;
  let bestEndIdx = -1;
  let bestAreaMeters2 = 0;
  let bestInternalGap: number | null = null;
  let minObservedInternalGap: number | null = null;

  for (let i = 0; i < n - 3; i += step) {
    for (let j = n - 1; j > i + 2; j -= step) {
      const pathSpan = cumulativeDist[j] - cumulativeDist[i];
      if (pathSpan < MIN_LOOP_PATH_DISTANCE_METERS) {
        break;
      }

      const d = turf.distance(
        turf.point(lngLatCoords[i]),
        turf.point(lngLatCoords[j]),
        { units: 'meters' }
      );

      if (minObservedInternalGap === null || d < minObservedInternalGap) {
        minObservedInternalGap = d;
      }

      if (d <= INTERNAL_LOOP_THRESHOLD_METERS) {
        const candidateSub = lngLatCoords.slice(i, j + 1);
        const geomCheck = evaluateRingGeometry(candidateSub);
        if (geomCheck.isGenuine2DLoop && geomCheck.areaMeters2 > bestAreaMeters2) {
          bestAreaMeters2 = geomCheck.areaMeters2;
          bestStartIdx = i;
          bestEndIdx = j;
          bestInternalGap = d;
        }
      }
    }
  }

  if (bestStartIdx !== -1 && bestEndIdx !== -1 && bestInternalGap !== null) {
    const subSegment = lngLatCoords.slice(bestStartIdx, bestEndIdx + 1);
    const closedRing = ensureClosedRing(removeSpikesAndDuplicates(subSegment));
    if (closedRing.length >= 4) {
      return {
        isLoop: true,
        status: 'valid_internal_loop',
        reason: `Internal closed loop detected (${Math.round(bestInternalGap)}m closure gap, start/end gap ${Math.round(startEndDist)}m)`,
        loopRings: [closedRing],
        closureDistanceMeters: startEndDist,
        internalClosureDistanceMeters: bestInternalGap,
      };
    }
  }

  return {
    isLoop: false,
    status: 'open_corridor',
    reason: `Start/End gap is ${Math.round(startEndDist)}m (exceeds ${LOOP_CLOSURE_THRESHOLD_METERS}m loop threshold)`,
    loopRings: [],
    closureDistanceMeters: startEndDist,
    internalClosureDistanceMeters: minObservedInternalGap,
  };
}

/**
 * Safely unkinks a potentially self-intersecting polygon ring into simple, non-self-intersecting
 * `Feature<Polygon>[]` pieces using adaptive simplification fallbacks if `turf.unkinkPolygon`
 * encounters collinear overlapping segments or vertex-on-edge kinks.
 */
function safeUnkinkRing(rawRing: Position[]): Feature<Polygon>[] {
  const cleaned = removeSpikesAndDuplicates(rawRing);
  const closedRing = ensureClosedRing(cleaned);
  if (closedRing.length < 4) return [];

  const candidatePoly = turf.polygon([closedRing]);

  // Attempt 1: Direct unkink on cleaned ring
  try {
    const unkinked = turf.unkinkPolygon(candidatePoly);
    const valid = unkinked.features.filter(
      (f) =>
        f.geometry.coordinates.length > 0 &&
        f.geometry.coordinates[0].length >= 4 &&
        turf.area(f) > 25
    );
    if (valid.length > 0) return valid;
  } catch {
    // Proceed to adaptive simplification fallback
  }

  // Attempt 2: Adaptive Ramer-Douglas-Peucker simplification to remove micro-kinks
  const tolerances = [0.00008, 0.00015, 0.0003];
  for (const tol of tolerances) {
    try {
      const simplifiedLine = turf.simplify(turf.lineString(closedRing), {
        tolerance: tol,
        highQuality: true,
      });
      const simpRing = ensureClosedRing(simplifiedLine.geometry.coordinates);
      if (simpRing.length < 4) continue;
      const simpPoly = turf.polygon([simpRing]);
      const unkinked = turf.unkinkPolygon(simpPoly);
      const valid = unkinked.features.filter(
        (f) =>
          f.geometry.coordinates.length > 0 &&
          f.geometry.coordinates[0].length >= 4 &&
          turf.area(f) > 25
      );
      if (valid.length > 0) return valid;
    } catch {
      continue;
    }
  }

  // Attempt 3: Convex hull / raw polygon fallback so we never fail completely
  try {
    if (turf.area(candidatePoly) > 25) {
      return [candidatePoly];
    }
  } catch {
    // Ignore
  }

  try {
    const hull = turf.convex(turf.lineString(closedRing));
    if (hull) return [hull];
  } catch {
    // Ignore
  }

  return [candidatePoly];
}

/**
 * Validates and unkinks closed loop rings with `@turf/turf`, and fills the interior
 * with Uber H3 Resolution 9 cells via `h3.polygonToCells(coords, 9, true)` plus
 * perimeter & 1-ring point-in-polygon verification so small/medium loops never miss interior hexes.
 */
function extractH3CellsFromLoopRings(
  loopRings: Position[][],
  fullTrackCoords: Position[]
): { cells: Set<string>; validPolygon: Polygon | MultiPolygon | null } {
  const capturedCells = rasterizeLineToH3Cells(
    fullTrackCoords,
    H3_CONQUEST_RESOLUTION
  );
  const validPolygons: Position[][][] = [];

  // Also include the 25m corridor cells along the track itself so the loop boundary is solid
  try {
    const corridorCells = extractH3CellsFromCorridor(
      turf.lineString(fullTrackCoords)
    );
    for (const c of corridorCells.cells) {
      capturedCells.add(c);
    }
  } catch {
    // Ignore
  }

  for (const rawRing of loopRings) {
    const simplePolygons = safeUnkinkRing(rawRing);

    for (const polyFeature of simplePolygons) {
      const polyCoords = polyFeature.geometry.coordinates;
      if (!polyCoords || polyCoords.length === 0 || polyCoords[0].length < 4) {
        continue;
      }

      validPolygons.push(polyCoords);

      // 1. Primary H3 polygonToCells fill
      try {
        const interiorCells = h3.polygonToCells(
          polyCoords,
          H3_CONQUEST_RESOLUTION,
          true
        );
        for (const cell of interiorCells) {
          capturedCells.add(cell);
        }
      } catch {
        try {
          const outerCells = h3.polygonToCells(
            polyCoords[0],
            H3_CONQUEST_RESOLUTION,
            true
          );
          for (const cell of outerCells) {
            capturedCells.add(cell);
          }
        } catch {
          // Fallback handled below
        }
      }

      // 2. Ensure centroid and interior point-on-surface cells are captured
      try {
        const centroidPt = turf.centroid(polyFeature);
        const [cLng, cLat] = centroidPt.geometry.coordinates;
        if (turf.booleanPointInPolygon(centroidPt, polyFeature)) {
          capturedCells.add(
            h3.latLngToCell(cLat, cLng, H3_CONQUEST_RESOLUTION)
          );
        }
      } catch {
        // Ignore
      }

      try {
        const surfacePt = turf.pointOnFeature(polyFeature);
        const [sLng, sLat] = surfacePt.geometry.coordinates;
        capturedCells.add(h3.latLngToCell(sLat, sLng, H3_CONQUEST_RESOLUTION));
      } catch {
        // Ignore
      }

      // 3. Rasterize the closed ring boundary (including any closing bridge segment)
      const perimeterCells = rasterizeLineToH3Cells(
        polyCoords[0],
        H3_CONQUEST_RESOLUTION
      );
      for (const pCell of perimeterCells) {
        capturedCells.add(pCell);
      }

      // 4. Check 1-ring neighbors of perimeter cells for interior containment
      // (ensures small/medium loops whose interior falls between H3 centers still fill completely)
      for (const pCell of perimeterCells) {
        try {
          const disk = h3.gridDisk(pCell, 1);
          for (const neighbor of disk) {
            if (capturedCells.has(neighbor)) continue;
            const [nLat, nLng] = h3.cellToLatLng(neighbor);
            if (
              turf.booleanPointInPolygon(turf.point([nLng, nLat]), polyFeature)
            ) {
              capturedCells.add(neighbor);
            }
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  let validPolygon: Polygon | MultiPolygon | null = null;
  if (validPolygons.length === 1) {
    validPolygon = {
      type: 'Polygon',
      coordinates: validPolygons[0],
    };
  } else if (validPolygons.length > 1) {
    validPolygon = {
      type: 'MultiPolygon',
      coordinates: validPolygons,
    };
  }

  return { cells: capturedCells, validPolygon };
}

/**
 * Corridor Fallback:
 * Converts the route into a Turf LineString, buffers it by 25 meters (`turf.buffer`),
 * and converts the corridor polygon into H3 cells using `h3.polygonToCells(corridor, 9, true)`.
 */
function extractH3CellsFromCorridor(
  simplifiedLine: Feature<LineString>
): { cells: Set<string>; corridorPolygon: Polygon | MultiPolygon | null } {
  const coords = simplifiedLine.geometry.coordinates;
  const capturedCells = rasterizeLineToH3Cells(coords, H3_CONQUEST_RESOLUTION);
  let corridorPolygon: Polygon | MultiPolygon | null = null;

  try {
    const buffered = turf.buffer(simplifiedLine, CORRIDOR_BUFFER_METERS, {
      units: 'meters',
      steps: 12,
    });

    if (buffered && buffered.geometry) {
      corridorPolygon = buffered.geometry;

      if (buffered.geometry.type === 'Polygon') {
        const polyCoords = buffered.geometry.coordinates;
        const polyCells = h3.polygonToCells(
          polyCoords,
          H3_CONQUEST_RESOLUTION,
          true
        );
        for (const cell of polyCells) {
          capturedCells.add(cell);
        }
        for (const pt of polyCoords[0]) {
          capturedCells.add(
            h3.latLngToCell(pt[1], pt[0], H3_CONQUEST_RESOLUTION)
          );
        }
      } else if (buffered.geometry.type === 'MultiPolygon') {
        for (const polyCoords of buffered.geometry.coordinates) {
          const polyCells = h3.polygonToCells(
            polyCoords,
            H3_CONQUEST_RESOLUTION,
            true
          );
          for (const cell of polyCells) {
            capturedCells.add(cell);
          }
          for (const pt of polyCoords[0]) {
            capturedCells.add(
              h3.latLngToCell(pt[1], pt[0], H3_CONQUEST_RESOLUTION)
            );
          }
        }
      }
    }
  } catch {
    // Fallback if buffer encounters degenerate geometry
  }

  return { cells: capturedCells, corridorPolygon };
}

/**
 * Calculates total surface area in km² for a list of H3 cell indices.
 */
export function calculateH3CellsAreaKm2(h3Indices: string[]): number {
  let totalArea = 0;
  for (const index of h3Indices) {
    if (h3.isValidCell(index)) {
      totalArea += h3.cellArea(index, 'km2');
    }
  }
  return Number(totalArea.toFixed(4));
}

/**
 * Primary Territory Capture & Steal Spatial Engine:
 * Takes a raw Strava `[lat, lng][]` GPS stream, simplifies via Ramer-Douglas-Peucker,
 * detects 150m start/end or 100m internal loop closures, supports manual `forceLoop` or
 * `captureModeOverride: 'loop' | 'corridor'`, and returns all captured H3 Resolution 9 cells
 * along with rich diagnostic telemetry for the Sync Review Modal.
 */
export function processActivityCoordinates(
  rawLatLngStream: [number, number][],
  options?: ProcessActivityOptions
): ProcessedTerritoryResult {
  const sanitized = sanitizeLatLngStream(rawLatLngStream);

  if (sanitized.length === 0) {
    throw new Error('Activity GPS stream contains no valid coordinates.');
  }

  if (sanitized.length === 1) {
    const [lat, lng] = sanitized[0];
    const singleCell = h3.latLngToCell(lat, lng, H3_CONQUEST_RESOLUTION);
    const singleArea = calculateH3CellsAreaKm2([singleCell]);
    const lineGeoJSON: LineString = {
      type: 'LineString',
      coordinates: [
        [lng, lat],
        [lng, lat],
      ],
    };
    return {
      captureMode: 'corridor',
      isAutoLoop: false,
      detectionStatus: 'open_corridor',
      detectionReason: 'Single GPS coordinate recorded',
      pointsProcessed: 1,
      simplifiedPointsCount: 1,
      h3Indices: [singleCell],
      areaKm2: singleArea,
      distanceMeters: 0,
      closureDistanceMeters: 0,
      internalClosureDistanceMeters: null,
      loopPreviewCellsCount: 1,
      loopPreviewAreaKm2: singleArea,
      corridorPreviewCellsCount: 1,
      corridorPreviewAreaKm2: singleArea,
      simplifiedRouteGeoJSON: lineGeoJSON,
      capturePolygonGeoJSON: null,
      startLat: lat,
      startLng: lng,
      centroid: [lng, lat],
      bbox: [lng, lat, lng, lat],
    };
  }

  const rawLngLat: Position[] = sanitized.map(([lat, lng]) => [lng, lat]);
  const rawLineFeature = turf.lineString(rawLngLat);
  const distanceMeters = Number(
    turf.length(rawLineFeature, { units: 'meters' }).toFixed(1)
  );

  const simplifiedFeature = turf.simplify(rawLineFeature, {
    tolerance: RDP_SIMPLIFY_TOLERANCE,
    highQuality: true,
  });

  const simplifiedCoords =
    simplifiedFeature.geometry.coordinates.length >= 2
      ? simplifiedFeature.geometry.coordinates
      : rawLngLat;

  const loopDetection = detectClosedLoopRings(simplifiedCoords);

  // Compute both Loop (auto or forced) and Corridor extractions so UI can preview both yields
  const candidateLoopRings =
    loopDetection.loopRings.length > 0
      ? loopDetection.loopRings
      : [ensureClosedRing(simplifiedCoords)];

  const loopExtraction = extractH3CellsFromLoopRings(
    candidateLoopRings,
    simplifiedCoords
  );
  const validLoopIndices = Array.from(loopExtraction.cells).filter((idx) =>
    h3.isValidCell(idx)
  );
  const loopAreaKm2 = calculateH3CellsAreaKm2(validLoopIndices);

  const corridorExtraction = extractH3CellsFromCorridor(simplifiedFeature);
  const validCorridorIndices = Array.from(corridorExtraction.cells).filter(
    (idx) => h3.isValidCell(idx)
  );
  const corridorAreaKm2 = calculateH3CellsAreaKm2(validCorridorIndices);

  // Determine effective captureMode based on options (`forceLoop` / `captureModeOverride`) or auto-detection
  const wantsForceLoop =
    options?.forceLoop === true || options?.captureModeOverride === 'loop';
  const wantsCorridor =
    options?.captureModeOverride === 'corridor' && !options?.forceLoop;

  let captureMode: CaptureMode;
  let detectionStatus: LoopDetectionStatus = loopDetection.status;
  let detectionReason: string = loopDetection.reason;
  let h3Indices: string[];
  let areaKm2: number;
  let capturePolygonGeoJSON: Polygon | MultiPolygon | null;

  if (wantsCorridor) {
    captureMode = 'corridor';
    h3Indices = validCorridorIndices;
    areaKm2 = corridorAreaKm2;
    capturePolygonGeoJSON = corridorExtraction.corridorPolygon;
  } else if (loopDetection.isLoop || wantsForceLoop) {
    captureMode = 'loop';
    h3Indices = validLoopIndices;
    areaKm2 = loopAreaKm2;
    capturePolygonGeoJSON = loopExtraction.validPolygon;
    if (!loopDetection.isLoop && wantsForceLoop) {
      detectionStatus = 'forced_loop';
      detectionReason = `Forced Loop Override (bridged ${Math.round(
        loopDetection.closureDistanceMeters ?? 0
      )}m start/end gap)`;
    }
  } else {
    captureMode = 'corridor';
    h3Indices = validCorridorIndices;
    areaKm2 = corridorAreaKm2;
    capturePolygonGeoJSON = corridorExtraction.corridorPolygon;
  }

  const centroidFeature = turf.centroid(simplifiedFeature);
  const bbox = turf.bbox(simplifiedFeature) as [number, number, number, number];

  return {
    captureMode,
    isAutoLoop: loopDetection.isLoop,
    detectionStatus,
    detectionReason,
    pointsProcessed: sanitized.length,
    simplifiedPointsCount: simplifiedCoords.length,
    h3Indices,
    areaKm2,
    distanceMeters,
    closureDistanceMeters:
      loopDetection.closureDistanceMeters !== null
        ? Number(loopDetection.closureDistanceMeters.toFixed(1))
        : null,
    internalClosureDistanceMeters:
      loopDetection.internalClosureDistanceMeters !== null
        ? Number(loopDetection.internalClosureDistanceMeters.toFixed(1))
        : null,
    loopPreviewCellsCount: validLoopIndices.length,
    loopPreviewAreaKm2: loopAreaKm2,
    corridorPreviewCellsCount: validCorridorIndices.length,
    corridorPreviewAreaKm2: corridorAreaKm2,
    simplifiedRouteGeoJSON: simplifiedFeature.geometry,
    capturePolygonGeoJSON,
    startLat: sanitized[0][0],
    startLng: sanitized[0][1],
    centroid: [
      centroidFeature.geometry.coordinates[0],
      centroidFeature.geometry.coordinates[1],
    ],
    bbox,
  };
}

/**
 * Converts an array of territory rows into a GeoJSON FeatureCollection of H3 Hex Polygons
 * using `h3.cellToBoundary(h3Index, true)`.
 */
export function territoriesToGeoJSON(
  records: TerritoryFeatureProperties[]
): FeatureCollection<Polygon, TerritoryFeatureProperties> {
  const features: Feature<Polygon, TerritoryFeatureProperties>[] = [];

  for (const record of records) {
    if (!h3.isValidCell(record.h3Index)) continue;

    const boundary = h3.cellToBoundary(record.h3Index, true);
    const closedRing = ensureClosedRing(boundary);
    const areaKm2 = Number(h3.cellArea(record.h3Index, 'km2').toFixed(4));

    features.push({
      type: 'Feature',
      id: record.h3Index,
      properties: {
        ...record,
        areaKm2,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing],
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
