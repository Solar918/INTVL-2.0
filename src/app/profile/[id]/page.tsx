'use client';

export const runtime = 'edge';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import RoutePreviewSvg from '@/components/RoutePreviewSvg';
import PwaInstallBanner from '@/components/PwaInstallBanner';
import {
  formatAreaKm2,
  formatDistanceKm,
  formatDuration,
  formatPaceMinPerKm,
  formatRelativeTime,
  formatSpeedKmh,
  isValidTacticalColor,
  TACTICAL_PALETTE,
} from '@/lib/utils';
import type { ActivityFeedItem, UserProfileData } from '@/lib/d1';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Flame,
  Gauge,
  Hexagon,
  Layers,
  Loader2,
  Navigation,
  Palette,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  Unplug,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';

type ProfileApiPayload = UserProfileData & {
  isOwnProfile?: boolean;
  error?: string;
};

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [profile, setProfile] = useState<ProfileApiPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(
    null
  );

  // Inline Edit Modal State (when viewing own profile)
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editColor, setEditColor] = useState('#00f0ff');
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnectingStrava, setIsDisconnectingStrava] = useState(false);

  // Activity deletion & rollback state
  const [confirmingActivityId, setConfirmingActivityId] = useState<
    string | null
  >(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(
    null
  );
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as ProfileApiPayload;
      if (!res.ok) {
        throw new Error(data.error || 'Could not load athlete profile.');
      }
      setProfile(data);
      setEditDisplayName(data.user.displayName);
      setEditBio(data.user.bio || '');
      setEditColor(data.user.colorHex);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load athlete profile.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleDisconnectStrava = async () => {
    if (isDisconnectingStrava) return;
    setIsDisconnectingStrava(true);
    try {
      const res = await fetch('/api/auth/strava/disconnect', {
        method: 'POST',
      });
      if (res.ok) {
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                user: {
                  ...prev.user,
                  stravaConnected: false,
                  stravaAthleteId: null,
                },
              }
            : prev
        );
        await fetchProfile();
      }
    } finally {
      setIsDisconnectingStrava(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDisplayName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: editDisplayName.trim(),
          bio: editBio.trim(),
          colorHex: editColor,
        }),
      });
      if (res.ok) {
        setIsEditing(false);
        await fetchProfile();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteActivity = async (act: ActivityFeedItem) => {
    setDeletingActivityId(act.id);
    setRollbackNotice(null);
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(act.id)}`,
        {
          method: 'DELETE',
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rollback?: {
          cellsReverted: number;
          cellsCleared: number;
          cellsAffected: number;
        };
      };
      if (!res.ok || !data.ok || !data.rollback) {
        throw new Error(data.error || 'Failed to remove activity.');
      }
      setConfirmingActivityId(null);
      setRollbackNotice(
        `Removed "${act.name}" — ${data.rollback.cellsReverted} hexes reverted to previous owners, ${data.rollback.cellsCleared} cleared.`
      );
      await fetchProfile();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to remove activity.'
      );
    } finally {
      setDeletingActivityId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-carbon-950 p-6 text-center">
        <Loader2 className="h-9 w-9 animate-spin text-neon-cyan" />
        <p className="mt-3 font-display text-sm font-bold text-white">
          Loading Athlete Dossier &amp; Activity Telemetry...
        </p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-carbon-950 p-6 text-center">
        <Hexagon className="h-12 w-12 text-zinc-600" />
        <h1 className="mt-4 font-display text-xl font-bold text-white">
          Athlete Profile Not Found
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          {error || 'The requested player profile does not exist.'}
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-neon-cyan px-4 py-2.5 font-mono text-xs font-bold text-carbon-950"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Return to Live Map</span>
        </Link>
      </div>
    );
  }

  const { user, stats, activities, isOwnProfile } = profile;
  const accentColor = user.colorHex || '#00f0ff';
  const totalDistanceKm = stats.totalDistanceMeters / 1000;
  const avgPace = formatPaceMinPerKm(
    stats.totalDistanceMeters,
    stats.totalMovingTimeSeconds
  );
  const avgSpeed = formatSpeedKmh(
    stats.totalDistanceMeters,
    stats.totalMovingTimeSeconds
  );
  const activeAreaKm2 = Number(
    (stats.currentActiveCells * 0.1053325).toFixed(4)
  );

  return (
    <div className="safe-bottom min-h-dvh bg-carbon-950 text-zinc-100">
      {/* Subtle Top Radial Glow */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-96 opacity-20"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${accentColor}55 0%, transparent 70%)`,
        }}
      />

      {/* Top Navigation Bar */}
      <header className="safe-top sticky top-0 z-30 border-b border-border-subtle bg-carbon-900/90 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-border-subtle bg-carbon-950 px-3.5 py-2 font-mono text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 text-neon-cyan" />
              <span>Live Territory Map</span>
            </Link>

            <div className="hidden items-center gap-2 sm:flex">
              <img
                src="/logo.png"
                alt="INTVL 2.0"
                className="h-7 w-7 rounded-lg border border-border-subtle object-cover"
              />
              <span className="font-display text-xs font-bold tracking-wider text-zinc-300">
                INTVL 2.0 // ATHLETE PROFILE
              </span>
            </div>
          </div>

          {isOwnProfile && (
            <div className="flex flex-wrap items-center gap-2">
              {user.stravaConnected ? (
                <button
                  type="button"
                  disabled={isDisconnectingStrava}
                  onClick={handleDisconnectStrava}
                  className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-2 font-mono text-xs font-semibold text-red-200 transition hover:bg-red-500/25 disabled:opacity-50"
                >
                  {isDisconnectingStrava ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unplug className="h-3.5 w-3.5" />
                  )}
                  <span>Disconnect Strava</span>
                </button>
              ) : (
                <a
                  href="/api/auth/strava"
                  className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl bg-strava-orange px-3.5 py-2 font-mono text-xs font-bold text-white shadow transition hover:bg-strava-hover"
                >
                  <Zap className="h-3.5 w-3.5 fill-current" />
                  <span>Connect with Strava</span>
                </a>
              )}

              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-950 px-3.5 py-2 font-mono text-xs font-semibold text-white transition hover:border-neon-cyan/50"
              >
                <Edit3 className="h-3.5 w-3.5 text-neon-cyan" />
                <span>{isEditing ? 'Close Editor' : 'Customize Profile'}</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* 1. Athlete Hero Banner */}
        <section className="overflow-hidden rounded-3xl border border-border-subtle bg-carbon-900/90 shadow-glass backdrop-blur-xl">
          <div
            className="h-2 w-full"
            style={{
              backgroundColor: accentColor,
              boxShadow: `0 0 24px ${accentColor}`,
            }}
          />

          <div className="p-5 sm:p-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
              <div className="flex items-start gap-4 sm:items-center sm:gap-5">
                <div
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border font-display text-2xl font-bold sm:h-20 sm:w-20 sm:text-3xl"
                  style={{
                    borderColor: `${accentColor}88`,
                    backgroundColor: `${accentColor}1a`,
                    color: accentColor,
                    boxShadow: `0 0 28px ${accentColor}33`,
                  }}
                >
                  {user.displayName.slice(0, 2).toUpperCase()}
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="break-words font-display text-2xl font-bold text-white sm:text-3xl">
                      {user.displayName}
                    </h1>
                    <span
                      className="rounded-lg border px-2 py-0.5 font-mono text-xs font-bold uppercase"
                      style={{
                        borderColor: `${accentColor}66`,
                        backgroundColor: `${accentColor}18`,
                        color: accentColor,
                      }}
                    >
                      {accentColor}
                    </span>
                    {user.stravaConnected ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-neon-lime/40 bg-neon-lime/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-neon-lime">
                        <CheckCircle2 className="h-3 w-3" />
                        STRAVA VERIFIED (#{user.stravaAthleteId})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-400">
                        STRAVA DISCONNECTED
                      </span>
                    )}
                  </div>

                  <p className="mt-1 font-mono text-xs text-zinc-400">
                    Account Handle: @{user.username} • Joined{' '}
                    {formatRelativeTime(user.createdAt)}
                  </p>

                  {user.bio ? (
                    <p className="mt-2 max-w-2xl text-sm text-zinc-200">
                      {user.bio}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs italic text-zinc-500">
                      Auckland H3 Resolution 9 Territory Competitor
                    </p>
                  )}
                </div>
              </div>

              {/* Active Round Live Standing Highlight */}
              <div className="flex shrink-0 items-center gap-4 rounded-2xl border border-border-subtle bg-carbon-950/80 p-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                    LIVE ROUND HEXES HELD
                  </p>
                  <p
                    className="mt-1 font-mono text-2xl font-bold"
                    style={{ color: accentColor }}
                  >
                    {stats.currentActiveCells} HEX
                  </p>
                  <p className="font-mono text-[11px] text-zinc-400">
                    {formatAreaKm2(activeAreaKm2)} km² active turf
                  </p>
                </div>
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl border"
                  style={{
                    borderColor: `${accentColor}55`,
                    backgroundColor: `${accentColor}15`,
                  }}
                >
                  <Shield className="h-6 w-6" style={{ color: accentColor }} />
                </div>
              </div>
            </div>

            {isOwnProfile && (
              <div className="mt-5">
                <PwaInstallBanner variant="card" />
              </div>
            )}

            {/* Inline Profile Editor Drawer (if own profile & editing) */}
            {isOwnProfile && isEditing && (
              <form
                onSubmit={handleSaveProfile}
                className="mt-6 space-y-4 rounded-2xl border border-neon-cyan/40 bg-carbon-950/90 p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-neon-cyan">
                    <UserCheck className="h-4 w-4" />
                    <span>Edit Public Identity &amp; Territory Color</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center text-zinc-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                      Public Display Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={32}
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-neon-cyan"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                      Athlete Bio / Tagline
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      placeholder="e.g. Morning loop runner around Waitematā Harbour"
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-neon-cyan"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                    <Palette className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Custom Territory Hex Color</span>
                  </label>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {TACTICAL_PALETTE.map((option) => {
                      const selected =
                        option.hex.toLowerCase() === editColor.toLowerCase();
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setEditColor(option.hex)}
                          className={`flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border transition ${
                            selected
                              ? 'border-white bg-zinc-800'
                              : 'border-border-subtle bg-carbon-900'
                          }`}
                        >
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded-full"
                            style={{ backgroundColor: option.hex }}
                          >
                            {selected && (
                              <Check className="h-3 w-3 stroke-[3] text-carbon-950" />
                            )}
                          </span>
                        </button>
                      );
                    })}

                    <div className="flex min-h-[48px] items-center gap-2 rounded-xl border border-border-subtle bg-carbon-900 px-3 py-1">
                      <input
                        type="color"
                        value={
                          isValidTacticalColor(editColor)
                            ? editColor
                            : '#00f0ff'
                        }
                        onChange={(e) => setEditColor(e.target.value)}
                        className="h-7 w-8 cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="text"
                        maxLength={7}
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="w-20 bg-transparent font-mono text-xs uppercase text-white outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  {user.stravaConnected ? (
                    <button
                      type="button"
                      disabled={isDisconnectingStrava}
                      onClick={handleDisconnectStrava}
                      className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/15 px-4 py-2.5 font-mono text-xs font-bold text-red-200 transition hover:bg-red-500/25 disabled:opacity-50"
                    >
                      <Unplug className="h-4 w-4" />
                      <span>
                        {isDisconnectingStrava
                          ? 'Disconnecting...'
                          : 'Disconnect Strava Account'}
                      </span>
                    </button>
                  ) : (
                    <a
                      href="/api/auth/strava"
                      className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-strava-orange px-4 py-2.5 font-mono text-xs font-bold text-white shadow transition hover:bg-strava-hover"
                    >
                      <Zap className="h-4 w-4 fill-current" />
                      <span>Connect with Strava</span>
                    </a>
                  )}

                  <button
                    type="submit"
                    disabled={isSaving}
                    style={{ backgroundColor: editColor }}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-xl px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-carbon-950 shadow transition hover:brightness-110 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* 2. Aggregate Career Performance Stats Grid */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                TOTAL DISTANCE
              </span>
              <Navigation className="h-4 w-4 text-neon-cyan" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-white">
              {totalDistanceKm.toFixed(2)}
            </p>
            <p className="font-mono text-[10px] text-zinc-500">
              KILOMETERS COVERED
            </p>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                ACTIVE TIME
              </span>
              <Clock className="h-4 w-4 text-neon-lime" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-white">
              {formatDuration(stats.totalMovingTimeSeconds)}
            </p>
            <p className="font-mono text-[10px] text-zinc-500">
              MOVING DURATION
            </p>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                AVG PACE
              </span>
              <Gauge className="h-4 w-4 text-neon-amber" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-white">
              {avgPace}
              <span className="text-xs font-normal text-zinc-400"> /km</span>
            </p>
            <p className="font-mono text-[10px] text-zinc-500">
              {avgSpeed} KM/H AVG SPEED
            </p>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                LOOPS COMPLETED
              </span>
              <Layers className="h-4 w-4" style={{ color: accentColor }} />
            </div>
            <p
              className="mt-2 font-mono text-2xl font-bold"
              style={{ color: accentColor }}
            >
              {stats.totalLoopsCompleted}
            </p>
            <p className="font-mono text-[10px] text-zinc-500">
              CLOSED-LOOP RUNS
            </p>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                CAREER HEXES
              </span>
              <Hexagon className="h-4 w-4 text-neon-cyan" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-white">
              {stats.totalCellsCapturedEver}
            </p>
            <p className="font-mono text-[10px] text-zinc-500">
              TOTAL CELLS CLAIMED
            </p>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-carbon-900/90 p-4 shadow-glass">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                HEXES STOLEN
              </span>
              <Flame className="h-4 w-4 text-neon-magenta" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-neon-magenta">
              {stats.totalCellsStolenEver}
            </p>
            <p className="font-mono text-[10px] text-zinc-500">
              HOSTILE TAKEOVERS
            </p>
          </div>
        </section>

        {/* 3. Permanent Strava-Style Personal Activities Feed */}
        <section className="rounded-3xl border border-border-subtle bg-carbon-900/90 p-5 shadow-glass sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border"
                style={{
                  borderColor: `${accentColor}55`,
                  backgroundColor: `${accentColor}15`,
                }}
              >
                <Activity className="h-4 w-4" style={{ color: accentColor }} />
              </div>
              <div>
                <h2 className="font-display text-base font-bold uppercase tracking-wider text-white sm:text-lg">
                  Personal Activity Log &amp; Route Archive
                </h2>
                <p className="text-xs text-zinc-400">
                  All imported Strava loops and GPS route paths are preserved here. Removing an activity reverts its H3 hexes on the round map.
                </p>
              </div>
            </div>

            <span className="rounded-xl border border-border-subtle bg-carbon-950 px-3 py-1.5 font-mono text-xs text-zinc-300">
              {activities.length}{' '}
              {activities.length === 1 ? 'Activity' : 'Activities'} Archived
            </span>
          </div>

          {rollbackNotice && (
            <div className="mt-4 rounded-xl border border-neon-lime/40 bg-neon-lime/10 p-3 text-xs text-neon-lime">
              {rollbackNotice}
            </div>
          )}

          {activities.length === 0 ? (
            <div className="my-8 flex flex-col items-center justify-center rounded-2xl border border-border-subtle bg-carbon-950/60 p-10 text-center">
              <Award className="h-10 w-10 text-zinc-600" />
              <p className="mt-3 text-sm font-semibold text-zinc-200">
                No Imported Activities Yet
              </p>
              <p className="mt-1 max-w-md text-xs text-zinc-400">
                When {user.displayName} imports closed-loop walks, runs, or hikes from Strava, their full telemetry and GPS trajectories will appear here permanently.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {activities.map((act) => {
                const isExpanded = expandedActivityId === act.id;
                const isLoop = act.captureMode === 'loop';
                const isConfirming = confirmingActivityId === act.id;
                const isDeleting = deletingActivityId === act.id;
                const pace = formatPaceMinPerKm(
                  act.distanceMeters,
                  act.movingTimeSeconds
                );
                const speed = formatSpeedKmh(
                  act.distanceMeters,
                  act.movingTimeSeconds
                );

                return (
                  <article
                    key={act.id}
                    className="overflow-hidden rounded-2xl border border-border-subtle bg-carbon-950/80 transition hover:border-zinc-700"
                  >
                    <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                      {/* Left: Route Preview SVG + Title & Metadata */}
                      <div className="flex items-start gap-4">
                        <div
                          onClick={() =>
                            setExpandedActivityId(isExpanded ? null : act.id)
                          }
                          className="cursor-pointer transition-transform hover:scale-105"
                          title="Click to enlarge GPS route loop"
                        >
                          <RoutePreviewSvg
                            routeGeojson={act.routeGeojson}
                            color={accentColor}
                            size={84}
                            isLoop={isLoop}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded border border-neon-cyan/40 bg-neon-cyan/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-neon-cyan">
                              <Layers className="h-2.5 w-2.5" />
                              {isLoop ? 'CLOSED LOOP' : 'CORRIDOR'}
                            </span>

                            <span className="rounded border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                              {act.sportType}
                            </span>

                            <span className="inline-flex items-center gap-1 rounded border border-border-subtle bg-carbon-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                              <Calendar className="h-2.5 w-2.5" />
                              {act.roundName || act.roundId}
                            </span>
                          </div>

                          <h3 className="mt-1.5 break-words text-base font-bold text-white sm:text-lg">
                            {act.name}
                          </h3>

                          <p className="mt-0.5 font-mono text-xs text-zinc-400">
                            Recorded {formatRelativeTime(act.startedAt)} •{' '}
                            {new Date(act.startedAt).toLocaleDateString(
                              'en-NZ',
                              {
                                weekday: 'short',
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              }
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Right: Strava Telemetry Grid + Remove Activity Action */}
                      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle/60 pt-3 sm:border-t-0 sm:pt-0">
                        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                          <div className="rounded-xl border border-border-subtle/80 bg-carbon-900/70 px-3 py-2">
                            <span className="font-mono text-[10px] uppercase text-zinc-500">
                              DISTANCE
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-bold text-white">
                              {formatDistanceKm(act.distanceMeters)} km
                            </p>
                          </div>

                          <div className="rounded-xl border border-border-subtle/80 bg-carbon-900/70 px-3 py-2">
                            <span className="font-mono text-[10px] uppercase text-zinc-500">
                              DURATION
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-bold text-white">
                              {formatDuration(act.movingTimeSeconds)}
                            </p>
                          </div>

                          <div className="rounded-xl border border-border-subtle/80 bg-carbon-900/70 px-3 py-2">
                            <span className="font-mono text-[10px] uppercase text-zinc-500">
                              PACE / SPEED
                            </span>
                            <p className="mt-0.5 font-mono text-sm font-bold text-white">
                              {pace} /km
                            </p>
                            <p className="font-mono text-[10px] text-zinc-500">
                              {speed} km/h
                            </p>
                          </div>

                          <div className="rounded-xl border border-border-subtle/80 bg-carbon-900/70 px-3 py-2">
                            <span className="font-mono text-[10px] uppercase text-zinc-500">
                              LOOP CLAIM
                            </span>
                            <p
                              className="mt-0.5 font-mono text-sm font-bold"
                              style={{ color: accentColor }}
                            >
                              +{act.cellsCaptured} HEX
                            </p>
                            <p className="font-mono text-[10px] text-zinc-400">
                              {formatAreaKm2(act.areaKm2)} km²
                              {act.cellsStolen > 0
                                ? ` • ${act.cellsStolen} stolen`
                                : ''}
                            </p>
                          </div>
                        </div>

                        {isOwnProfile && !isConfirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmingActivityId(act.id)}
                            title="Remove Activity & Revert Hexes"
                            aria-label={`Remove activity ${act.name}`}
                            className="flex h-12 w-12 min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-carbon-900 text-zinc-400 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isConfirming && (
                      <div className="mx-4 mb-4 rounded-xl border border-red-500/40 bg-red-950/30 p-3.5 sm:mx-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                            <div>
                              <p className="text-xs font-bold text-red-200">
                                Remove &ldquo;{act.name}&rdquo; and revert its H3 hexes?
                              </p>
                              <p className="mt-0.5 text-[11px] text-red-300/90">
                                Any hexes held by this activity will revert to the most recent preceding walk covering them, or return to unclaimed territory.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmingActivityId(null)}
                              className="min-h-[48px] rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 font-mono text-xs font-semibold text-zinc-300"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDeleteActivity(act)}
                              className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-red-500/60 bg-red-500/20 px-4 py-2 font-mono text-xs font-bold text-red-200 transition hover:bg-red-500/30 disabled:opacity-50"
                            >
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              <span>Remove &amp; Revert Hexes</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Expandable Large Route Trajectory View */}
                    <div className="flex items-center justify-between border-t border-border-subtle/50 bg-carbon-900/50 px-4 py-2 font-mono text-[11px] text-zinc-400 sm:px-5">
                      <span className="flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5 text-neon-lime" />
                        Permanent GPS Route Path Preserved
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedActivityId(isExpanded ? null : act.id)
                        }
                        className="min-h-[40px] font-semibold text-neon-cyan hover:underline"
                      >
                        {isExpanded
                          ? 'Hide Large Route View'
                          : 'Expand Route Loop Preview'}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="flex flex-col items-center justify-center border-t border-border-subtle bg-carbon-950 p-6">
                        <RoutePreviewSvg
                          routeGeojson={act.routeGeojson}
                          color={accentColor}
                          width={520}
                          height={280}
                          isLoop={isLoop}
                          className="max-w-full"
                        />
                        <p className="mt-2 font-mono text-[11px] text-zinc-400">
                          {act.name} • {formatDistanceKm(act.distanceMeters)} km •{' '}
                          {formatAreaKm2(act.areaKm2)} km² enclosed area (+
                          {act.cellsCaptured} H3 Res-9 cells)
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
