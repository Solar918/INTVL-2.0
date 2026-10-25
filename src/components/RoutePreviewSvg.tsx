'use client';

import React, { useMemo } from 'react';
import type { LineString } from 'geojson';

export interface RoutePreviewSvgProps {
  routeGeojson: string | null | undefined;
  color?: string;
  size?: number;
  width?: number;
  height?: number;
  isLoop?: boolean;
  className?: string;
}

/**
 * Renders a normalized SVG vector preview of a GPS LineString trajectory.
 * Highlights the enclosed polygon interior when `isLoop` is true.
 */
export default function RoutePreviewSvg({
  routeGeojson,
  color = '#00f0ff',
  size = 64,
  width,
  height,
  isLoop = true,
  className = '',
}: RoutePreviewSvgProps) {
  const svgWidth = width ?? size;
  const svgHeight = height ?? size;

  const pathData = useMemo(() => {
    if (!routeGeojson) return null;
    try {
      const parsed = JSON.parse(routeGeojson) as LineString;
      if (
        !parsed ||
        parsed.type !== 'LineString' ||
        !Array.isArray(parsed.coordinates) ||
        parsed.coordinates.length < 2
      ) {
        return null;
      }

      const coords = parsed.coordinates;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const [lng, lat] of coords) {
        if (lng < minX) minX = lng;
        if (lng > maxX) maxX = lng;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
      }

      const pad = 8;
      const drawW = Math.max(svgWidth - pad * 2, 10);
      const drawH = Math.max(svgHeight - pad * 2, 10);

      // Equirectangular cosine correction for latitude distortion
      const midLatRad = (((minY + maxY) / 2) * Math.PI) / 180;
      const cosLat = Math.max(Math.cos(midLatRad), 0.2);

      const spanX = Math.max((maxX - minX) * cosLat, 1e-6);
      const spanY = Math.max(maxY - minY, 1e-6);

      const scale = Math.min(drawW / spanX, drawH / spanY);
      const offsetX = pad + (drawW - spanX * scale) / 2;
      const offsetY = pad + (drawH - spanY * scale) / 2;

      const points = coords.map(([lng, lat]) => {
        const x = offsetX + (lng - minX) * cosLat * scale;
        const y = svgHeight - (offsetY + (lat - minY) * scale);
        return [Number(x.toFixed(1)), Number(y.toFixed(1))] as [number, number];
      });

      const d = points
        .map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'}${x},${y}`)
        .join(' ');

      return {
        d,
        closedD: `${d} Z`,
        start: points[0],
        end: points[points.length - 1],
      };
    } catch {
      return null;
    }
  }, [routeGeojson, svgWidth, svgHeight]);

  if (!pathData) {
    return (
      <div
        style={{ width: svgWidth, height: svgHeight }}
        className={`flex items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/80 font-mono text-[9px] text-zinc-600 ${className}`}
      >
        NO GPS
      </div>
    );
  }

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className={`shrink-0 overflow-hidden rounded-xl border border-border-subtle bg-carbon-950/90 ${className}`}
    >
      {isLoop && (
        <path
          d={pathData.closedD}
          fill={color}
          fillOpacity={0.18}
          stroke="none"
        />
      )}
      <path
        d={pathData.d}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: `drop-shadow(0 0 4px ${color})`,
        }}
      />
      <circle
        cx={pathData.start[0]}
        cy={pathData.start[1]}
        r={2.4}
        fill="#ffffff"
      />
      <circle
        cx={pathData.end[0]}
        cy={pathData.end[1]}
        r={2.2}
        fill={color}
      />
    </svg>
  );
}
