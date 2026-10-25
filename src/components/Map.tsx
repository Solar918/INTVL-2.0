'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Polygon, LineString } from 'geojson';
import type { TerritoryFeatureProperties } from '@/lib/geo';
import type { ActivityFeedItem } from '@/lib/d1';
import {
  AUCKLAND_DEFAULT_CENTER,
  AUCKLAND_DEFAULT_ZOOM,
  formatRelativeTime,
} from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass,
  Crosshair,
  ExternalLink,
  Hexagon,
  Home,
  Layers,
  MapPin,
  Maximize2,
  Plus,
  Minus,
  Scan,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';

const CARTO_DARK_MATTER_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** Max gap (km) between hexes for them to count as the same "neighbourhood" cluster */
const CLUSTER_LINK_KM = 15;

/**
 * Computes [lng, lat] bounds for the claimed territories.
 * Hexes are grouped into geographic clusters (linked when within CLUSTER_LINK_KM of each other)
 * and the camera fits the largest cluster, so a single far-away activity (e.g. a holiday walk
 * hundreds of km north) can't stretch the view out to regional scale.
 * Handles Polygon / MultiPolygon, skips NaN points, and pads degenerate (zero-area) boxes.
 */
export function calculateTerritoryBounds(
  geojson: FeatureCollection | null | undefined
): maplibregl.LngLatBounds | null {
  if (!geojson || !geojson.features || geojson.features.length === 0) {
    return null;
  }

  const isValid = (lng: unknown, lat: unknown): lng is number =>
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lat as number) <= 90 &&
    Math.abs(lng) <= 180;

  // Collect valid [lng, lat] points per feature
  const featurePoints: [number, number][][] = [];
  const collectRing = (ring: unknown, out: [number, number][]) => {
    if (!Array.isArray(ring)) return;
    for (const coord of ring) {
      if (!Array.isArray(coord)) continue;
      const [lng, lat] = coord as number[];
      if (isValid(lng, lat)) out.push([lng, lat]);
    }
  };

  for (const feature of geojson.features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const pts: [number, number][] = [];
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) collectRing(ring, pts);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        for (const ring of poly) collectRing(ring, pts);
      }
    }
    if (pts.length > 0) featurePoints.push(pts);
  }

  if (featurePoints.length === 0) return null;

  // Union-find clustering on feature centroids
  const centroids = featurePoints.map((pts) => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return [sx / pts.length, sy / pts.length] as [number, number];
  });
  const parent = centroids.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const distKm = (a: [number, number], b: [number, number]) => {
    const dLat = (a[1] - b[1]) * 111;
    const dLng = (a[0] - b[0]) * 111 * Math.cos((a[1] * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  };
  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      if (distKm(centroids[i], centroids[j]) <= CLUSTER_LINK_KM) {
        parent[find(i)] = find(j);
      }
    }
  }
  const clusterSizes = new Map<number, number>();
  for (let i = 0; i < centroids.length; i++) {
    const root = find(i);
    clusterSizes.set(root, (clusterSizes.get(root) ?? 0) + 1);
  }
  let bestRoot = find(0);
  let bestSize = -1;
  for (const [root, size] of clusterSizes) {
    if (size > bestSize) {
      bestRoot = root;
      bestSize = size;
    }
  }

  const bounds = new maplibregl.LngLatBounds();
  featurePoints.forEach((pts, i) => {
    if (find(i) !== bestRoot) return;
    for (const p of pts) bounds.extend(p);
  });

  // Guard against zero-area boxes (sw === ne)
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  if (sw.lng === ne.lng && sw.lat === ne.lat) {
    bounds.extend([sw.lng - 0.002, sw.lat - 0.002]);
    bounds.extend([ne.lng + 0.002, ne.lat + 0.002]);
  }
  return bounds;
}

export interface HomeArea {
  lat: number;
  lng: number;
  zoom?: number;
}

export interface MapViewport {
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
}

export interface MapProps {
  roundId?: string | null;
  /** The round the supplied territoriesGeoJSON belongs to (prevents fitting on stale data) */
  territoriesRoundId?: string | null;
  territoriesGeoJSON: FeatureCollection<Polygon, TerritoryFeatureProperties> | null;
  focusedOwnerId: string | null;
  onClearOwnerFocus: () => void;
  selectedActivity: ActivityFeedItem | null;
  onClearSelectedActivity: () => void;
  flyToTarget: { lng: number; lat: number; zoom?: number; ts: number } | null;
  homeArea?: HomeArea | null;
  isAuthenticated?: boolean;
  latestActivityStart?: { lat: number; lng: number } | null;
  viewportRef?: React.MutableRefObject<MapViewport | null>;
}

export default function MapView({
  roundId,
  territoriesRoundId,
  territoriesGeoJSON,
  focusedOwnerId,
  onClearOwnerFocus,
  selectedActivity,
  onClearSelectedActivity,
  flyToTarget,
  homeArea,
  isAuthenticated,
  latestActivityStart,
  viewportRef,
}: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [is3DPitch, setIs3DPitch] = useState(true);
  const [inspectedCell, setInspectedCell] =
    useState<TerritoryFeatureProperties | null>(null);
  const lastFittedRoundRef = useRef<string | null>(null);
  const lastFittedHadFeaturesRef = useRef<boolean>(false);

  // Initialize MapLibre GL instance centered on Auckland, New Zealand
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: CARTO_DARK_MATTER_STYLE,
      center: AUCKLAND_DEFAULT_CENTER,
      zoom: AUCKLAND_DEFAULT_ZOOM,
      pitch: 36,
      bearing: 0,
      minZoom: 3,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: true,
      touchZoomRotate: true,
      touchPitch: true,
    });

    mapRef.current = map;

    map.on('load', () => {
      // 1. H3 Territories GeoJSON Source
      map.addSource('territories-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'territories-glow',
        type: 'line',
        source: 'territories-source',
        paint: {
          'line-color': ['get', 'ownerColor'],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            2,
            14,
            5,
            17,
            8,
          ],
          'line-blur': 4,
          'line-opacity': 0.38,
        },
      });

      map.addLayer({
        id: 'territories-fill',
        type: 'fill',
        source: 'territories-source',
        paint: {
          'fill-color': ['get', 'ownerColor'],
          'fill-opacity': 0.25,
        },
      });

      map.addLayer({
        id: 'territories-border',
        type: 'line',
        source: 'territories-source',
        paint: {
          'line-color': ['get', 'ownerColor'],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            0.8,
            14,
            1.6,
            17,
            2.4,
          ],
          'line-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'territories-highlight',
        type: 'line',
        source: 'territories-source',
        filter: ['==', ['get', 'h3Index'], ''],
        paint: {
          'line-color': '#ffffff',
          'line-width': 2.8,
          'line-opacity': 0.95,
        },
      });

      // 2. Active GPS Route Preview Source & Layers
      map.addSource('active-route-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'active-route-glow',
        type: 'line',
        source: 'active-route-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#00f0ff'],
          'line-width': 10,
          'line-blur': 6,
          'line-opacity': 0.55,
        },
      });

      map.addLayer({
        id: 'active-route-line',
        type: 'line',
        source: 'active-route-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 2.5,
          'line-dasharray': [2, 1.5],
          'line-opacity': 0.95,
        },
      });

      map.on('mousemove', 'territories-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        if (feature && feature.properties) {
          const h3Idx = String(feature.properties.h3Index || '');
          map.setFilter('territories-highlight', [
            '==',
            ['get', 'h3Index'],
            h3Idx,
          ]);
        }
      });

      map.on('mouseleave', 'territories-fill', () => {
        map.getCanvas().style.cursor = '';
        map.setFilter('territories-highlight', ['==', ['get', 'h3Index'], '']);
      });

      map.on('click', 'territories-fill', (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const props = feature.properties as unknown as TerritoryFeatureProperties;
        setInspectedCell({
          h3Index: String(props.h3Index),
          roundId: String(props.roundId || 'round-1'),
          ownerId: String(props.ownerId),
          ownerUsername: String(props.ownerUsername),
          ownerDisplayName: String(
            props.ownerDisplayName || props.ownerUsername
          ),
          ownerColor: String(props.ownerColor),
          activityId: String(props.activityId),
          activityName: String(props.activityName),
          captureMode: (props.captureMode as 'loop' | 'corridor') || 'loop',
          capturedAt: String(props.capturedAt),
          areaKm2: Number(props.areaKm2 ?? 0.1053),
        });
        map.setFilter('territories-highlight', [
          '==',
          ['get', 'h3Index'],
          String(props.h3Index),
        ]);
      });

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fit camera to all claimed territories; only falls back to Auckland when the round truly has none
  const fitMapToClaimedTerritories = useCallback(
    (animate = true) => {
      const map = mapRef.current;
      if (!map) return;
      map.resize();

      const bounds = calculateTerritoryBounds(territoriesGeoJSON);
      if (bounds) {
        map.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 60, right: 60 },
          maxZoom: 16,
          pitch: is3DPitch ? 36 : 0,
          duration: animate ? 1000 : 0,
          essential: true,
        });
        return;
      }

      map.flyTo({
        center: AUCKLAND_DEFAULT_CENTER,
        zoom: AUCKLAND_DEFAULT_ZOOM,
        pitch: is3DPitch ? 36 : 0,
        bearing: 0,
        duration: animate ? 800 : 0,
      });
    },
    [is3DPitch, territoriesGeoJSON]
  );

  // Sync Territories GeoJSON data into MapLibre source; auto-fit once data for the active round has resolved
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !territoriesGeoJSON) return;

    // Ignore stale data from a previously selected round while the new round is still loading
    if (roundId && territoriesRoundId && territoriesRoundId !== roundId) return;

    const source = map.getSource('territories-source') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(territoriesGeoJSON);
    }

    const roundKey = territoriesRoundId || roundId || 'default';
    const hasFeatures = territoriesGeoJSON.features.length > 0;
    const isRoundChanged = lastFittedRoundRef.current !== roundKey;
    const justPopulated =
      lastFittedRoundRef.current === roundKey &&
      !lastFittedHadFeaturesRef.current &&
      hasFeatures;

    if (isRoundChanged || justPopulated) {
      lastFittedRoundRef.current = roundKey;
      lastFittedHadFeaturesRef.current = hasFeatures;
      setInspectedCell(null);
      fitMapToClaimedTerritories(true);
    }
  }, [
    territoriesGeoJSON,
    territoriesRoundId,
    mapLoaded,
    roundId,
    fitMapToClaimedTerritories,
  ]);

  // Apply Athlete Focus Filter styling on GPU layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (focusedOwnerId !== null) {
      map.setPaintProperty('territories-fill', 'fill-opacity', [
        'case',
        ['==', ['get', 'ownerId'], focusedOwnerId],
        0.42,
        0.05,
      ]);
      map.setPaintProperty('territories-border', 'line-opacity', [
        'case',
        ['==', ['get', 'ownerId'], focusedOwnerId],
        1.0,
        0.18,
      ]);
      map.setPaintProperty('territories-glow', 'line-opacity', [
        'case',
        ['==', ['get', 'ownerId'], focusedOwnerId],
        0.65,
        0.04,
      ]);
    } else {
      map.setPaintProperty('territories-fill', 'fill-opacity', 0.25);
      map.setPaintProperty('territories-border', 'line-opacity', 0.9);
      map.setPaintProperty('territories-glow', 'line-opacity', 0.38);
    }
  }, [focusedOwnerId, mapLoaded]);

  // Render selected activity GPS polyline & fly camera to activity
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const routeSource = map.getSource('active-route-source') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!routeSource) return;

    if (!selectedActivity) {
      routeSource.setData({
        type: 'FeatureCollection',
        features: [],
      });
      return;
    }

    try {
      const geometry = JSON.parse(selectedActivity.routeGeojson) as LineString;
      if (
        geometry &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length >= 2
      ) {
        routeSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                color: selectedActivity.userColor,
                name: selectedActivity.name,
              },
              geometry,
            },
          ],
        });

        const bounds = new maplibregl.LngLatBounds();
        for (const coord of geometry.coordinates) {
          bounds.extend([coord[0], coord[1]]);
        }
        map.fitBounds(bounds, {
          padding: 60,
          maxZoom: 15,
          pitch: is3DPitch ? 40 : 0,
          duration: 1200,
        });
      }
    } catch {
      if (selectedActivity.startLng && selectedActivity.startLat) {
        map.flyTo({
          center: [selectedActivity.startLng, selectedActivity.startLat],
          zoom: 14.2,
          duration: 1200,
        });
      }
    }
  }, [selectedActivity, mapLoaded, is3DPitch]);

  // Fly to explicit target coordinates (e.g. after syncing new run)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !flyToTarget) return;

    map.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: flyToTarget.zoom ?? 14.1,
      pitch: is3DPitch ? 40 : 0,
      duration: 1500,
    });
  }, [flyToTarget, mapLoaded, is3DPitch]);

  // Expose current map center & zoom to parent for "Set from Current Map Center"
  useEffect(() => {
    if (!viewportRef) return;
    viewportRef.current = {
      getCenter: () => {
        const map = mapRef.current;
        if (!map) return { lng: AUCKLAND_DEFAULT_CENTER[0], lat: AUCKLAND_DEFAULT_CENTER[1] };
        const c = map.getCenter();
        return { lng: c.lng, lat: c.lat };
      },
      getZoom: () => {
        const map = mapRef.current;
        return map ? Math.round(map.getZoom()) : 14;
      },
    };
    return () => {
      if (viewportRef) viewportRef.current = null;
    };
  }, [viewportRef]);

  // In-map lightweight toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  }, []);

  const handleFitEntireTerritory = useCallback(() => {
    setInspectedCell(null);
    onClearSelectedActivity();
    fitMapToClaimedTerritories(true);
  }, [fitMapToClaimedTerritories, onClearSelectedActivity]);

  const handleFocusHomeArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setInspectedCell(null);
    onClearSelectedActivity();

    if (
      homeArea &&
      typeof homeArea.lat === 'number' &&
      typeof homeArea.lng === 'number'
    ) {
      map.flyTo({
        center: [homeArea.lng, homeArea.lat],
        zoom: homeArea.zoom || 14,
        pitch: is3DPitch ? 36 : 0,
        bearing: 0,
        duration: 1000,
        essential: true,
      });
      return;
    }

    // If no home area set yet:
    if (
      latestActivityStart &&
      typeof latestActivityStart.lat === 'number' &&
      typeof latestActivityStart.lng === 'number'
    ) {
      map.flyTo({
        center: [latestActivityStart.lng, latestActivityStart.lat],
        zoom: 14,
        pitch: is3DPitch ? 36 : 0,
        bearing: 0,
        duration: 1000,
        essential: true,
      });
      triggerToast(
        'Focused on your latest activity. Set your permanent Home Base in Settings.'
      );
    } else {
      triggerToast(
        "No home area set. Pan to your neighborhood and tap 'Set from Current Map Center' in Settings."
      );
    }
  }, [
    homeArea,
    latestActivityStart,
    is3DPitch,
    onClearSelectedActivity,
    triggerToast,
  ]);

  const handleResetToAuckland = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setInspectedCell(null);
    onClearSelectedActivity();
    map.flyTo({
      center: AUCKLAND_DEFAULT_CENTER,
      zoom: AUCKLAND_DEFAULT_ZOOM,
      pitch: is3DPitch ? 36 : 0,
      bearing: 0,
      duration: 1200,
    });
  }, [is3DPitch, onClearSelectedActivity]);

  const handleTogglePitch = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next3D = !is3DPitch;
    setIs3DPitch(next3D);
    map.easeTo({
      pitch: next3D ? 40 : 0,
      bearing: 0,
      duration: 700,
    });
  }, [is3DPitch]);

  const handleZoom = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.zoomTo(map.getZoom() + delta, { duration: 300 });
  }, []);

  const claimedCount = territoriesGeoJSON?.features.length ?? 0;

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-carbon-950">
      <div ref={mapContainerRef} className="h-full w-full" />

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, transparent 55%, rgba(9, 9, 11, 0.65) 100%)',
        }}
      />

      {/* Lightweight In-Map Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto absolute top-20 left-1/2 z-30 flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-neon-cyan/40 bg-carbon-900/95 px-4 py-2.5 shadow-glass backdrop-blur-xl sm:top-24"
          >
            <Home className="h-4 w-4 shrink-0 text-neon-cyan" />
            <span className="font-mono text-xs text-zinc-200">
              {toastMessage}
            </span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="ml-1 text-zinc-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {(focusedOwnerId !== null || selectedActivity !== null) && (
        <div className="pointer-events-auto absolute left-3 top-20 z-20 flex flex-wrap items-center gap-2 sm:left-6 sm:top-24">
          {focusedOwnerId !== null && (
            <button
              type="button"
              onClick={onClearOwnerFocus}
              className="flex min-h-[48px] items-center gap-2 rounded-full border border-zinc-700/80 bg-carbon-900/90 px-4 py-2 text-xs font-medium text-zinc-200 shadow-glass backdrop-blur-xl transition hover:border-neon-cyan/60 hover:text-white"
            >
              <Shield className="h-4 w-4 text-neon-cyan" />
              <span>Player Filter Active</span>
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          )}

          {selectedActivity !== null && (
            <button
              type="button"
              onClick={onClearSelectedActivity}
              className="flex min-h-[48px] items-center gap-2 rounded-full border border-zinc-700/80 bg-carbon-900/90 px-4 py-2 text-xs font-medium text-zinc-200 shadow-glass backdrop-blur-xl transition hover:border-neon-lime/60 hover:text-white"
            >
              <Sparkles
                className="h-4 w-4"
                style={{ color: selectedActivity.userColor }}
              />
              <span className="max-w-[200px] truncate">
                {selectedActivity.name}
              </span>
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          )}
        </div>
      )}

      {/* Right-side Camera & Spatial Control Cluster (All >= 48x48px touch targets) */}
      <div className="pointer-events-auto absolute right-3 top-20 z-20 flex flex-col gap-2 sm:right-6 sm:top-24">
        {/* Button 1: "Fit Entire Territory" Floating Action Button */}
        <button
          type="button"
          onClick={handleFitEntireTerritory}
          title={
            claimedCount > 0
              ? `Fit Entire Territory (${claimedCount} Hexes)`
              : 'Fit Entire Territory (Auckland Baseline)'
          }
          aria-label="Fit Entire Territory"
          data-testid="fit-territory-fab"
          className="group relative flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-neon-cyan/45 bg-carbon-900/90 text-neon-cyan shadow-glass backdrop-blur-xl transition hover:border-neon-cyan hover:bg-neon-cyan/15 hover:text-white active:scale-95"
        >
          <Scan className="h-5 w-5 transition-transform group-hover:scale-110" />
          <Maximize2 className="absolute h-2.5 w-2.5 opacity-80" />
        </button>

        {/* Button 2: "My Home Area" (User Base) */}
        <button
          type="button"
          onClick={handleFocusHomeArea}
          title={
            homeArea
              ? `My Home Base (${homeArea.lat.toFixed(3)}, ${homeArea.lng.toFixed(3)})`
              : 'My Home Area (Click to Focus / Set in Settings)'
          }
          aria-label="My Home Area"
          data-testid="home-area-fab"
          className={`group relative flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border shadow-glass backdrop-blur-xl transition active:scale-95 ${
            homeArea
              ? 'border-neon-lime/50 bg-carbon-900/90 text-neon-lime hover:border-neon-lime hover:bg-neon-lime/15 hover:text-white'
              : 'border-border-subtle bg-carbon-900/85 text-zinc-400 hover:border-zinc-600 hover:text-white'
          }`}
        >
          <Home className="h-5 w-5 transition-transform group-hover:scale-110" />
          {homeArea && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-lime opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-neon-lime" />
            </span>
          )}
        </button>

        {/* Button 3: Auckland Central Reset */}
        <button
          type="button"
          onClick={handleResetToAuckland}
          title="Center on Auckland Central"
          aria-label="Center on Auckland Central"
          className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-border-subtle bg-carbon-900/85 text-zinc-300 shadow-glass backdrop-blur-xl transition hover:border-zinc-600 hover:text-white active:scale-95"
        >
          <Crosshair className="h-4 w-4" />
        </button>

        {/* Button 4: 3D Tactical Pitch Toggle */}
        <button
          type="button"
          onClick={handleTogglePitch}
          title="Toggle 3D Tactical Pitch"
          aria-label="Toggle 3D Tactical Pitch"
          className={`flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border shadow-glass backdrop-blur-xl transition active:scale-95 ${
            is3DPitch
              ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan'
              : 'border-border-subtle bg-carbon-900/85 text-zinc-300 hover:border-zinc-600 hover:text-white'
          }`}
        >
          <Compass className="h-4 w-4" />
        </button>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-carbon-900/85 shadow-glass backdrop-blur-xl">
          <button
            type="button"
            onClick={() => handleZoom(1)}
            title="Zoom In"
            aria-label="Zoom In"
            className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center border-b border-border-subtle text-zinc-300 transition hover:bg-zinc-800/60 hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(-1)}
            title="Zoom Out"
            aria-label="Zoom Out"
            className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center text-zinc-300 transition hover:bg-zinc-800/60 hover:text-white"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* H3 Hex Cell Telemetry Inspector Card */}
      {inspectedCell && (
        <div className="pointer-events-auto absolute left-3 top-32 z-30 w-80 max-w-[calc(100vw-4.5rem)] rounded-2xl border border-zinc-700/80 bg-carbon-900/95 p-4 shadow-glass backdrop-blur-2xl sm:left-6 sm:top-36">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border"
                style={{
                  borderColor: `${inspectedCell.ownerColor}66`,
                  backgroundColor: `${inspectedCell.ownerColor}18`,
                  boxShadow: `0 0 18px ${inspectedCell.ownerColor}33`,
                }}
              >
                <Hexagon
                  className="h-4 w-4"
                  style={{ color: inspectedCell.ownerColor }}
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                    H3 RES-9 CELL
                  </span>
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: inspectedCell.ownerColor }}
                  />
                </div>
                <p className="font-mono text-xs font-semibold text-zinc-100">
                  {inspectedCell.h3Index}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setInspectedCell(null)}
              aria-label="Close Cell Inspector"
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-xl border border-border-subtle bg-carbon-950/70 p-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                TERRITORY HOLDER
              </p>
              <Link
                href={`/profile/${inspectedCell.ownerId}`}
                className="mt-0.5 flex items-center gap-1 truncate text-xs font-bold hover:underline"
                style={{ color: inspectedCell.ownerColor }}
              >
                <span className="truncate">{inspectedCell.ownerDisplayName}</span>
                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-80" />
              </Link>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                CAPTURE PROTOCOL
              </p>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-xs font-medium text-zinc-200">
                <Layers className="h-3 w-3 text-zinc-400" />
                LOOP ENCLOSURE
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between text-xs text-zinc-400">
            <span className="truncate pr-2 font-medium text-zinc-300">
              {inspectedCell.activityName}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-zinc-400">
              {formatRelativeTime(inspectedCell.capturedAt)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
