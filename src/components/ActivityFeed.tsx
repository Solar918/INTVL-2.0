'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { ActivityFeedItem, DeleteActivityRollbackResult } from '@/lib/d1';
import type { TerritoryCoOwner } from '@/lib/geo';
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
  Check,
  ExternalLink,
  Flame,
  Hexagon,
  Loader2,
  MapPin,
  Navigation,
  Timer,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

export interface ActivityFeedProps {
  activities: ActivityFeedItem[];
  selectedActivityId: string | null;
  onSelectActivity: (activity: ActivityFeedItem | null) => void;
  currentUserId?: string | null;
  isRoundAdmin?: boolean;
  squadFriends?: TerritoryCoOwner[];
  onActivityDeleted?: (rollback: DeleteActivityRollbackResult) => void;
  onActivityUpdated?: () => void;
}

export default function ActivityFeed({
  activities,
  selectedActivityId,
  onSelectActivity,
  currentUserId,
  isRoundAdmin = false,
  squadFriends = [],
  onActivityDeleted,
  onActivityUpdated,
}: ActivityFeedProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingCopilotsForId, setEditingCopilotsForId] = useState<
    string | null
  >(null);
  const [draftCopilotIds, setDraftCopilotIds] = useState<string[]>([]);
  const [savingCopilotsId, setSavingCopilotsId] = useState<string | null>(null);

  const handleOpenCopilotEditor = (
    e: React.MouseEvent,
    activity: ActivityFeedItem
  ) => {
    e.stopPropagation();
    if (editingCopilotsForId === activity.id) {
      setEditingCopilotsForId(null);
      return;
    }
    setEditingCopilotsForId(activity.id);
    setDraftCopilotIds(activity.copilotUserIds ?? []);
  };

  const handleToggleDraftCopilot = (friendUserId: string) => {
    setDraftCopilotIds((prev) =>
      prev.includes(friendUserId)
        ? prev.filter((id) => id !== friendUserId)
        : [...prev, friendUserId]
    );
  };

  const handleSaveCopilots = async (
    e: React.MouseEvent,
    activity: ActivityFeedItem
  ) => {
    e.stopPropagation();
    setSavingCopilotsId(activity.id);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activity.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            copilotUserIds: draftCopilotIds,
          }),
        }
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to update co-walkers.');
      }
      setEditingCopilotsForId(null);
      onActivityUpdated?.();
      onActivityDeleted?.({
        deletedActivityId: activity.id,
        deletedActivityName: activity.name,
        roundId: activity.roundId,
        cellsAffected: 0,
        cellsReverted: 0,
        cellsCleared: 0,
      });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to update co-walkers.'
      );
    } finally {
      setSavingCopilotsId(null);
    }
  };

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
                    {activity.coOwners && activity.coOwners.length > 1 ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {activity.coOwners.map((owner, idx) => (
                          <React.Fragment key={owner.userId}>
                            <Link
                              href={`/profile/${owner.userId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs font-bold hover:underline"
                              style={{ color: owner.colorHex }}
                            >
                              {owner.displayName}
                            </Link>
                            {idx < activity.coOwners.length - 1 && (
                              <span className="font-mono text-[10px] text-zinc-400">
                                &amp;
                              </span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      <Link
                        href={`/profile/${activity.userId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-bold hover:underline"
                        style={{ color: activity.userColor }}
                      >
                        {activity.displayName}
                      </Link>
                    )}
                    <span className="text-zinc-600">•</span>
                    <span className="inline-flex items-center gap-1 rounded border border-neon-cyan/30 bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-neon-cyan">
                      {isLoop ? 'CLOSED LOOP' : 'CORRIDOR'}
                    </span>
                    {activity.isCoop && (
                      <span className="inline-flex items-center gap-1 rounded border border-neon-magenta/40 bg-neon-magenta/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-neon-magenta">
                        <Users className="h-2.5 w-2.5" />
                        CO-OP
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 break-words text-xs font-semibold text-zinc-100 sm:text-sm">
                    {activity.name}
                  </p>
                  {activity.isCoop && activity.sharedLabel && (
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      {activity.sharedLabel}
                    </p>
                  )}
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

                {canDelete &&
                  squadFriends.filter((f) => f.userId !== activity.userId)
                    .length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => handleOpenCopilotEditor(e, activity)}
                      title="Walked with Friends (Co-op Tagging)"
                      aria-label={`Tag friends on ${activity.name}`}
                      className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border transition ${
                        editingCopilotsForId === activity.id || activity.isCoop
                          ? 'border-neon-magenta/60 bg-neon-magenta/15 text-neon-magenta'
                          : 'border-border-subtle/80 bg-carbon-900/90 text-zinc-400 hover:border-neon-magenta/50 hover:text-white'
                      }`}
                    >
                      <UserPlus className="h-4 w-4" />
                    </button>
                  )}

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

            {/* Inline "Walked with Friends" Co-op Editor */}
            {editingCopilotsForId === activity.id && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mt-3 rounded-xl border border-neon-magenta/40 bg-carbon-900/95 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-neon-magenta">
                    <Users className="h-3.5 w-3.5" />
                    <span>Walked with Friends (Joint Territory)</span>
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Select squadmates who walked this route with you to share ownership of its H3 hexes:
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {squadFriends
                    .filter((f) => f.userId !== activity.userId)
                    .map((friend) => {
                      const selected = draftCopilotIds.includes(friend.userId);
                      return (
                        <button
                          key={friend.userId}
                          type="button"
                          onClick={() => handleToggleDraftCopilot(friend.userId)}
                          className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-2.5 py-1.5 font-mono text-xs font-semibold transition ${
                            selected
                              ? 'border-white bg-zinc-800 text-white'
                              : 'border-border-subtle bg-carbon-950 text-zinc-400 hover:text-white'
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: friend.colorHex }}
                          />
                          <span>{friend.displayName}</span>
                          {selected && (
                            <Check className="h-3 w-3 text-neon-lime" />
                          )}
                        </button>
                      );
                    })}
                </div>

                <div className="mt-2.5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingCopilotsForId(null)}
                    className="rounded-lg border border-border-subtle bg-carbon-950 px-3 py-1.5 font-mono text-[11px] text-zinc-300 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingCopilotsId === activity.id}
                    onClick={(e) => handleSaveCopilots(e, activity)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-neon-magenta px-3 py-1.5 font-mono text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    {savingCopilotsId === activity.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    <span>Save Co-Walkers</span>
                  </button>
                </div>
              </div>
            )}

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

              <div className="flex items-center gap-2.5">
                {/^\d+$/.test(activity.stravaActivityId) && (
                  <a
                    href={`https://www.strava.com/activities/${encodeURIComponent(
                      activity.stravaActivityId
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-strava-orange transition hover:underline"
                  >
                    <span>View on Strava</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}

                <span className="flex items-center gap-1 text-[10px] text-zinc-400 group-hover:text-white">
                  <MapPin className="h-3 w-3" />
                  {isSelected ? 'Viewing GPS Track' : 'Inspect Track'}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
