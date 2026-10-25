'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import RoutePreviewSvg from '@/components/RoutePreviewSvg';
import type { SyncResultPayload } from '@/components/SyncButton';
import type { StravaSyncCandidate } from '@/app/api/sync/candidates/route';
import type { CaptureMode } from '@/lib/geo';
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
  Filter,
  Hexagon,
  Layers,
  Loader2,
  Navigation,
  RefreshCw,
  Route,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';

export interface SyncReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  roundId: string | null;
  roundName: string;
  playerColor: string;
  onSyncComplete: (result: SyncResultPayload) => void;
}

type FilterTab = 'all' | 'loops' | 'flagged';

export default function SyncReviewModal({
  isOpen,
  onClose,
  roundId,
  roundName,
  playerColor,
  onSyncComplete,
}: SyncReviewModalProps) {
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [candidates, setCandidates] = useState<StravaSyncCandidate[]>([]);
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
        totalActivitiesFetched?: number;
        validLoopCount?: number;
        nonLoopCount?: number;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to scan 30-day Strava history.');
      }

      const list = (data.candidates ?? []) as StravaSyncCandidate[];
      setCandidates(list);
      setScanMeta({
        totalFetched: data.totalActivitiesFetched ?? list.length,
        validLoopCount:
          data.validLoopCount ?? list.filter((c) => c.isLoop).length,
        nonLoopCount:
          data.nonLoopCount ?? list.filter((c) => !c.isLoop).length,
      });

      const initialSelected = new Set<string>();
      const initialModes: Record<string, CaptureMode> = {};

      for (const item of list) {
        // Default mode: 'loop' for auto-loops, 'loop' (Force as Loop) for flagged walks with loop cells
        initialModes[item.stravaActivityId] = item.isLoop ? 'loop' : 'loop';
        if (item.isLoop && !item.alreadyImportedInRound) {
          initialSelected.add(item.stravaActivityId);
        }
      }

      setOverrideModes(initialModes);
      setSelectedIds(initialSelected);
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

  const handleImportSelected = async () => {
    if (selectedIds.size === 0 || isImporting) return;
    setIsImporting(true);
    setError(null);

    try {
      const activityOverrides: Record<
        string,
        { forceLoop: boolean; captureMode: CaptureMode }
      > = {};

      for (const actId of selectedIds) {
        const mode = overrideModes[actId] ?? 'loop';
        activityOverrides[actId] = {
          forceLoop: mode === 'loop',
          captureMode: mode,
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
            className="relative z-10 flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-border-subtle bg-carbon-900 shadow-glass sm:rounded-3xl"
          >
            {/* Top Signature Accent Bar */}
            <div
              className="h-1.5 w-full shrink-0"
              style={{
                backgroundColor: playerColor,
                boxShadow: `0 0 20px ${playerColor}`,
              }}
            />

            {/* Mobile Drag Handle */}
            <div className="flex shrink-0 justify-center pt-2 sm:hidden">
              <div className="h-1.5 w-12 rounded-full bg-zinc-700" />
            </div>

            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-3.5 sm:px-6 sm:py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-strava-orange/40 bg-strava-orange/15 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-strava-orange">
                    <Calendar className="h-3 w-3" />
                    PAST 30 DAYS STRAVA SCANNER
                  </span>
                  <span className="rounded border border-zinc-700 bg-carbon-950 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                    TARGET: {roundName.toUpperCase()}
                  </span>
                </div>
                <h2 className="mt-1.5 font-display text-lg font-bold text-white sm:text-xl">
                  Review & Claim Strava Walks & Runs
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Auto-detects closed loops (150m endpoint / 100m internal tolerance). Flagged walks can be manually forced as a loop or claimed as a 25m street corridor.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadCandidates}
                  disabled={isLoadingCandidates}
                  title="Rescan Strava"
                  aria-label="Rescan Strava"
                  className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/70 text-zinc-300 transition hover:border-zinc-700 hover:text-white disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoadingCandidates ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close Sync Review Modal"
                  className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/70 text-zinc-400 transition hover:border-zinc-700 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Filter & Summary Bar */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle/70 bg-carbon-950/60 px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilterTab('all')}
                  className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition ${
                    filterTab === 'all'
                      ? 'border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan'
                      : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span>All Scanned ({candidates.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTab('loops')}
                  className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition ${
                    filterTab === 'loops'
                      ? 'border-neon-lime/50 bg-neon-lime/15 text-neon-lime'
                      : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Auto-Verified Loops ({scanMeta.validLoopCount})</span>
                </button>

                {scanMeta.nonLoopCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilterTab('flagged')}
                    className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition ${
                      filterTab === 'flagged'
                        ? 'border-amber-400/50 bg-amber-400/15 text-amber-300'
                        : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <span>Flagged / Override ({scanMeta.nonLoopCount})</span>
                  </button>
                )}
              </div>

              {candidates.length > 0 && (
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <button
                    type="button"
                    onClick={selectAllGpsActivities}
                    className="text-neon-cyan hover:underline"
                  >
                    Select All ({candidates.length})
                  </button>
                  <span className="text-zinc-600">•</span>
                  <button
                    type="button"
                    onClick={selectAllValidLoops}
                    className="text-zinc-300 hover:text-white hover:underline"
                  >
                    Auto-Loops Only
                  </button>
                  <span className="text-zinc-600">•</span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-zinc-400 hover:text-white hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Body: Candidate List */}
            <div className="touch-scroll flex-1 overflow-y-auto p-4 sm:p-6">
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
                        className={`group rounded-2xl border p-3.5 transition ${
                          !hasGps
                            ? 'cursor-not-allowed border-border-subtle/50 bg-carbon-950/40 opacity-60'
                            : isSelected
                              ? 'cursor-pointer border-white/50 bg-zinc-800/80 shadow-lg'
                              : 'cursor-pointer border-border-subtle bg-carbon-950/80 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 items-center gap-3.5">
                            {/* Selection Checkbox */}
                            <div
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
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
                              size={64}
                              isLoop={effectiveMode === 'loop'}
                            />

                            {/* Activity Title & Primary Telemetry */}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
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
                                      ? 'VERIFIED INTERNAL LOOP'
                                      : 'VERIFIED CLOSED LOOP'
                                    : !hasGps
                                      ? 'NO GPS STREAM'
                                      : effectiveMode === 'loop'
                                        ? 'OVERRIDE: FORCED LOOP'
                                        : 'OVERRIDE: 25M CORRIDOR'}
                                </span>

                                <span className="rounded border border-zinc-700/80 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                                  {item.sportType}
                                </span>

                                {item.alreadyImportedInRound && (
                                  <span className="inline-flex items-center gap-1 rounded border border-neon-cyan/40 bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neon-cyan">
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                    IN ROUND (CLICK TO RE-CLAIM)
                                  </span>
                                )}
                              </div>

                              <h3 className="mt-1 truncate text-sm font-bold text-white">
                                {item.name}
                              </h3>

                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-400">
                                <span className="flex items-center gap-1">
                                  <Navigation className="h-3 w-3 text-zinc-500" />
                                  {formatDistanceKm(item.distanceMeters)} km
                                </span>
                                <span className="flex items-center gap-1">
                                  <Timer className="h-3 w-3 text-zinc-500" />
                                  {formatDuration(item.movingTimeSeconds)}
                                </span>
                                <span className="text-zinc-300">
                                  {formatPaceMinPerKm(
                                    item.distanceMeters,
                                    item.movingTimeSeconds
                                  )}{' '}
                                  /km
                                </span>
                                <span className="text-zinc-500">
                                  • {formatRelativeTime(item.startedAt)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Right: Estimated Territory Yield Badge */}
                          {hasGps && (
                            <div className="flex shrink-0 flex-row items-center justify-between gap-2 border-t border-border-subtle/50 pt-2 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
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

                        {/* Debug Telemetry Strip (Always visible so player sees exact algorithm metrics) */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border-subtle/60 bg-carbon-900/70 px-3 py-1.5 font-mono text-[10px] text-zinc-400">
                          <span className="flex items-center gap-1 text-zinc-300">
                            <Cpu className="h-3 w-3 text-neon-cyan" />
                            <span>
                              Start/End gap:{' '}
                              {item.closureDistanceMeters !== null
                                ? `${Math.round(item.closureDistanceMeters)}m`
                                : 'N/A'}
                            </span>
                          </span>
                          {item.internalClosureDistanceMeters !== null && (
                            <>
                              <span className="text-zinc-600">•</span>
                              <span>
                                Min internal gap:{' '}
                                {Math.round(item.internalClosureDistanceMeters)}m
                              </span>
                            </>
                          )}
                          <span className="text-zinc-600">•</span>
                          <span>Points processed: {item.pointsProcessed}</span>
                          <span className="text-zinc-600">•</span>
                          <span className="text-zinc-300">
                            Status: {item.detectionReason}
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
            <div className="safe-area-bottom flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-carbon-950/90 px-5 py-4 sm:px-6">
              <div>
                <p className="font-mono text-xs font-bold text-white">
                  {selectedIds.size}{' '}
                  {selectedIds.size === 1 ? 'Activity' : 'Activities'} Selected
                  for Import
                </p>
                <p className="font-mono text-[11px] text-zinc-400">
                  Estimated Yield: +{totalEstimatedCells} H3 Hexes (
                  {formatAreaKm2(totalEstimatedArea)} km²) in {roundName}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-900 px-4 py-2.5 font-mono text-xs font-semibold text-zinc-300 transition hover:border-zinc-600 hover:text-white"
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
                  className="flex min-h-[48px] items-center gap-2 rounded-xl bg-zinc-800 px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-carbon-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Claiming Territories...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>Import & Claim ({selectedIds.size})</span>
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
