'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import RoutePreviewSvg from '@/components/RoutePreviewSvg';
import type { SyncResultPayload } from '@/components/SyncButton';
import type { StravaSyncCandidate } from '@/app/api/sync/candidates/route';
import type { CaptureMode, TerritoryCoOwner } from '@/lib/geo';
import {
  formatAreaKm2,
  formatDistanceKm,
  formatDuration,
  formatPaceMinPerKm,
  formatRelativeTime,
} from '@/lib/utils';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Filter,
  Hexagon,
  Layers,
  Loader2,
  Navigation,
  RefreshCw,
  Route,
  Sparkles,
  Timer,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

export interface SyncReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  roundId: string | null;
  roundName: string;
  playerColor: string;
  squadFriends?: TerritoryCoOwner[];
  onSyncComplete: (result: SyncResultPayload) => void;
}

type FilterTab = 'all' | 'loops' | 'flagged';

export default function SyncReviewModal({
  isOpen,
  onClose,
  roundId,
  roundName,
  playerColor,
  squadFriends = [],
  onSyncComplete,
}: SyncReviewModalProps) {
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [candidates, setCandidates] = useState<StravaSyncCandidate[]>([]);
  const [availableFriends, setAvailableFriends] =
    useState<TerritoryCoOwner[]>(squadFriends);
  const [globalCopilotIds, setGlobalCopilotIds] = useState<string[]>([]);
  const [perActivityCopilots, setPerActivityCopilots] = useState<
    Record<string, string[]>
  >({});
  const [openCopilotPickerFor, setOpenCopilotPickerFor] = useState<
    string | null
  >(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overrideModes, setOverrideModes] = useState<
    Record<string, CaptureMode>
  >({});
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [error, setError] = useState<string | null>(null);
  const [scanMeta, setScanMeta] = useState<{
    totalFetched: number;
    validLoopCount: number;
    nonLoopCount: number;
  }>({
    totalFetched: 0,
    validLoopCount: 0,
    nonLoopCount: 0,
  });

  const loadCandidates = useCallback(async () => {
    setIsLoadingCandidates(true);
    setError(null);
    try {
      const query = roundId
        ? `?roundId=${encodeURIComponent(roundId)}&days=30`
        : '?days=30';
      const res = await fetch(`/api/sync/candidates${query}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        candidates?: StravaSyncCandidate[];
        availableFriends?: TerritoryCoOwner[];
        totalActivitiesFetched?: number;
        validLoopCount?: number;
        nonLoopCount?: number;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to scan 30-day Strava history.');
      }

      const list = (data.candidates ?? []) as StravaSyncCandidate[];
      setCandidates(list);
      if (Array.isArray(data.availableFriends)) {
        setAvailableFriends(data.availableFriends);
      }
      setScanMeta({
        totalFetched: data.totalActivitiesFetched ?? list.length,
        validLoopCount:
          data.validLoopCount ?? list.filter((c) => c.isLoop).length,
        nonLoopCount:
          data.nonLoopCount ?? list.filter((c) => !c.isLoop).length,
      });

      const initialModes: Record<string, CaptureMode> = {};

      for (const item of list) {
        // Default mode: 'loop' for auto-loops, 'loop' (Force as Loop) for flagged walks with loop cells
        initialModes[item.stravaActivityId] = item.isLoop ? 'loop' : 'loop';
      }

      setOverrideModes(initialModes);
      // All fetched walks/runs initialize as unchecked (selected = false) by default
      setSelectedIds(new Set<string>());
      setPerActivityCopilots({});
      setOpenCopilotPickerFor(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to fetch recent Strava activities.'
      );
    } finally {
      setIsLoadingCandidates(false);
    }
  }, [roundId]);

  useEffect(() => {
    if (isOpen) {
      loadCandidates();
    }
  }, [isOpen, loadCandidates]);

  const toggleSelection = (stravaActivityId: string, hasGps: boolean) => {
    if (!hasGps) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(stravaActivityId)) {
        next.delete(stravaActivityId);
      } else {
        next.add(stravaActivityId);
      }
      return next;
    });
  };

  const handleChooseOverrideMode = (
    stravaActivityId: string,
    mode: CaptureMode,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setOverrideModes((prev) => ({
      ...prev,
      [stravaActivityId]: mode,
    }));
    // Automatically check/select the activity when the player clicks "Force as Loop" or "Claim as Corridor"
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(stravaActivityId);
      return next;
    });
  };

  const selectAllGpsActivities = () => {
    const allIds = candidates
      .filter((c) => c.captureMode !== 'no_gps')
      .map((c) => c.stravaActivityId);
    setSelectedIds(new Set(allIds));
  };

  const selectAllValidLoops = () => {
    const allLoops = candidates
      .filter((c) => c.isLoop)
      .map((c) => c.stravaActivityId);
    setSelectedIds(new Set(allLoops));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const toggleGlobalCopilot = (friendUserId: string) => {
    setGlobalCopilotIds((prev) =>
      prev.includes(friendUserId)
        ? prev.filter((id) => id !== friendUserId)
        : [...prev, friendUserId]
    );
  };

  const getEffectiveCopilotsForActivity = (stravaActivityId: string): string[] => {
    if (perActivityCopilots[stravaActivityId] !== undefined) {
      return perActivityCopilots[stravaActivityId];
    }
    return globalCopilotIds;
  };

  const toggleActivityCopilot = (
    stravaActivityId: string,
    friendUserId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const current = getEffectiveCopilotsForActivity(stravaActivityId);
    const next = current.includes(friendUserId)
      ? current.filter((id) => id !== friendUserId)
      : [...current, friendUserId];
    setPerActivityCopilots((prev) => ({
      ...prev,
      [stravaActivityId]: next,
    }));
    setSelectedIds((prev) => {
      const nextSet = new Set(prev);
      nextSet.add(stravaActivityId);
      return nextSet;
    });
  };

  const handleImportSelected = async () => {
    if (selectedIds.size === 0 || isImporting) return;
    setIsImporting(true);
    setError(null);

    try {
      const activityOverrides: Record<
        string,
        {
          forceLoop: boolean;
          captureMode: CaptureMode;
          copilotUserIds: string[];
        }
      > = {};

      for (const actId of selectedIds) {
        const mode = overrideModes[actId] ?? 'loop';
        const copilots = getEffectiveCopilotsForActivity(actId);
        activityOverrides[actId] = {
          forceLoop: mode === 'loop',
          captureMode: mode,
          copilotUserIds: copilots,
        };
      }

      const selectedArray = Array.from(selectedIds);
      const firstMode = overrideModes[selectedArray[0]] ?? 'loop';

      const res = await fetch('/api/sync/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityIds: selectedArray,
          roundId: roundId ?? undefined,
          forceLoop: firstMode === 'loop',
          captureMode: firstMode,
          copilotUserIds: globalCopilotIds,
          activityOverrides,
        }),
      });

      const data = (await res.json()) as SyncResultPayload;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to import selected activities.');
      }

      onSyncComplete(data);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to claim selected territories.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const displayedCandidates = candidates.filter((c) => {
    if (filterTab === 'loops') return c.isLoop;
    if (filterTab === 'flagged') return !c.isLoop;
    return true;
  });

  const totalEstimatedCells = candidates
    .filter((c) => selectedIds.has(c.stravaActivityId))
    .reduce((acc, c) => {
      const mode = overrideModes[c.stravaActivityId] ?? 'loop';
      return (
        acc +
        (mode === 'loop'
          ? c.loopPreviewCellsCount
          : c.corridorPreviewCellsCount)
      );
    }, 0);

  const totalEstimatedArea = candidates
    .filter((c) => selectedIds.has(c.stravaActivityId))
    .reduce((acc, c) => {
      const mode = overrideModes[c.stravaActivityId] ?? 'loop';
      return (
        acc +
        (mode === 'loop' ? c.loopPreviewAreaKm2 : c.corridorPreviewAreaKm2)
      );
    }, 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-5">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.2 }}
            className="relative z-10 flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-border-subtle bg-carbon-900 shadow-glass sm:max-h-[88dvh] sm:rounded-3xl"
          >
            {/* Top Signature Accent Bar */}
            <div
              className="h-1 w-full shrink-0 sm:h-1.5"
              style={{
                backgroundColor: playerColor,
                boxShadow: `0 0 20px ${playerColor}`,
              }}
            />

            {/* Mobile Drag Handle */}
            <div className="flex shrink-0 justify-center pt-1.5 sm:hidden">
              <div className="h-1 w-10 rounded-full bg-zinc-700" />
            </div>

            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-2 sm:items-start sm:gap-4 sm:px-6 sm:py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-strava-orange/40 bg-strava-orange/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-strava-orange sm:text-[10px]">
                    <Calendar className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    <span className=" sm:hidden">30D STRAVA SCAN</span>
                    <span className="hidden sm:inline">PAST 30 DAYS STRAVA SCANNER</span>
                  </span>
                  <span className="rounded border border-zinc-700 bg-carbon-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 sm:px-2 sm:text-[10px]">
                    TARGET: {roundName.toUpperCase()}
                  </span>
                </div>
                <h2 className="mt-1 truncate font-display text-sm font-bold text-white sm:text-xl">
                  Review &amp; Claim Strava Walks &amp; Runs
                </h2>
                <p className="mt-0.5 hidden text-xs text-zinc-400 sm:block">
                  Auto-detects closed loops (150m endpoint / 100m internal tolerance). Flagged walks can be manually forced as a loop or claimed as a 25m street corridor.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={loadCandidates}
                  disabled={isLoadingCandidates}
                  title="Rescan Strava"
                  aria-label="Rescan Strava"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/70 text-zinc-300 transition hover:border-zinc-700 hover:text-white disabled:opacity-50 sm:h-11 sm:w-11"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoadingCandidates ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Sync Review Modal"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/70 text-zinc-400 transition hover:border-zinc-700 hover:text-white sm:h-11 sm:w-11"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Filter & Summary Bar */}
            <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-subtle/70 bg-carbon-950/60 px-3.5 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2.5 sm:px-6 sm:py-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setFilterTab('all')}
                  className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs ${
                    filterTab === 'all'
                      ? 'border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan'
                      : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Filter className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="sm:hidden">All ({candidates.length})</span>
                  <span className="hidden sm:inline">All Scanned ({candidates.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTab('loops')}
                  className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs ${
                    filterTab === 'loops'
                      ? 'border-neon-lime/50 bg-neon-lime/15 text-neon-lime'
                      : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Layers className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="sm:hidden">Loops ({scanMeta.validLoopCount})</span>
                  <span className="hidden sm:inline">Auto-Verified Loops ({scanMeta.validLoopCount})</span>
                </button>

                {scanMeta.nonLoopCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilterTab('flagged')}
                    className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs ${
                      filterTab === 'flagged'
                        ? 'border-amber-400/50 bg-amber-400/15 text-amber-300'
                        : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <AlertTriangle className="h-3 w-3 text-amber-400 sm:h-3.5 sm:w-3.5" />
                    <span className="sm:hidden">Flagged ({scanMeta.nonLoopCount})</span>
                    <span className="hidden sm:inline">Flagged / Override ({scanMeta.nonLoopCount})</span>
                  </button>
                )}
              </div>

              {candidates.length > 0 && (
                <div className="flex items-center gap-1.5 font-mono text-[10px] sm:gap-2 sm:text-[11px]">
                  <button
                    type="button"
                    onClick={selectAllValidLoops}
                    className="rounded-md border border-neon-lime/40 bg-neon-lime/10 px-2 py-1 font-bold text-neon-lime transition hover:bg-neon-lime/20 sm:rounded-lg sm:px-2.5 sm:py-1.5"
                  >
                    Select All Valid
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-md border border-border-subtle bg-carbon-900 px-2 py-1 font-semibold text-zinc-300 transition hover:border-zinc-600 hover:text-white sm:rounded-lg sm:px-2.5 sm:py-1.5"
                  >
                    Deselect All
                  </button>
                  <button
                    type="button"
                    onClick={selectAllGpsActivities}
                    className="px-1.5 py-0.5 text-zinc-400 transition hover:text-neon-cyan hover:underline"
                  >
                    All GPS ({candidates.length})
                  </button>
                </div>
              )}
            </div>

            {/* Co-op Capture Bar: "Walked with Friends" Multi-Select */}
            {availableFriends.length > 0 && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle/70 bg-carbon-950/90 px-3.5 py-1.5 sm:flex-wrap sm:gap-2.5 sm:px-6 sm:py-2.5">
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neon-magenta/40 bg-neon-magenta/10 text-neon-magenta sm:h-7 sm:w-7 sm:rounded-lg">
                    <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  </span>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-white sm:text-[11px]">
                      <span className="sm:hidden">Co-op Walk:</span>
                      <span className="hidden sm:inline">Walked with Friends (Co-op Capture)</span>
                    </p>
                    <p className="hidden font-mono text-[10px] text-zinc-400 sm:block">
                      Tag squadmates who walked with you to share H3 hex ownership &amp; leaderboard credit:
                    </p>
                  </div>
                </div>

                <div className="flex flex-1 items-center justify-end gap-1.5 overflow-x-auto sm:flex-initial sm:flex-wrap">
                  {availableFriends.map((friend) => {
                    const isTagged = globalCopilotIds.includes(friend.userId);
                    return (
                      <button
                        key={friend.userId}
                        type="button"
                        onClick={() => toggleGlobalCopilot(friend.userId)}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold transition sm:min-h-[34px] sm:rounded-xl sm:px-2.5 sm:text-xs ${
                          isTagged
                            ? 'border-white/70 bg-zinc-800 text-white shadow'
                            : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                        }`}
                        style={
                          isTagged
                            ? {
                                borderColor: friend.colorHex,
                                boxShadow: `0 0 12px ${friend.colorHex}33`,
                              }
                            : undefined
                        }
                      >
                        <span
                          className="h-2 w-2 rounded-full sm:h-2.5 sm:w-2.5"
                          style={{ backgroundColor: friend.colorHex }}
                        />
                        <span>{friend.displayName}</span>
                        {isTagged && (
                          <Check
                            className="h-3 w-3"
                            style={{ color: friend.colorHex }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Body: Candidate List */}
            <div className="touch-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              {error && (
                <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
              )}

              {isLoadingCandidates ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Loader2
                    className="h-9 w-9 animate-spin"
                    style={{ color: playerColor }}
                  />
                  <p className="mt-3 font-display text-sm font-bold text-white">
                    Scanning 30 Days of Strava Telemetry...
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Unkinking GPS polygons, checking 150m endpoint & 100m internal loop closures, and computing H3 hex yields.
                  </p>
                </div>
              ) : displayedCandidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-border-subtle bg-carbon-950/60 p-8 text-center">
                  <Hexagon className="h-10 w-10 text-zinc-600" />
                  <p className="mt-3 text-sm font-semibold text-zinc-200">
                    No Matching Activities in This Filter
                  </p>
                  <p className="mt-1 max-w-md text-xs text-zinc-400">
                    Switch to &ldquo;All Scanned&rdquo; above to view all walks, runs, and hikes from the past 30 days.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {displayedCandidates.map((item) => {
                    const hasGps = item.captureMode !== 'no_gps';
                    const isSelected = selectedIds.has(item.stravaActivityId);
                    const effectiveMode: CaptureMode =
                      overrideModes[item.stravaActivityId] ?? 'loop';

                    const activeCellsCount =
                      effectiveMode === 'loop'
                        ? item.loopPreviewCellsCount
                        : item.corridorPreviewCellsCount;
                    const activeAreaKm2 =
                      effectiveMode === 'loop'
                        ? item.loopPreviewAreaKm2
                        : item.corridorPreviewAreaKm2;

                    return (
                      <div
                        key={item.stravaActivityId}
                        onClick={() =>
                          toggleSelection(item.stravaActivityId, hasGps)
                        }
                        className={`group rounded-2xl border p-2.5 transition sm:p-3.5 ${
                          !hasGps
                            ? 'cursor-not-allowed border-border-subtle/50 bg-carbon-950/40 opacity-60'
                            : isSelected
                              ? 'cursor-pointer border-white/50 bg-zinc-800/80 shadow-lg'
                              : 'cursor-pointer border-border-subtle bg-carbon-950/80 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3.5">
                            {/* Selection Checkbox */}
                            <div
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition sm:h-6 sm:w-6 sm:rounded-lg ${
                                !hasGps
                                  ? 'border-zinc-700 bg-carbon-900 text-zinc-600'
                                  : isSelected
                                    ? 'border-transparent text-carbon-950'
                                    : 'border-zinc-600 bg-carbon-900 text-transparent group-hover:border-zinc-400'
                              }`}
                              style={
                                hasGps && isSelected
                                  ? {
                                      backgroundColor: playerColor,
                                      boxShadow: `0 0 12px ${playerColor}`,
                                    }
                                  : undefined
                              }
                            >
                              <Check className="h-3.5 w-3.5 stroke-[3]" />
                            </div>

                            {/* SVG Route Trajectory Preview */}
                            <RoutePreviewSvg
                              routeGeojson={item.routeGeojson}
                              color={
                                !hasGps
                                  ? '#71717a'
                                  : effectiveMode === 'loop'
                                    ? playerColor
                                    : '#22c55e'
                              }
                              size={52}
                              isLoop={effectiveMode === 'loop'}
                            />

                            {/* Activity Title & Primary Telemetry */}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider sm:text-[10px] ${
                                      item.isLoop
                                        ? 'border border-neon-lime/40 bg-neon-lime/10 text-neon-lime'
                                        : !hasGps
                                          ? 'border border-zinc-700 bg-zinc-800 text-zinc-400'
                                          : 'border border-amber-400/40 bg-amber-400/10 text-amber-300'
                                    }`}
                                  >
                                    {item.isLoop
                                      ? item.detectionStatus ===
                                        'valid_internal_loop'
                                        ? 'INTERNAL LOOP'
                                        : 'CLOSED LOOP'
                                      : !hasGps
                                        ? 'NO GPS'
                                        : effectiveMode === 'loop'
                                          ? 'FORCED LOOP'
                                          : '25M CORRIDOR'}
                                  </span>

                                  <span className="rounded border border-zinc-700/80 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 sm:text-[10px]">
                                    {item.sportType}
                                  </span>

                                  {item.alreadyImportedInRound && (
                                    <span className="inline-flex items-center gap-1 rounded border border-neon-cyan/40 bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-neon-cyan sm:text-[10px]">
                                      <CheckCircle2 className="h-2.5 w-2.5" />
                                      IN ROUND
                                    </span>
                                  )}
                                </div>

                                {hasGps && (
                                  <span
                                    className="rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold sm:hidden"
                                    style={{
                                      borderColor: `${playerColor}66`,
                                      backgroundColor: `${playerColor}18`,
                                      color: playerColor,
                                    }}
                                  >
                                    +{activeCellsCount} HEX
                                  </span>
                                )}
                              </div>

                              <h3 className="mt-0.5 truncate text-sm font-bold text-white">
                                {item.name}
                              </h3>

                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10px] text-zinc-400 sm:text-[11px]">
                                <span className="flex items-center gap-1 text-zinc-200">
                                  <Navigation className="h-2.5 w-2.5 text-zinc-500 sm:h-3 sm:w-3" />
                                  {formatDistanceKm(item.distanceMeters)} km
                                </span>
                                <span className="flex items-center gap-1">
                                  <Timer className="h-2.5 w-2.5 text-zinc-500 sm:h-3 sm:w-3" />
                                  {formatDuration(item.movingTimeSeconds)}
                                </span>
                                <span className="text-zinc-300">
                                  {formatPaceMinPerKm(
                                    item.distanceMeters,
                                    item.movingTimeSeconds
                                  )}
                                </span>
                                <span className="text-zinc-500">
                                  • {formatRelativeTime(item.startedAt)}
                                </span>
                                {/^\d+$/.test(item.stravaActivityId) && (
                                  <a
                                    href={`https://www.strava.com/activities/${encodeURIComponent(
                                      item.stravaActivityId
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 text-strava-orange hover:underline"
                                  >
                                    <span>Strava</span>
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>

                              {/* Per-Activity Co-op Friends Tagging Row */}
                              {hasGps && availableFriends.length > 0 && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1.5 flex flex-wrap items-center gap-1.5"
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenCopilotPickerFor((prev) =>
                                        prev === item.stravaActivityId
                                          ? null
                                          : item.stravaActivityId
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-carbon-900/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-zinc-300 transition hover:border-neon-magenta/50 hover:text-white"
                                  >
                                    <UserPlus className="h-3 w-3 text-neon-magenta" />
                                    <span>
                                      {getEffectiveCopilotsForActivity(
                                        item.stravaActivityId
                                      ).length > 0
                                        ? `Co-op (${
                                            getEffectiveCopilotsForActivity(
                                              item.stravaActivityId
                                            ).length
                                          } tagged)`
                                        : 'Walked with Friends'}
                                    </span>
                                  </button>

                                  {getEffectiveCopilotsForActivity(
                                    item.stravaActivityId
                                  ).map((coId) => {
                                    const f = availableFriends.find(
                                      (fr) => fr.userId === coId
                                    );
                                    if (!f) return null;
                                    return (
                                      <span
                                        key={coId}
                                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold"
                                        style={{
                                          borderColor: `${f.colorHex}66`,
                                          backgroundColor: `${f.colorHex}18`,
                                          color: f.colorHex,
                                        }}
                                      >
                                        <span
                                          className="h-1.5 w-1.5 rounded-full"
                                          style={{
                                            backgroundColor: f.colorHex,
                                          }}
                                        />
                                        <span>+{f.displayName}</span>
                                      </span>
                                    );
                                  })}

                                  {openCopilotPickerFor ===
                                    item.stravaActivityId && (
                                    <div className="mt-1 flex w-full flex-wrap items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-900/95 p-2">
                                      <span className="font-mono text-[10px] text-zinc-400">
                                        Co-Walkers:
                                      </span>
                                      {availableFriends.map((friend) => {
                                        const active =
                                          getEffectiveCopilotsForActivity(
                                            item.stravaActivityId
                                          ).includes(friend.userId);
                                        return (
                                          <button
                                            key={friend.userId}
                                            type="button"
                                            onClick={(e) =>
                                              toggleActivityCopilot(
                                                item.stravaActivityId,
                                                friend.userId,
                                                e
                                              )
                                            }
                                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[10px] font-semibold transition ${
                                              active
                                                ? 'border-white bg-zinc-800 text-white'
                                                : 'border-border-subtle bg-carbon-950 text-zinc-400 hover:text-white'
                                            }`}
                                          >
                                            <span
                                              className="h-2 w-2 rounded-full"
                                              style={{
                                                backgroundColor:
                                                  friend.colorHex,
                                              }}
                                            />
                                            <span>{friend.displayName}</span>
                                            {active && (
                                              <Check className="h-2.5 w-2.5 text-neon-lime" />
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: Estimated Territory Yield Badge (Desktop) */}
                          {hasGps && (
                            <div className="hidden shrink-0 sm:flex sm:flex-col sm:items-end sm:gap-1">
                              <span
                                className="rounded-lg border px-2.5 py-1 font-mono text-xs font-bold"
                                style={{
                                  borderColor: `${playerColor}66`,
                                  backgroundColor: `${playerColor}18`,
                                  color: playerColor,
                                }}
                              >
                                +{activeCellsCount} HEX
                              </span>
                              <span className="font-mono text-[10px] text-zinc-400">
                                {formatAreaKm2(activeAreaKm2)} km² (
                                {effectiveMode === 'loop'
                                  ? 'Loop Fill'
                                  : '25m Corridor'}
                                )
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Debug Telemetry Strip (Compact 1-line on mobile, full details on desktop) */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border-subtle/60 bg-carbon-900/70 px-2.5 py-1 font-mono text-[9px] text-zinc-400 sm:mt-2.5 sm:rounded-xl sm:px-3 sm:py-1.5 sm:text-[10px]">
                          <span className="flex items-center gap-1 text-zinc-300">
                            <Cpu className="h-3 w-3 text-neon-cyan" />
                            <span>
                              Gap:{' '}
                              {item.closureDistanceMeters !== null
                                ? `${Math.round(item.closureDistanceMeters)}m`
                                : 'N/A'}
                            </span>
                          </span>
                          {item.internalClosureDistanceMeters !== null && (
                            <span className="hidden sm:inline">
                              • Min internal:{' '}
                              {Math.round(item.internalClosureDistanceMeters)}m
                            </span>
                          )}
                          <span className="text-zinc-600">•</span>
                          <span>
                            {formatAreaKm2(activeAreaKm2)} km²{' '}
                            {effectiveMode === 'loop' ? 'Loop' : 'Corridor'}
                          </span>
                          <span className="hidden text-zinc-600 sm:inline">•</span>
                          <span className="hidden text-zinc-300 sm:inline">
                            {item.detectionReason}
                          </span>
                        </div>

                        {/* Warning Banner & Manual Override Controls when activity fails auto-loop check */}
                        {!item.isLoop && hasGps && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2.5 flex flex-col justify-between gap-2.5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 sm:flex-row sm:items-center"
                          >
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                              <div>
                                <p className="text-xs font-bold text-amber-200">
                                  Flagged as Open Path — Choose Manual Override:
                                </p>
                                <p className="text-[11px] text-amber-100/80">
                                  Bridge the {Math.round(item.closureDistanceMeters ?? 0)}m endpoint gap to fill the enclosed loop, or claim the 25m buffered street corridor.
                                </p>
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) =>
                                  handleChooseOverrideMode(
                                    item.stravaActivityId,
                                    'loop',
                                    e
                                  )
                                }
                                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-[11px] font-bold transition ${
                                  effectiveMode === 'loop' && isSelected
                                    ? 'border-neon-cyan bg-neon-cyan text-carbon-950 shadow-neon-cyan'
                                    : 'border-neon-cyan/50 bg-carbon-950/90 text-neon-cyan hover:bg-neon-cyan/20'
                                }`}
                              >
                                <Layers className="h-3.5 w-3.5" />
                                <span>
                                  Force as Loop (+{item.loopPreviewCellsCount} HEX)
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) =>
                                  handleChooseOverrideMode(
                                    item.stravaActivityId,
                                    'corridor',
                                    e
                                  )
                                }
                                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-[11px] font-bold transition ${
                                  effectiveMode === 'corridor' && isSelected
                                    ? 'border-neon-lime bg-neon-lime text-carbon-950'
                                    : 'border-neon-lime/50 bg-carbon-950/90 text-neon-lime hover:bg-neon-lime/20'
                                }`}
                              >
                                <Route className="h-3.5 w-3.5" />
                                <span>
                                  Claim as Corridor (+{item.corridorPreviewCellsCount} HEX)
                                </span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer: Selection Totals & Import Button */}
            <div className="safe-area-bottom flex shrink-0 flex-col gap-2 border-t border-border-subtle bg-carbon-950/90 px-3.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-4">
              <div className="flex items-center justify-between gap-2 sm:block">
                <p className="font-mono text-[11px] font-bold text-white sm:text-xs">
                  {selectedIds.size}{' '}
                  {selectedIds.size === 1 ? 'Activity' : 'Activities'} Selected
                </p>
                <p className="font-mono text-[10px] text-zinc-400 sm:text-[11px]">
                  +{totalEstimatedCells} HEX ({formatAreaKm2(totalEstimatedArea)} km²)
                </p>
              </div>

              <div className="flex items-center gap-2 sm:gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex min-h-[40px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 font-mono text-xs font-semibold text-zinc-300 transition hover:border-zinc-600 hover:text-white sm:min-h-[48px] sm:px-4 sm:py-2.5"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleImportSelected}
                  disabled={selectedIds.size === 0 || isImporting}
                  style={{
                    backgroundColor:
                      selectedIds.size > 0 ? playerColor : undefined,
                    boxShadow:
                      selectedIds.size > 0
                        ? `0 0 22px ${playerColor}44`
                        : undefined,
                  }}
                  className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-800 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-carbon-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 sm:min-h-[48px] sm:flex-initial sm:gap-2 sm:px-5 sm:py-2.5 sm:text-xs"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Claiming...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span>
                        Claim Selected Activities ({selectedIds.size})
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
