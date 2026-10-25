import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Default Map Viewport: Auckland, New Zealand (lng, lat)
export const AUCKLAND_DEFAULT_CENTER: [number, number] = [174.7633, -36.8485];
export const AUCKLAND_DEFAULT_ZOOM = 13;

export interface TacticalColorOption {
  id: string;
  name: string;
  codeName: string;
  hex: string;
  glowRgba: string;
  badgeBg: string;
}

export const TACTICAL_PALETTE: readonly TacticalColorOption[] = [
  {
    id: 'cyan',
    name: 'Cyber Cyan',
    codeName: 'VECTOR-01',
    hex: '#00f0ff',
    glowRgba: 'rgba(0, 240, 255, 0.35)',
    badgeBg: 'rgba(0, 240, 255, 0.12)',
  },
  {
    id: 'lime',
    name: 'Volt Lime',
    codeName: 'VENOM-02',
    hex: '#22c55e',
    glowRgba: 'rgba(34, 197, 94, 0.35)',
    badgeBg: 'rgba(34, 197, 94, 0.12)',
  },
  {
    id: 'magenta',
    name: 'Hyper Magenta',
    codeName: 'PULSE-03',
    hex: '#ec4899',
    glowRgba: 'rgba(236, 72, 153, 0.35)',
    badgeBg: 'rgba(236, 72, 153, 0.12)',
  },
  {
    id: 'amber',
    name: 'Solar Amber',
    codeName: 'SOLARIS-04',
    hex: '#f59e0b',
    glowRgba: 'rgba(245, 158, 11, 0.35)',
    badgeBg: 'rgba(245, 158, 11, 0.12)',
  },
  {
    id: 'purple',
    name: 'Phantom Purple',
    codeName: 'AETHER-05',
    hex: '#a855f7',
    glowRgba: 'rgba(168, 85, 247, 0.35)',
    badgeBg: 'rgba(168, 85, 247, 0.12)',
  },
  {
    id: 'crimson',
    name: 'Crimson Laser',
    codeName: 'NOVA-06',
    hex: '#f43f5e',
    glowRgba: 'rgba(244, 63, 94, 0.35)',
    badgeBg: 'rgba(244, 63, 94, 0.12)',
  },
  {
    id: 'electric',
    name: 'Electric Cobalt',
    codeName: 'ION-07',
    hex: '#3b82f6',
    glowRgba: 'rgba(59, 130, 246, 0.35)',
    badgeBg: 'rgba(59, 130, 246, 0.12)',
  },
  {
    id: 'teal',
    name: 'Hyper Teal',
    codeName: 'KINETIC-08',
    hex: '#14b8a6',
    glowRgba: 'rgba(20, 184, 166, 0.35)',
    badgeBg: 'rgba(20, 184, 166, 0.12)',
  },
] as const;

export function isValidTacticalColor(hex?: string | null): hex is string {
  if (!hex) return false;
  const normalized = hex.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(normalized);
}

export function normalizePlayerColor(preferredColor?: string | null): string {
  if (preferredColor && isValidTacticalColor(preferredColor)) {
    const match = TACTICAL_PALETTE.find(
      (c) => c.hex.toLowerCase() === preferredColor.trim().toLowerCase()
    );
    return match ? match.hex : preferredColor.trim().toLowerCase();
  }
  return TACTICAL_PALETTE[0].hex;
}

export function formatDistanceKm(meters: number): string {
  const km = meters / 1000;
  return km >= 10 ? km.toFixed(1) : km.toFixed(2);
}

export function formatAreaKm2(areaKm2: number): string {
  return areaKm2.toFixed(2);
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function formatPaceMinPerKm(
  distanceMeters: number,
  movingTimeSeconds: number
): string {
  if (!distanceMeters || distanceMeters < 50 || !movingTimeSeconds || movingTimeSeconds <= 0) {
    return '— /km';
  }
  const km = distanceMeters / 1000;
  const totalSecondsPerKm = Math.round(movingTimeSeconds / km);
  const mins = Math.floor(totalSecondsPerKm / 60);
  const secs = totalSecondsPerKm % 60;
  return `${mins}'${secs.toString().padStart(2, '0')}" /km`;
}

export function formatSpeedKmh(
  distanceMeters: number,
  movingTimeSeconds: number
): string {
  if (!distanceMeters || distanceMeters <= 0 || !movingTimeSeconds || movingTimeSeconds <= 0) {
    return '0.0 km/h';
  }
  const kmh = (distanceMeters / 1000) / (movingTimeSeconds / 3600);
  return `${kmh.toFixed(1)} km/h`;
}

export function formatRelativeTime(isoDate: string): string {
  const date = new Date(
    isoDate.endsWith('Z') || isoDate.includes('+') ? isoDate : `${isoDate}Z`
  );
  if (Number.isNaN(date.getTime())) return 'Just now';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 45) return 'Just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;
  return date.toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' });
}

export function formatRoundCountdownStatus(
  round?: {
    status?: 'active' | 'archived';
    endsAt?: string | null;
    isConcluded?: boolean;
  } | null,
  nowMs: number = Date.now()
): {
  isConcluded: boolean;
  label: string;
  shortLabel: string;
} {
  if (!round) {
    return {
      isConcluded: false,
      label: 'Active',
      shortLabel: 'Active',
    };
  }

  if (round.status === 'archived' || round.isConcluded) {
    return {
      isConcluded: true,
      label: 'Concluded',
      shortLabel: 'Concluded',
    };
  }

  if (!round.endsAt) {
    return {
      isConcluded: false,
      label: 'Active • Open Season',
      shortLabel: 'Active',
    };
  }

  const trimmed = round.endsAt.trim();
  const iso = trimmed.includes('T')
    ? trimmed
    : `${trimmed.replace(' ', 'T')}${trimmed.endsWith('Z') ? '' : 'Z'}`;
  const endsMs = Date.parse(iso);

  if (Number.isNaN(endsMs)) {
    return {
      isConcluded: false,
      label: 'Active',
      shortLabel: 'Active',
    };
  }

  const remainingMs = endsMs - nowMs;
  if (remainingMs <= 0) {
    return {
      isConcluded: true,
      label: 'Concluded',
      shortLabel: 'Concluded',
    };
  }

  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;

  if (days >= 1) {
    return {
      isConcluded: false,
      label: `Active - ${days} ${days === 1 ? 'Day' : 'Days'} ${hours}h Left`,
      shortLabel: `${days}d ${hours}h left`,
    };
  }
  if (hours >= 1) {
    return {
      isConcluded: false,
      label: `Active - ${hours}h ${mins}m Left`,
      shortLabel: `${hours}h ${mins}m left`,
    };
  }
  return {
    isConcluded: false,
    label: `Active - ${Math.max(1, mins)}m Left`,
    shortLabel: `${Math.max(1, mins)}m left`,
  };
}

export function toDatetimeLocalValue(utcSqlTimestamp?: string | null): string {
  if (!utcSqlTimestamp || !utcSqlTimestamp.trim()) return '';
  const trimmed = utcSqlTimestamp.trim();
  const iso = trimmed.includes('T')
    ? trimmed
    : `${trimmed.replace(' ', 'T')}${trimmed.endsWith('Z') ? '' : 'Z'}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

