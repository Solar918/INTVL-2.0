'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Flame,
  RefreshCw,
  AlertTriangle,
  Zap,
  LogIn,
  Layers,
  Lock,
} from 'lucide-react';

export interface SyncResultPayload {
  ok: boolean;
  source?: string;
  roundId?: string;
  roundName?: string;
  scannedCount?: number;
  requestedCount?: number;
  ingestedCount?: number;
  skippedNonLoops?: string[];
  totalCellsCaptured?: number;
  totalCellsStolen?: number;
  activities?: Array<{
    activityId: string;
    stravaActivityId: string;
    roundId: string;
    name: string;
    captureMode: 'loop' | 'corridor';
    cellsCaptured: number;
    cellsStolen: number;
    areaKm2: number;
    centroid: [number, number];
  }>;
  error?: string;
}

export interface SyncButtonProps {
  isAuthenticated: boolean;
  stravaConnected: boolean;
  playerColor?: string;
  isRoundArchived?: boolean;
  onOpenSyncReviewModal: () => void;
  lastSyncResult?: SyncResultPayload | null;
}

export default function SyncButton({
  isAuthenticated,
  stravaConnected,
  playerColor = '#00f0ff',
  isRoundArchived = false,
  onOpenSyncReviewModal,
  lastSyncResult,
}: SyncButtonProps) {
  const [dismissedResult, setDismissedResult] = useState(false);

  if (!isAuthenticated) {
    return (
      <Link
        href="/login"
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-neon-cyan/50 bg-neon-cyan/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-neon-cyan transition hover:bg-neon-cyan/25 sm:text-sm"
      >
        <LogIn className="h-4 w-4" />
        <span>Log In to Claim Territory</span>
      </Link>
    );
  }

  if (!stravaConnected) {
    return (
      <a
        href="/api/auth/strava"
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-strava-orange/70 bg-gradient-to-r from-strava-orange to-[#ff6723] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition hover:brightness-110 sm:text-sm"
      >
        <Zap className="h-4 w-4 fill-current" />
        <span>Connect Strava to Sync Loops</span>
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          setDismissedResult(false);
          onOpenSyncReviewModal();
        }}
        disabled={isRoundArchived}
        style={{
          boxShadow: isRoundArchived ? undefined : `0 0 24px ${playerColor}33`,
        }}
        className="relative flex min-h-[48px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-strava-orange/70 bg-gradient-to-r from-strava-orange to-[#ff6723] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
      >
        {isRoundArchived ? (
          <Lock className="h-4 w-4 text-white" />
        ) : (
          <Layers className="h-4 w-4 text-white" />
        )}
        <span>
          {isRoundArchived
            ? 'Round Concluded (Extend in Admin or Switch Round)'
            : 'Review & Claim 30-Day Strava Loops'}
        </span>
        {!isRoundArchived && <RefreshCw className="h-3.5 w-3.5 opacity-80" />}
      </button>

      {lastSyncResult && !dismissedResult && (
        <div
          onClick={() => setDismissedResult(true)}
          className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            lastSyncResult.ok
              ? 'border-neon-lime/30 bg-neon-lime/10 text-zinc-100'
              : 'border-red-500/40 bg-red-500/10 text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {lastSyncResult.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-neon-lime" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            )}
            <span className="font-mono text-[11px]">
              {lastSyncResult.ok
                ? `Claimed ${lastSyncResult.ingestedCount ?? 0} loop(s): +${
                    lastSyncResult.totalCellsCaptured ?? 0
                  } hexes`
                : lastSyncResult.error}
            </span>
          </div>

          {lastSyncResult.totalCellsStolen !== undefined &&
            lastSyncResult.totalCellsStolen > 0 && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-neon-magenta/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-neon-magenta">
                <Flame className="h-3 w-3" />
                {lastSyncResult.totalCellsStolen} STOLEN
              </span>
            )}
        </div>
      )}
    </div>
  );
}
