'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { ActivityFeedItem, DeleteActivityRollbackResult } from '@/lib/d1';
import RoutePreviewSvg from '@/components/RoutePreviewSvg';
import {
  formatAreaKm2,
  formatDistanceKm,
  formatDuration,
  formatPaceMinPerKm,
  formatRelativeTime,
} from '@/lib/utils';
import {
  AlertTriangle,
  Flame,
  Hexagon,
  Loader2,
  MapPin,
  Navigation,
  Timer,
  Trash2,
} from 'lucide-react';

export interface ActivityFeedProps {
  activities: ActivityFeedItem[];
  selectedActivityId: string | null;
  onSelectActivity: (activity: ActivityFeedItem | null) => void;
  currentUserId?: string | null;
  isRoundAdmin?: boolean;
  onActivityDeleted?: (rollback: DeleteActivityRollbackResult) => void;
}

export default function ActivityFeed({
  activities,
  selectedActivityId,
  onSelectActivity,
  currentUserId,
  isRoundAdmin = false,
  onActivityDeleted,
}: ActivityFeedProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleConfirmDelete = async (
    e: React.MouseEvent,
    activity: ActivityFeedItem
  ) => {
    e.stopPropagation();
    setDeletingId(activity.id);
    setDeleteError(null);

    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activity.id)}`,
        {
          method: 'DELETE',
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rollback?: DeleteActivityRollbackResult;
      };
      if (!res.ok || !data.ok || !data.rollback) {
        throw new Error(data.error || 'Failed to remove activity.');
      }

      if (selectedActivityId === activity.id) {
        onSelectActivity(null);
      }
      setConfirmingId(null);
      onActivityDeleted?.(data.rollback);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to remove activity.'
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border-subtle bg-carbon-950/60 p-6 text-center">
        <Hexagon className="h-8 w-8 text-zinc-600" />
        <p className="mt-2 text-sm font-medium text-zinc-300">
          No Closed-Loop Conquests in This Round Yet
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Tap &ldquo;Review &amp; Claim 30-Day Strava Loops&rdquo; to inspect your recent walks, runs, and hikes and claim your enclosed H3 hexes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {deleteError && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span>{deleteError}</span>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="min-h-[36px] px-2 font-mono text-[11px] font-bold text-red-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {activities.map((activity) => {
        const isSelected = selectedActivityId === activity.id;
        const isLoop = activity.captureMode === 'loop';
        const canDelete = Boolean(
          currentUserId &&
            (activity.userId === currentUserId || isRoundAdmin)
        );
        const isConfirming = confirmingId === activity.id;
        const isDeleting = deletingId === activity.id;

        return (
          <div
            key={activity.id}
            onClick={() => onSelectActivity(isSelected ? null : activity)}
            className={`group cursor-pointer rounded-2xl border p-3.5 text-left transition-all ${
              isSelected
                ? 'border-white/40 bg-zinc-800/85 shadow-lg'
                : 'border-border-subtle bg-carbon-950/75 hover:border-zinc-700 hover:bg-carbon-900/90'
            }`}
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex min-w-0 items-start gap-3">
                <RoutePreviewSvg
                  routeGeojson={activity.routeGeojson}
                  color={activity.userColor}
                  size={46}
                  isLoop={isLoop}
                />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={`/profile/${activity.userId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs font-bold hover:underline"
                      style={{ color: activity.userColor }}
                    >
                      {activity.displayName}
                    </Link>
                    <span className="text-zinc-600">•</span>
                    <span className="inline-flex items-center gap-1 rounded border border-neon-cyan/30 bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-neon-cyan">
                      {isLoop ? 'CLOSED LOOP' : 'CORRIDOR'}
                    </span>
                  </div>

                  <p className="mt-0.5 break-words text-xs font-semibold text-zinc-100 sm:text-sm">
                    {activity.name}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-start gap-1.5">
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="rounded-md border px-2 py-0.5 font-mono text-xs font-bold"
                      style={{
                        borderColor: `${activity.userColor}66`,
                        backgroundColor: `${activity.userColor}18`,
                        color: activity.userColor,
                      }}
                    >
                      +{activity.cellsCaptured} HEX
                    </span>

                    {activity.cellsStolen > 0 && (
                      <span className="flex items-center gap-0.5 rounded-md border border-neon-magenta/50 bg-neon-magenta/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-neon-magenta">
                        <Flame className="h-3 w-3" />
                        {activity.cellsStolen} STOLEN
                      </span>
                    )}
                  </div>

                  <span className="font-mono text-[10px] text-zinc-500">
                    {formatRelativeTime(activity.startedAt)}
                  </span>
                </div>

                {canDelete && !isConfirming && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(activity.id);
                    }}
                    title="Remove Activity & Revert Hexes"
                    aria-label={`Remove activity ${activity.name}`}
                    className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle/80 bg-carbon-900/90 text-zinc-400 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Confirmation Dialog for Activity Removal & Hex Reversion */}
            {isConfirming && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mt-3 rounded-xl border border-red-500/40 bg-red-950/30 p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-red-200">
                      Remove &ldquo;{activity.name}&rdquo; from this round?
                    </p>
                    <p className="mt-0.5 text-[11px] text-red-300/90">
                      Any H3 hexes currently held by this activity will automatically revert to the most recent preceding walk covering them, or return to unclaimed neutral territory.
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(null);
                    }}
                    className="flex min-h-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 font-mono text-xs font-semibold text-zinc-300 transition hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={(e) => handleConfirmDelete(e, activity)}
                    className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-red-500/60 bg-red-500/20 px-3.5 py-2 font-mono text-xs font-bold text-red-200 transition hover:bg-red-500/30 disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Reverting Hexes...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove &amp; Revert</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle/50 pt-2 font-mono text-[11px] text-zinc-400">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1">
                  <Navigation className="h-3 w-3 text-zinc-500" />
                  {formatDistanceKm(activity.distanceMeters)} km
                </span>
                <span className="flex items-center gap-1">
                  <Timer className="h-3 w-3 text-zinc-500" />
                  {formatDuration(activity.movingTimeSeconds)}
                </span>
                <span className="text-zinc-300">
                  {formatPaceMinPerKm(
                    activity.distanceMeters,
                    activity.movingTimeSeconds
                  )}{' '}
                  /km
                </span>
                <span className="flex items-center gap-1 text-zinc-300">
                  <Hexagon className="h-3 w-3 text-zinc-500" />
                  {formatAreaKm2(activity.areaKm2)} km²
                </span>
              </div>

              <span className="flex items-center gap-1 text-[10px] text-zinc-400 group-hover:text-white">
                <MapPin className="h-3 w-3" />
                {isSelected ? 'Viewing GPS Track' : 'Inspect Track'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
