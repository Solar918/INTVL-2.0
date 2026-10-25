'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { LeaderboardEntry, RoundSummary } from '@/lib/d1';
import { formatAreaKm2, formatRoundCountdownStatus } from '@/lib/utils';
import {
  Calendar,
  ChevronDown,
  Clock,
  Crown,
  ExternalLink,
  Flame,
  Lock,
  LogIn,
  LogOut,
  Palette,
  Radio,
  Shield,
  Trophy,
  User,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';

export interface LeaderboardProps {
  round: RoundSummary | null;
  roundsCount: number;
  leaderboard: LeaderboardEntry[];
  totalGridCells: number;
  totalGridAreaKm2: number;
  currentAthlete: LeaderboardEntry | null;
  isAuthenticated: boolean;
  focusedOwnerId: string | null;
  onSelectOwner: (userId: string | null) => void;
  onOpenConnectModal: () => void;
  onOpenRoundsModal: () => void;
  onLogout: () => void;
}

export default function Leaderboard({
  round,
  roundsCount,
  leaderboard,
  totalGridCells,
  totalGridAreaKm2,
  currentAthlete,
  isAuthenticated,
  focusedOwnerId,
  onSelectOwner,
  onOpenConnectModal,
  onOpenRoundsModal,
  onLogout,
}: LeaderboardProps) {
  const [expanded, setExpanded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const roundStatus = formatRoundCountdownStatus(round, nowMs);

  const primaryDominancePercent =
    currentAthlete?.dominancePercent ??
    leaderboard[0]?.dominancePercent ??
    0;
  const primaryDominanceColor =
    currentAthlete?.color ?? leaderboard[0]?.color ?? '#00f0ff';

  const renderStandingsRows = (isMobileSheet = false) => {
    if (leaderboard.length === 0) {
      return (
        <div className="p-6 text-center">
          <p className="text-sm font-medium text-zinc-300">
            No players participating in this round yet.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Add participants in Rounds Management or sync your closed-loop walks/runs to claim the first hexes!
          </p>
        </div>
      );
    }

    return (
      <div className="divide-y divide-border-subtle/60">
        {leaderboard.map((entry) => {
          const isFocused = focusedOwnerId === entry.userId;
          const isCurrent = currentAthlete?.userId === entry.userId;

          return (
            <div
              key={entry.userId}
              onClick={() => {
                onSelectOwner(isFocused ? null : entry.userId);
                if (isMobileSheet) {
                  setExpanded(false);
                }
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3.5 transition sm:px-5 ${
                isFocused ? 'bg-zinc-800/75' : 'hover:bg-zinc-800/40'
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-mono text-xs font-bold"
                  style={{
                    borderColor: `${entry.color}66`,
                    backgroundColor: `${entry.color}15`,
                    color: entry.color,
                  }}
                >
                  #{entry.rank}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="break-words text-sm font-bold text-white">
                      {entry.displayName}
                    </p>
                    <span className="font-mono text-[11px] text-zinc-500">
                      @{entry.username}
                    </span>
                    {isCurrent && (
                      <span className="rounded border border-neon-cyan/40 bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neon-cyan">
                        YOU
                      </span>
                    )}
                    {isFocused && (
                      <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        FOCUSED
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
                    <span>{entry.activitiesCount} loops</span>
                    <span>•</span>
                    <span>{entry.totalDistanceKm} km</span>
                    {entry.totalCellsStolen > 0 && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-0.5 text-neon-magenta">
                          <Flame className="h-3 w-3" />
                          {entry.totalCellsStolen} stolen
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2.5 text-right sm:gap-3">
                <Link
                  href={`/profile/${entry.userId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-xl border border-border-subtle bg-carbon-950 px-3 py-2 font-mono text-[11px] text-zinc-300 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
                >
                  <span>Profile</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>

                <div className="hidden sm:block">
                  <p className="font-mono text-xs font-semibold text-zinc-200">
                    {formatAreaKm2(entry.activeAreaKm2)} km²
                  </p>
                  <p className="font-mono text-[10px] text-zinc-500">
                    SURFACE AREA
                  </p>
                </div>

                <div className="min-w-[64px]">
                  <div className="flex items-center justify-end gap-1">
                    <Shield
                      className="h-3.5 w-3.5"
                      style={{ color: entry.color }}
                    />
                    <span
                      className="font-mono text-sm font-bold"
                      style={{ color: entry.color }}
                    >
                      {entry.activeCells}
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-400">
                    {entry.dominancePercent}% GRID
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 px-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2 sm:p-4">
        <div className="mx-auto max-w-7xl">
          {/* ================================================================
              MOBILE COMPACT FLOATING PILL BAR (< 768px / md:hidden)
              All interactive buttons >= 48x48px touch targets
          ================================================================ */}
          <div className="pointer-events-auto flex items-center justify-between gap-1.5 rounded-2xl border border-border-subtle bg-carbon-900/92 px-2 py-1.5 shadow-glass backdrop-blur-2xl md:hidden">
            {/* Left: Logo + Round Bottom Sheet Trigger */}
            <button
              type="button"
              onClick={onOpenRoundsModal}
              aria-label="Switch Round or Season"
              className="flex min-h-[48px] min-w-[48px] items-center gap-2 rounded-xl border border-border-subtle/80 bg-carbon-950/80 px-2.5 py-1.5 text-left transition active:scale-95"
            >
              <img
                src="/logo.png"
                alt="INTVL 2.0"
                className="h-6 w-6 shrink-0 rounded-lg border border-neon-cyan/40 object-cover"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-display text-[11px] font-bold text-white">
                    {round ? round.name.split('—')[0].trim() : 'Round 1'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neon-cyan" />
                </div>
                <p
                  className={`font-mono text-[9px] font-semibold ${
                    roundStatus.isConcluded
                      ? 'text-amber-300'
                      : 'text-neon-lime'
                  }`}
                >
                  {roundStatus.shortLabel} • {totalGridCells} hex
                </p>
              </div>
            </button>

            {/* Center: Sleek Dominance & Leaderboard Pill Toggle */}
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-label="Toggle Leaderboard Drawer"
              className="relative flex min-h-[48px] flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-border-subtle bg-carbon-950/90 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-zinc-100 transition active:scale-95"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0 text-neon-amber" />
              <span>
                Dominance:{' '}
                <strong style={{ color: primaryDominanceColor }}>
                  {primaryDominancePercent}%
                </strong>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${
                  expanded ? 'rotate-180' : ''
                }`}
              />
              {/* Bottom mini dominance indicator bar */}
              {totalGridCells > 0 && (
                <span className="absolute inset-x-0 bottom-0 flex h-0.5 w-full overflow-hidden bg-carbon-900">
                  {leaderboard
                    .filter((e) => e.activeCells > 0)
                    .map((entry) => (
                      <span
                        key={entry.userId}
                        style={{
                          width: `${Math.max(entry.dominancePercent, 3)}%`,
                          backgroundColor: entry.color,
                        }}
                        className="h-full"
                      />
                    ))}
                </span>
              )}
            </button>

            {/* Right: 48x48px Profile & Settings / Auth Touch Targets */}
            <div className="flex items-center gap-1">
              {isAuthenticated && currentAthlete ? (
                <>
                  <Link
                    href={`/profile/${currentAthlete.userId}`}
                    aria-label="My Athlete Profile"
                    className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/90 text-neon-cyan transition active:scale-95"
                  >
                    <User className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={onOpenConnectModal}
                    aria-label="Account & Strava Settings"
                    className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/90 text-white transition active:scale-95"
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-white/40"
                      style={{
                        backgroundColor: currentAthlete.color,
                        boxShadow: `0 0 8px ${currentAthlete.color}`,
                      }}
                    />
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="flex min-h-[48px] min-w-[48px] items-center justify-center gap-1 rounded-xl border border-neon-cyan/50 bg-neon-cyan/15 px-3 py-2 font-mono text-xs font-bold text-neon-cyan"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Login</span>
                </Link>
              )}
            </div>
          </div>

          {/* ================================================================
              DESKTOP & TABLET COMMAND BAR (hidden md:block)
          ================================================================ */}
          <div className="pointer-events-auto hidden rounded-2xl border border-border-subtle bg-carbon-900/90 px-4 py-2.5 shadow-glass backdrop-blur-2xl md:block lg:px-5 lg:py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Left: INTVL 2.0 Logo + Active Round Switcher + Live Countdown Badge */}
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-neon-cyan/40 bg-carbon-950 shadow-neon-cyan">
                  <img
                    src="/logo.png"
                    alt="INTVL 2.0 Logo"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute right-0.5 top-0.5 flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-cyan opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-cyan" />
                  </span>
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-display text-sm font-bold tracking-wider text-white sm:text-base">
                      INTVL 2.0
                    </h1>

                    <button
                      type="button"
                      onClick={onOpenRoundsModal}
                      className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-xs font-semibold transition ${
                        roundStatus.isConcluded
                          ? 'border-amber-400/50 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25'
                          : 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20'
                      }`}
                    >
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>{round ? round.name : 'Round 1'}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          roundStatus.isConcluded
                            ? 'bg-amber-400/20 text-amber-200'
                            : 'bg-neon-lime/20 text-neon-lime'
                        }`}
                      >
                        {roundStatus.isConcluded ? (
                          <Lock className="h-2.5 w-2.5" />
                        ) : (
                          <Clock className="h-2.5 w-2.5" />
                        )}
                        <span>{roundStatus.label}</span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                    </button>
                  </div>

                  <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-zinc-400">
                    <Radio className="h-3 w-3 text-neon-lime" />
                    <span>{totalGridCells} HEXES CLAIMED</span>
                    <span className="text-zinc-600">•</span>
                    <span>{formatAreaKm2(totalGridAreaKm2)} KM²</span>
                    {round?.adminDisplayName && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span>ADMIN: {round.adminDisplayName.toUpperCase()}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Center: Live Top 4 Athlete Pills (XL Desktop) */}
              {leaderboard.length > 0 && (
                <div className="hidden items-center gap-2 xl:flex">
                  {leaderboard.slice(0, 4).map((entry) => {
                    const isFocused = focusedOwnerId === entry.userId;
                    return (
                      <button
                        key={entry.userId}
                        onClick={() =>
                          onSelectOwner(isFocused ? null : entry.userId)
                        }
                        className={`group flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left transition ${
                          isFocused
                            ? 'border-white/50 bg-zinc-800/90'
                            : 'border-border-subtle bg-carbon-950/70 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-mono text-xs font-bold"
                            style={{ color: entry.color }}
                          >
                            #{entry.rank}
                          </span>
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor: entry.color,
                              boxShadow: `0 0 10px ${entry.color}`,
                            }}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-zinc-100">
                            {entry.displayName}
                          </p>
                          <p className="font-mono text-[10px] text-zinc-400">
                            {entry.activeCells} hex • {entry.dominancePercent}%
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Right: Rounds + Standings Toggle + Profile + Auth Controls (All >= 48px) */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenRoundsModal}
                  className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950/80 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                >
                  <Calendar className="h-4 w-4 text-neon-cyan" />
                  <span>Rounds</span>
                  <span className="font-mono text-[11px] text-zinc-400">
                    ({roundsCount})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950/80 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                >
                  <Trophy className="h-4 w-4 text-neon-amber" />
                  <span>
                    Dominance: {primaryDominancePercent}% | Leaderboard
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${
                      expanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isAuthenticated && currentAthlete ? (
                  <>
                    <Link
                      href={`/profile/${currentAthlete.userId}`}
                      title="My Athlete Profile & Activity Feed"
                      className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950/90 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-neon-cyan/50 hover:text-white"
                    >
                      <User className="h-4 w-4 text-neon-cyan" />
                      <span>Profile</span>
                    </Link>

                    <button
                      onClick={onOpenConnectModal}
                      className="flex min-h-[48px] items-center gap-2 rounded-xl border border-border-subtle bg-carbon-950/90 px-3.5 py-2 text-xs font-semibold text-white transition hover:border-zinc-600 active:scale-95"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: currentAthlete.color,
                          boxShadow: `0 0 10px ${currentAthlete.color}`,
                        }}
                      />
                      <span>{currentAthlete.displayName}</span>
                      <Palette className="h-4 w-4 text-zinc-400" />
                    </button>

                    <button
                      onClick={onLogout}
                      title="Log Out"
                      aria-label="Log Out"
                      className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/80 p-2 text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950/85 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                    >
                      <LogIn className="h-4 w-4 text-neon-cyan" />
                      <span>Log In</span>
                    </Link>

                    <Link
                      href="/register"
                      className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-neon-cyan/50 bg-neon-cyan/15 px-3.5 py-2 text-xs font-bold text-neon-cyan shadow-sm transition hover:bg-neon-cyan/25"
                    >
                      <UserPlus className="h-4 w-4" />
                      <span>Join Squad</span>
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Multi-Athlete Neon Territory Dominance Proportional Bar */}
            {totalGridCells > 0 && (
              <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-carbon-950">
                {leaderboard
                  .filter((e) => e.activeCells > 0)
                  .map((entry) => (
                    <div
                      key={entry.userId}
                      style={{
                        width: `${Math.max(entry.dominancePercent, 2)}%`,
                        backgroundColor: entry.color,
                        boxShadow: `0 0 8px ${entry.color}`,
                      }}
                      title={`${entry.displayName}: ${entry.activeCells} hexes (${entry.dominancePercent}%)`}
                      className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                    />
                  ))}
              </div>
            )}

            {/* Prominent Strava Connection Onboarding Banner for Logged-in Users without Strava Linked */}
            {isAuthenticated &&
              currentAthlete &&
              !currentAthlete.stravaConnected && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-strava-orange/50 bg-gradient-to-r from-strava-orange/20 via-strava-orange/10 to-transparent px-3.5 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-zinc-100">
                    <Zap className="h-4 w-4 shrink-0 text-strava-orange" />
                    <span>Connect Strava to start claiming territory.</span>
                  </div>
                  <a
                    href="/api/auth/strava"
                    className="inline-flex min-h-[48px] items-center gap-1.5 rounded-lg bg-strava-orange px-3.5 py-2 text-xs font-bold text-white shadow transition hover:bg-strava-hover"
                  >
                    <Zap className="h-3.5 w-3.5 fill-current" />
                    <span>Connect Strava</span>
                  </a>
                </div>
              )}
          </div>

          {/* Desktop Expandable Standings Dropdown (hidden md:block) */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.99 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto mt-2 hidden overflow-hidden rounded-2xl border border-border-subtle bg-carbon-900/95 shadow-glass backdrop-blur-2xl md:block"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-neon-amber" />
                    <h2 className="font-display text-sm font-bold uppercase tracking-wider text-zinc-200">
                      {round
                        ? `${round.name} — Standings`
                        : 'Turf Dominance Standings'}
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-400">
                    Click row to isolate hexes • Click Profile for career history
                  </span>
                </div>

                <div className="touch-scroll max-h-[65dvh] overflow-y-auto">
                  {renderStandingsRows(false)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* ================================================================
          MOBILE DRAGGABLE BOTTOM SHEET FOR LEADERBOARD STANDINGS (md:hidden)
      ================================================================ */}
      <AnimatePresence>
        {expanded && (
          <div className="fixed inset-0 z-50 flex items-end md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setExpanded(false)}
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
                  setExpanded(false);
                }
              }}
              className="safe-bottom relative z-10 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border-subtle bg-carbon-900 shadow-glass"
            >
              {/* Drag Handle */}
              <div className="flex shrink-0 flex-col items-center pt-2.5 pb-1">
                <div className="h-1.5 w-12 rounded-full bg-zinc-700" />
              </div>

              <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Crown className="h-4 w-4 shrink-0 text-neon-amber" />
                  <div className="min-w-0">
                    <h2 className="break-words font-display text-sm font-bold uppercase tracking-wider text-white">
                      {round ? round.name : 'Turf Standings'}
                    </h2>
                    <p className="font-mono text-[10px] text-zinc-400">
                      {roundStatus.label} • {totalGridCells} hexes •{' '}
                      {formatAreaKm2(totalGridAreaKm2)} km²
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close Leaderboard"
                  className="flex h-12 w-12 min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/80 text-zinc-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="touch-scroll flex-1 overflow-y-auto pb-6">
                {renderStandingsRows(true)}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
