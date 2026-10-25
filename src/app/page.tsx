'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { FeatureCollection, Polygon } from 'geojson';
import type { TerritoryFeatureProperties } from '@/lib/geo';
import type {
  LeaderboardEntry,
  ActivityFeedItem,
  RoundSummary,
} from '@/lib/d1';
import MapView, { type HomeArea, type MapViewport } from '@/components/Map';
import Leaderboard from '@/components/Leaderboard';
import ActivityFeed from '@/components/ActivityFeed';
import SyncButton, { type SyncResultPayload } from '@/components/SyncButton';
import SyncReviewModal from '@/components/SyncReviewModal';
import RoundsModal from '@/components/RoundsModal';
import ConnectModal from '@/components/ConnectModal';
import { formatAreaKm2 } from '@/lib/utils';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Crown,
  Flame,
  Hexagon,
  Layers,
  Lock,
  LogIn,
  Maximize2,
  Shield,
  SlidersHorizontal,
  User,
  X,
  Zap,
} from 'lucide-react';

interface LeaderboardApiResponse {
  round: RoundSummary;
  rounds: RoundSummary[];
  leaderboard: LeaderboardEntry[];
  totalGridCells: number;
  totalGridAreaKm2: number;
  currentAthlete: LeaderboardEntry | null;
  isAuthenticated: boolean;
  currentUserHome?: HomeArea | null;
  stravaConfigured: boolean;
}

interface ActivitiesApiResponse {
  activities: ActivityFeedItem[];
  count: number;
}

export default function HomePage() {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState<RoundSummary | null>(null);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);

  const [territoriesGeoJSON, setTerritoriesGeoJSON] = useState<FeatureCollection<
    Polygon,
    TerritoryFeatureProperties
  > | null>(null);
  const [territoriesRoundId, setTerritoriesRoundId] = useState<string | null>(
    null
  );
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalGridCells, setTotalGridCells] = useState<number>(0);
  const [totalGridAreaKm2, setTotalGridAreaKm2] = useState<number>(0);
  const [currentAthlete, setCurrentAthlete] = useState<LeaderboardEntry | null>(
    null
  );
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [homeArea, setHomeArea] = useState<HomeArea | null>(null);
  const mapViewRef = useRef<MapViewport | null>(null);
  const [stravaConfigured, setStravaConfigured] = useState<boolean>(false);
  const [activities, setActivities] = useState<ActivityFeedItem[]>([]);
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true);
  const [lastSyncResult, setLastSyncResult] =
    useState<SyncResultPayload | null>(null);

  // Interactive HUD & Modals state
  const [focusedOwnerId, setFocusedOwnerId] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] =
    useState<ActivityFeedItem | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{
    lng: number;
    lat: number;
    zoom?: number;
    ts: number;
  } | null>(null);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState<boolean>(true);
  const [isMobileFeedOpen, setIsMobileFeedOpen] = useState<boolean>(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [isSyncReviewModalOpen, setIsSyncReviewModalOpen] =
    useState<boolean>(false);
  const [isRoundsModalOpen, setIsRoundsModalOpen] = useState<boolean>(false);

  const fetchArenaTelemetry = useCallback(
    async (explicitRoundId?: string | null) => {
      try {
        const targetRound =
          explicitRoundId !== undefined ? explicitRoundId : selectedRoundId;
        const roundQuery = targetRound
          ? `?roundId=${encodeURIComponent(targetRound)}`
          : '';
        const actQuery = targetRound
          ? `?roundId=${encodeURIComponent(targetRound)}&limit=25`
          : '?limit=25';

        const [territoriesRes, leaderboardRes, activitiesRes] =
          await Promise.all([
            fetch(`/api/territories${roundQuery}`, { cache: 'no-store' }),
            fetch(`/api/leaderboard${roundQuery}`, { cache: 'no-store' }),
            fetch(`/api/activities${actQuery}`, { cache: 'no-store' }),
          ]);

        const lbData = leaderboardRes.ok
          ? ((await leaderboardRes.json()) as LeaderboardApiResponse)
          : null;

        if (territoriesRes.ok) {
          const geojson = (await territoriesRes.json()) as FeatureCollection<
            Polygon,
            TerritoryFeatureProperties
          >;
          // Set data and the round it belongs to together so the map never fits stale/mismatched data
          setTerritoriesRoundId(lbData?.round?.id ?? targetRound ?? null);
          setTerritoriesGeoJSON(geojson);
        }

        if (lbData) {
          if (lbData.round) {
            setCurrentRound(lbData.round);
            if (!targetRound) {
              setSelectedRoundId(lbData.round.id);
            }
          }
          setRounds(lbData.rounds ?? []);
          setLeaderboard(lbData.leaderboard ?? []);
          setTotalGridCells(lbData.totalGridCells ?? 0);
          setTotalGridAreaKm2(lbData.totalGridAreaKm2 ?? 0);
          setCurrentAthlete(lbData.currentAthlete ?? null);
          setIsAuthenticated(Boolean(lbData.isAuthenticated));
          setHomeArea(lbData.currentUserHome ?? null);
          setStravaConfigured(Boolean(lbData.stravaConfigured));
        }

        if (activitiesRes.ok) {
          const actData = (await activitiesRes.json()) as ActivitiesApiResponse;
          setActivities(actData.activities ?? []);
        }
      } catch (err) {
        console.error('[INTVL 2.0 Arena Telemetry Fetch Error]:', err);
      } finally {
        setIsLoadingInitial(false);
      }
    },
    [selectedRoundId]
  );

  useEffect(() => {
    fetchArenaTelemetry();
  }, [fetchArenaTelemetry]);

  const handleSelectRound = useCallback(
    async (nextRoundId: string) => {
      setSelectedRoundId(nextRoundId);
      setFocusedOwnerId(null);
      setSelectedActivity(null);
      await fetchArenaTelemetry(nextRoundId);
    },
    [fetchArenaTelemetry]
  );

  const handleSyncComplete = useCallback(
    async (result: SyncResultPayload) => {
      setLastSyncResult(result);
      await fetchArenaTelemetry(selectedRoundId);
      const firstActivity = result.activities?.[0];
      if (firstActivity && firstActivity.centroid) {
        setFlyToTarget({
          lng: firstActivity.centroid[0],
          lat: firstActivity.centroid[1],
          zoom: 14.3,
          ts: Date.now(),
        });
      }
    },
    [fetchArenaTelemetry, selectedRoundId]
  );

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setCurrentAthlete(null);
    setIsAuthenticated(false);
    await fetchArenaTelemetry(selectedRoundId);
  }, [fetchArenaTelemetry, selectedRoundId]);

  const activeColor = currentAthlete?.color || '#00f0ff';
  // Fallback focus target when no home area is set: the user's most recent activity start point
  const latestActivityStart = (() => {
    if (!currentAthlete) return null;
    const mine = activities
      .filter(
        (a) =>
          a.userId === currentAthlete.userId &&
          a.startLat !== null &&
          a.startLng !== null
      )
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )[0];
    return mine
      ? { lat: mine.startLat as number, lng: mine.startLng as number }
      : null;
  })();
  const currentUserId = currentAthlete?.userId ?? null;
  const isRoundAdmin = Boolean(
    currentUserId &&
      currentRound &&
      (!currentRound.createdBy || currentRound.createdBy === currentUserId)
  );
  const isRoundConcluded = Boolean(
    currentRound?.status === 'archived' || currentRound?.isConcluded
  );

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-carbon-950">
      {/* 1. Full-Bleed MapLibre GL Vector Canvas (Auckland, NZ Default + Auto-Fit Bounds) */}
      <MapView
        roundId={currentRound?.id ?? selectedRoundId}
        territoriesRoundId={territoriesRoundId}
        territoriesGeoJSON={territoriesGeoJSON}
        focusedOwnerId={focusedOwnerId}
        onClearOwnerFocus={() => setFocusedOwnerId(null)}
        selectedActivity={selectedActivity}
        onClearSelectedActivity={() => setSelectedActivity(null)}
        flyToTarget={flyToTarget}
        homeArea={homeArea}
        isAuthenticated={isAuthenticated}
        latestActivityStart={latestActivityStart}
        viewportRef={mapViewRef}
      />

      {/* 2. Top Glassmorphism HUD: Live Territory Leaderboard, Round Switcher & Standings */}
      <Leaderboard
        round={currentRound}
        roundsCount={rounds.length || 1}
        leaderboard={leaderboard}
        totalGridCells={totalGridCells}
        totalGridAreaKm2={totalGridAreaKm2}
        currentAthlete={currentAthlete}
        isAuthenticated={isAuthenticated}
        focusedOwnerId={focusedOwnerId}
        onSelectOwner={(uid) => setFocusedOwnerId(uid)}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        onOpenRoundsModal={() => setIsRoundsModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* ================================================================
          3A. MOBILE COMPACT BOTTOM DOCK (< 768px / md:hidden)
          Keeps full-bleed map dominance while providing >= 48x48px touch targets
      ================================================================ */}
      <section className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="pointer-events-auto mx-auto max-w-md rounded-2xl border border-border-subtle bg-carbon-900/92 p-2.5 shadow-glass backdrop-blur-2xl">
          {/* Compact 1-Line Telemetry Strip */}
          <div className="mb-2 flex items-center justify-between gap-2 px-1 font-mono text-[11px] text-zinc-300">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: activeColor }}
              />
              <span className="font-semibold text-white">
                {isAuthenticated && currentAthlete
                  ? currentAthlete.displayName
                  : 'Auckland Arena'}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-[10px]">
              <span>
                <strong style={{ color: activeColor }}>
                  {currentAthlete?.activeCells ?? 0}
                </strong>{' '}
                hex
              </span>
              <span className="text-zinc-600">•</span>
              <span>
                <strong className="text-white">
                  {formatAreaKm2(currentAthlete?.activeAreaKm2 ?? 0)}
                </strong>{' '}
                km²
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-neon-amber">
                {currentAthlete ? `#${currentAthlete.rank}` : '—'}
              </span>
            </div>
          </div>

          {/* Primary Touch Action Row (All buttons >= 48px height) */}
          <div className="flex items-center gap-2">
            {!isAuthenticated ? (
              <Link
                href="/login"
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-neon-cyan/50 bg-neon-cyan/15 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-neon-cyan"
              >
                <LogIn className="h-4 w-4" />
                <span>Log In to Claim Turf</span>
              </Link>
            ) : !currentAthlete?.stravaConnected ? (
              <a
                href="/api/auth/strava"
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-strava-orange/70 bg-gradient-to-r from-strava-orange to-[#ff6723] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow"
              >
                <Zap className="h-4 w-4 fill-current" />
                <span>Connect Strava</span>
              </a>
            ) : (
              <button
                type="button"
                disabled={isRoundConcluded}
                onClick={() => setIsSyncReviewModalOpen(true)}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-strava-orange/70 bg-gradient-to-r from-strava-orange to-[#ff6723] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow active:scale-[0.99] disabled:opacity-50"
              >
                {isRoundConcluded ? (
                  <Lock className="h-4 w-4 shrink-0" />
                ) : (
                  <Layers className="h-4 w-4 shrink-0" />
                )}
                <span>
                  {isRoundConcluded ? 'Round Concluded' : 'Sync Strava Loops'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsMobileFeedOpen(true)}
              aria-label="Open Activity Conquest Feed"
              className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950/90 px-3.5 py-2.5 font-mono text-xs font-semibold text-zinc-200 active:scale-95"
            >
              <Activity className="h-4 w-4 text-neon-magenta" />
              <span>Feed</span>
              <span className="rounded-md bg-neon-magenta/20 px-1.5 py-0.5 text-[10px] font-bold text-neon-magenta">
                {activities.length}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Mobile Draggable Bottom Sheet for Round Loop Feed */}
      <AnimatePresence>
        {isMobileFeedOpen && (
          <div className="fixed inset-0 z-50 flex items-end md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileFeedOpen(false)}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.35 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 80 || info.velocity.y > 400) {
                  setIsMobileFeedOpen(false);
                }
              }}
              className="safe-bottom relative z-10 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border-subtle bg-carbon-900 shadow-glass"
            >
              {/* Drag Handle */}
              <div className="flex shrink-0 flex-col items-center pt-2.5 pb-1">
                <div className="h-1.5 w-12 rounded-full bg-zinc-700" />
              </div>

              <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-neon-magenta/40 bg-neon-magenta/10">
                    <Activity className="h-4 w-4 text-neon-magenta" />
                  </div>
                  <div>
                    <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
                      Round Loop Feed
                    </h2>
                    <p className="font-mono text-[10px] text-zinc-400">
                      Tap any walk/run to inspect its loop or remove it
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsMobileFeedOpen(false)}
                  aria-label="Close Activity Feed"
                  className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/80 text-zinc-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="touch-scroll flex-1 overflow-y-auto p-3.5 pb-6">
                <ActivityFeed
                  activities={activities}
                  selectedActivityId={selectedActivity?.id ?? null}
                  onSelectActivity={(act) => {
                    setSelectedActivity(act);
                    if (act) {
                      setIsMobileFeedOpen(false);
                    }
                  }}
                  currentUserId={currentUserId}
                  isRoundAdmin={isRoundAdmin}
                  onActivityDeleted={() => fetchArenaTelemetry(selectedRoundId)}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================
          3B. DESKTOP & TABLET COMMAND HUD (hidden md:block)
      ================================================================ */}
      <section className="pointer-events-none fixed inset-x-0 bottom-0 z-30 hidden p-4 md:block lg:p-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          {/* Left Panel: Active Athlete Quick Stats + 30-Day Loop Sync Action */}
          <div className="pointer-events-auto w-full rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass backdrop-blur-2xl lg:max-w-md">
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle/70 pb-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    borderColor: `${activeColor}66`,
                    backgroundColor: `${activeColor}18`,
                    boxShadow: `0 0 18px ${activeColor}33`,
                  }}
                >
                  <Shield
                    className="h-4 w-4"
                    style={{ color: activeColor }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      {isAuthenticated ? 'ATHLETE COMMAND' : 'AUCKLAND ARENA'}
                    </span>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: activeColor }}
                    />
                  </div>
                  <p className="text-sm font-bold text-white">
                    {isLoadingInitial
                      ? 'Loading...'
                      : isAuthenticated && currentAthlete
                        ? currentAthlete.displayName
                        : 'Not Signed In'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {isAuthenticated && currentAthlete && (
                  <Link
                    href={`/profile/${currentAthlete.userId}`}
                    className="flex min-h-[48px] items-center gap-1 rounded-xl border border-border-subtle bg-carbon-950/80 px-3 py-1.5 font-mono text-[11px] font-medium text-neon-cyan transition hover:border-neon-cyan/50"
                  >
                    <User className="h-3.5 w-3.5" />
                    <span>Profile</span>
                  </Link>
                )}

                <button
                  onClick={() => setIsConnectModalOpen(true)}
                  className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950/80 px-3 py-1.5 font-mono text-[11px] font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                  <span>{isAuthenticated ? 'Settings' : 'Account'}</span>
                </button>
              </div>
            </div>

            {/* 3 Quick Stats Cards: Total Hexes Held, Area in km², Active Dominance Rank */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border-subtle bg-carbon-950/75 p-2.5">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    HEXES HELD
                  </span>
                  <Hexagon
                    className="h-3.5 w-3.5"
                    style={{ color: activeColor }}
                  />
                </div>
                <p
                  className="mt-1 font-mono text-lg font-bold sm:text-xl"
                  style={{ color: activeColor }}
                >
                  {isLoadingInitial ? '—' : currentAthlete?.activeCells ?? 0}
                </p>
                <p className="font-mono text-[10px] text-zinc-500">
                  RES-9 CELLS
                </p>
              </div>

              <div className="rounded-xl border border-border-subtle bg-carbon-950/75 p-2.5">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    AREA HELD
                  </span>
                  <Maximize2 className="h-3.5 w-3.5 text-neon-cyan" />
                </div>
                <p className="mt-1 font-mono text-lg font-bold text-white sm:text-xl">
                  {isLoadingInitial
                    ? '—'
                    : formatAreaKm2(currentAthlete?.activeAreaKm2 ?? 0)}
                </p>
                <p className="font-mono text-[10px] text-zinc-500">
                  SQUARE KM²
                </p>
              </div>

              <div className="rounded-xl border border-border-subtle bg-carbon-950/75 p-2.5">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    DOMINANCE
                  </span>
                  <Crown className="h-3.5 w-3.5 text-neon-amber" />
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <p className="font-mono text-lg font-bold text-neon-amber sm:text-xl">
                    {currentAthlete ? `#${currentAthlete.rank}` : '—'}
                  </p>
                  <span className="font-mono text-[11px] text-zinc-400">
                    ({currentAthlete?.dominancePercent ?? 0}%)
                  </span>
                </div>
                <p className="font-mono text-[10px] text-zinc-500">
                  ROUND RANK
                </p>
              </div>
            </div>

            {/* 30-Day Closed-Loop Strava Review & Sync Trigger */}
            <div className="mt-3">
              <SyncButton
                isAuthenticated={isAuthenticated}
                stravaConnected={Boolean(currentAthlete?.stravaConnected)}
                playerColor={activeColor}
                isRoundArchived={isRoundConcluded}
                onOpenSyncReviewModal={() => setIsSyncReviewModalOpen(true)}
                lastSyncResult={lastSyncResult}
              />
            </div>
          </div>

          {/* Right Panel: Live Activity Conquest Feed */}
          <div className="pointer-events-auto w-full rounded-2xl border border-border-subtle bg-carbon-900/90 shadow-glass backdrop-blur-2xl lg:max-w-lg">
            <div
              onClick={() => setIsDrawerExpanded((prev) => !prev)}
              className="flex cursor-pointer items-center justify-between px-4 py-3 sm:px-5"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-neon-magenta/40 bg-neon-magenta/10">
                  <Activity className="h-4 w-4 text-neon-magenta" />
                </div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xs font-bold uppercase tracking-wider text-white sm:text-sm">
                    Round Loop Feed
                  </h2>
                  <span className="flex items-center gap-1 rounded-full border border-neon-magenta/30 bg-neon-magenta/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-neon-magenta">
                    <Flame className="h-2.5 w-2.5" />
                    LIVE STEALS
                  </span>
                </div>
              </div>

              <button
                type="button"
                aria-label="Toggle Conquest Feed Drawer"
                className="flex min-h-[48px] items-center gap-1 rounded-xl border border-border-subtle bg-carbon-950/70 px-3 py-1.5 font-mono text-[11px] text-zinc-300 transition hover:border-zinc-700 hover:text-white"
              >
                <span>{isDrawerExpanded ? 'Minimize' : 'Expand'}</span>
                {isDrawerExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <AnimatePresence initial={false}>
              {isDrawerExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden border-t border-border-subtle/70"
                >
                  <div className="touch-scroll max-h-64 overflow-y-auto p-4">
                    <ActivityFeed
                      activities={activities}
                      selectedActivityId={selectedActivity?.id ?? null}
                      onSelectActivity={(act) => setSelectedActivity(act)}
                      currentUserId={currentUserId}
                      isRoundAdmin={isRoundAdmin}
                      onActivityDeleted={() =>
                        fetchArenaTelemetry(selectedRoundId)
                      }
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* 4. Interactive 30-Day Strava Closed-Loop Review & Selection Modal */}
      <SyncReviewModal
        isOpen={isSyncReviewModalOpen}
        onClose={() => setIsSyncReviewModalOpen(false)}
        roundId={currentRound?.id ?? selectedRoundId}
        roundName={currentRound?.name ?? 'Round 1'}
        playerColor={activeColor}
        onSyncComplete={handleSyncComplete}
      />

      {/* 5. Multi-Round / Season Management & Admin Governance Modal */}
      <RoundsModal
        isOpen={isRoundsModalOpen}
        onClose={() => setIsRoundsModalOpen(false)}
        rounds={rounds}
        currentRound={currentRound}
        currentUserId={currentUserId}
        roundActivities={activities}
        isAuthenticated={isAuthenticated}
        onSelectRound={handleSelectRound}
        onRoundsUpdated={(newId) => {
          fetchArenaTelemetry(newId ?? selectedRoundId);
        }}
        onActivityDeleted={() => fetchArenaTelemetry(selectedRoundId)}
      />

      {/* 6. Account Customization (Display Name, Bio, Color, PWA Install) & Strava Slot Modal */}
      <ConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        currentAthlete={currentAthlete}
        isAuthenticated={isAuthenticated}
        stravaConfigured={stravaConfigured}
        onProfileUpdated={() => fetchArenaTelemetry(selectedRoundId)}
        homeArea={homeArea}
        getMapView={() => mapViewRef.current}
        onLogout={handleLogout}
      />
    </main>
  );
}
