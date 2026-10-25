'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  ActivityFeedItem,
  DeleteActivityRollbackResult,
  RoundSummary,
} from '@/lib/d1';
import {
  formatDistanceKm,
  formatRelativeTime,
  formatRoundCountdownStatus,
  toDatetimeLocalValue,
} from '@/lib/utils';
import {
  AlertTriangle,
  Archive,
  Calendar,
  Check,
  Clock,
  Crown,
  Hexagon,
  Loader2,
  Lock,
  Play,
  Plus,
  Shield,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';

interface RegisteredUserOption {
  id: string;
  username: string;
  displayName: string;
  colorHex: string;
  bio: string;
}

export interface RoundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rounds: RoundSummary[];
  currentRound: RoundSummary | null;
  currentUserId?: string | null;
  roundActivities?: ActivityFeedItem[];
  isAuthenticated: boolean;
  onSelectRound: (roundId: string) => void;
  onRoundsUpdated: (newRoundId?: string) => void;
  onActivityDeleted?: (rollback: DeleteActivityRollbackResult) => void;
}

export default function RoundsModal({
  isOpen,
  onClose,
  rounds: initialRounds,
  currentRound,
  currentUserId,
  roundActivities = [],
  isAuthenticated,
  onSelectRound,
  onRoundsUpdated,
  onActivityDeleted,
}: RoundsModalProps) {
  const [activeTab, setActiveTab] = useState<'switch' | 'create' | 'manage'>(
    'switch'
  );
  const [rounds, setRounds] = useState<RoundSummary[]>(initialRounds);
  const [registeredUsers, setRegisteredUsers] = useState<
    RegisteredUserOption[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  // Create Round Form State
  const [newRoundName, setNewRoundName] = useState('');
  const [newRoundDesc, setNewRoundDesc] = useState('');
  const [newRoundEndsAt, setNewRoundEndsAt] = useState('');
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    Set<string>
  >(new Set());
  const [setAsActive, setSetAsActive] = useState(true);

  // Manage Current Round Governance State
  const [editRoundName, setEditRoundName] = useState('');
  const [editRoundDesc, setEditRoundDesc] = useState('');
  const [editRoundEndsAt, setEditRoundEndsAt] = useState('');
  const [manageParticipantIds, setManageParticipantIds] = useState<Set<string>>(
    new Set()
  );

  // Activity deletion state inside Round Admin view
  const [confirmingActivityId, setConfirmingActivityId] = useState<
    string | null
  >(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(
    null
  );

  const isCurrentRoundAdmin = Boolean(
    currentUserId &&
      currentRound &&
      (!currentRound.createdBy || currentRound.createdBy === currentUserId)
  );

  const fetchRoundsData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/rounds', { cache: 'no-store' });
      const data = (await res.json()) as {
        rounds?: RoundSummary[];
        registeredUsers?: RegisteredUserOption[];
      };
      if (res.ok) {
        setRounds(data.rounds ?? []);
        const users = (data.registeredUsers ?? []) as RegisteredUserOption[];
        setRegisteredUsers(users);
        setSelectedParticipantIds((prev) =>
          prev.size > 0 ? prev : new Set(users.map((u) => u.id))
        );
      }
    } catch (err) {
      console.error('[INTVL 2.0 Rounds Modal Fetch Error]:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setRounds(initialRounds);
      setSuccessNote(null);
      setError(null);
      fetchRoundsData();
      if (currentRound) {
        setEditRoundName(currentRound.name);
        setEditRoundDesc(currentRound.description || '');
        setEditRoundEndsAt(toDatetimeLocalValue(currentRound.endsAt));
        setManageParticipantIds(
          new Set(currentRound.participants.map((p) => p.userId))
        );
      }
    }
  }, [isOpen, initialRounds, currentRound, fetchRoundsData]);

  const applyDurationPreset = (
    hoursFromNow: number | null,
    setter: (val: string) => void
  ) => {
    if (hoursFromNow === null) {
      setter('');
      return;
    }
    const future = new Date(Date.now() + hoursFromNow * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    setter(
      `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(
        future.getDate()
      )}T${pad(future.getHours())}:${pad(future.getMinutes())}`
    );
  };

  const toggleNewParticipant = (userId: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const toggleManageParticipant = (userId: string) => {
    setManageParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleCreateRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoundName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const endsAtIso = newRoundEndsAt.trim()
        ? new Date(newRoundEndsAt).toISOString()
        : null;

      const res = await fetch('/api/rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoundName.trim(),
          description: newRoundDesc.trim(),
          participantUserIds: Array.from(selectedParticipantIds),
          endsAt: endsAtIso,
          setAsActive,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        round?: RoundSummary;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to create round.');
      }

      setNewRoundName('');
      setNewRoundDesc('');
      setNewRoundEndsAt('');
      setActiveTab('switch');
      onRoundsUpdated(data.round?.id);
      if (data.round?.id) {
        onSelectRound(data.round.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create round.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRoundGovernance = async (
    roundId: string,
    updates: {
      name?: string;
      description?: string;
      status?: 'active' | 'archived';
      endsAt?: string | null;
      participantUserIds?: string[];
    },
    feedbackMessage?: string
  ) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccessNote(null);

    try {
      const res = await fetch('/api/rounds', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundId,
          ...updates,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to update round.');
      }

      await fetchRoundsData();
      onRoundsUpdated(roundId);
      if (feedbackMessage) {
        setSuccessNote(feedbackMessage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update round.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRoundActivity = async (activity: ActivityFeedItem) => {
    setDeletingActivityId(activity.id);
    setError(null);
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
      setConfirmingActivityId(null);
      setSuccessNote(
        `Removed "${activity.name}" — ${data.rollback.cellsReverted} hexes reverted to previous owners, ${data.rollback.cellsCleared} cleared.`
      );
      await fetchRoundsData();
      onActivityDeleted?.(data.rollback);
      onRoundsUpdated(currentRound?.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to remove activity.'
      );
    } finally {
      setDeletingActivityId(null);
    }
  };

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
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="safe-bottom relative z-10 flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border-subtle bg-carbon-900 shadow-glass sm:rounded-3xl"
          >
            {/* Top Neon Accent Bar */}
            <div className="h-1.5 w-full shrink-0 bg-gradient-to-r from-neon-cyan via-neon-lime to-neon-amber" />

            {/* Mobile Drag Handle */}
            <div className="flex shrink-0 justify-center pt-2.5 pb-1 sm:hidden">
              <div className="h-1.5 w-12 rounded-full bg-zinc-700" />
            </div>

            {/* Modal Header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-3.5 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-neon-cyan">
                  MULTI-ROUND &amp; SEASON GOVERNANCE
                </span>
                <h2 className="mt-1 font-display text-lg font-bold text-white sm:text-xl">
                  Rounds &amp; Season Management
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Switch active seasons, configure expiration countdowns, or manage round rosters &amp; activity rollbacks.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close Rounds Modal"
                className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/70 text-zinc-400 transition hover:border-zinc-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Navigation Tabs (All >= 48px touch targets) */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle/70 bg-carbon-950/60 px-4 py-2.5 sm:px-6 sm:py-3">
              <button
                type="button"
                onClick={() => setActiveTab('switch')}
                className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition ${
                  activeTab === 'switch'
                    ? 'border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan'
                    : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                }`}
              >
                <Calendar className="h-4 w-4" />
                <span>All Rounds ({rounds.length})</span>
              </button>

              {isAuthenticated && (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition ${
                      activeTab === 'create'
                        ? 'border-neon-lime/50 bg-neon-lime/15 text-neon-lime'
                        : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                    <span>New Round</span>
                  </button>

                  {currentRound && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('manage')}
                      className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3.5 py-2 font-mono text-xs font-semibold transition ${
                        activeTab === 'manage'
                          ? 'border-neon-amber/50 bg-neon-amber/15 text-neon-amber'
                          : 'border-border-subtle bg-carbon-900 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>Round Admin &amp; Roster</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Body */}
            <div className="touch-scroll flex-1 overflow-y-auto p-4 sm:p-6">
              {error && (
                <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  {error}
                </div>
              )}

              {successNote && (
                <div className="mb-4 rounded-xl border border-neon-lime/40 bg-neon-lime/10 p-3 text-xs text-neon-lime">
                  {successNote}
                </div>
              )}

              {activeTab === 'switch' && (
                <div className="space-y-3">
                  {isLoading && rounds.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-neon-cyan" />
                    </div>
                  ) : (
                    rounds.map((round) => {
                      const isSelected = currentRound?.id === round.id;
                      const countdown = formatRoundCountdownStatus(round);
                      const isRoundAdmin = Boolean(
                        currentUserId &&
                          (!round.createdBy ||
                            round.createdBy === currentUserId)
                      );

                      return (
                        <div
                          key={round.id}
                          className={`rounded-2xl border p-4 transition ${
                            isSelected
                              ? 'border-neon-cyan/60 bg-zinc-800/75 shadow-lg'
                              : 'border-border-subtle bg-carbon-950/75 hover:border-zinc-700'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                                    countdown.isConcluded
                                      ? 'border border-amber-400/40 bg-amber-400/15 text-amber-300'
                                      : 'border border-neon-lime/40 bg-neon-lime/15 text-neon-lime'
                                  }`}
                                >
                                  {countdown.isConcluded ? (
                                    <Lock className="h-3 w-3" />
                                  ) : (
                                    <Clock className="h-3 w-3" />
                                  )}
                                  <span>{countdown.label}</span>
                                </span>

                                {isSelected && (
                                  <span className="rounded border border-neon-cyan/40 bg-neon-cyan/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-neon-cyan">
                                    VIEWING MAP
                                  </span>
                                )}

                                {round.adminDisplayName && (
                                  <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-carbon-900 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                                    <Shield className="h-3 w-3 text-neon-amber" />
                                    <span>Admin: {round.adminDisplayName}</span>
                                  </span>
                                )}

                                <span className="font-mono text-[11px] text-zinc-500">
                                  Started {formatRelativeTime(round.startedAt)}
                                </span>
                              </div>

                              <h3 className="mt-2 break-words font-display text-base font-bold text-white">
                                {round.name}
                              </h3>
                              {round.description && (
                                <p className="mt-0.5 break-words text-xs text-zinc-400">
                                  {round.description}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {!isSelected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectRound(round.id);
                                    onClose();
                                  }}
                                  className="flex min-h-[48px] items-center justify-center rounded-xl bg-neon-cyan px-4 py-2 font-mono text-xs font-bold text-carbon-950 transition hover:brightness-110"
                                >
                                  Switch to Round
                                </button>
                              )}

                              {isAuthenticated && isRoundAdmin && (
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    handleUpdateRoundGovernance(round.id, {
                                      status:
                                        round.status === 'active'
                                          ? 'archived'
                                          : 'active',
                                    })
                                  }
                                  className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 font-mono text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                                >
                                  {round.status === 'active' ? (
                                    <>
                                      <Archive className="h-3.5 w-3.5 text-zinc-400" />
                                      <span>Conclude</span>
                                    </>
                                  ) : (
                                    <>
                                      <Play className="h-3.5 w-3.5 text-neon-lime" />
                                      <span>Re-Activate</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Round Telemetry & Full-Name Participant Chips (Zero Truncation) */}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle/60 pt-3">
                            <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-zinc-300">
                              <span className="flex items-center gap-1">
                                <Hexagon className="h-3.5 w-3.5 text-neon-cyan" />
                                {round.totalCellsClaimed} Hexes
                              </span>
                              <span className="flex items-center gap-1">
                                <Crown className="h-3.5 w-3.5 text-neon-amber" />
                                {round.totalActivitiesCount} Activities
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              {round.participants.length === 0 ? (
                                <span className="font-mono text-[11px] text-zinc-500">
                                  Open to all squad members
                                </span>
                              ) : (
                                round.participants.map((p) => (
                                  <span
                                    key={p.userId}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-carbon-900 px-2.5 py-1 font-mono text-[11px] text-zinc-200"
                                  >
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: p.colorHex }}
                                    />
                                    <span className="break-words">
                                      {p.displayName}
                                    </span>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {activeTab === 'create' && (
                <form onSubmit={handleCreateRound} className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Round / Season Name
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={60}
                      value={newRoundName}
                      onChange={(e) => setNewRoundName(e.target.value)}
                      placeholder="e.g. Round 2 — Auckland Winter Blitz"
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-950 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-lime"
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Description / Custom Rules (Optional)
                    </label>
                    <input
                      type="text"
                      maxLength={140}
                      value={newRoundDesc}
                      onChange={(e) => setNewRoundDesc(e.target.value)}
                      placeholder="e.g. 7-day sprint across Central Auckland — closed loops & corridors"
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-950 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-lime"
                    />
                  </div>

                  {/* Round Duration & Hard Expiration Date (ends_at) */}
                  <div className="rounded-2xl border border-border-subtle bg-carbon-950/75 p-3.5">
                    <label className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      <Clock className="h-3.5 w-3.5 text-neon-cyan" />
                      <span>Hard Expiration Date &amp; Time (Optional)</span>
                    </label>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      When reached, new activity imports and webhook syncs automatically lock until extended by you (Round Admin).
                    </p>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {[
                        { label: 'No Limit', hours: null },
                        { label: '+24 Hours', hours: 24 },
                        { label: '+3 Days', hours: 72 },
                        { label: '+7 Days', hours: 168 },
                        { label: '+14 Days', hours: 336 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            applyDurationPreset(
                              preset.hours,
                              setNewRoundEndsAt
                            )
                          }
                          className="min-h-[40px] rounded-lg border border-border-subtle bg-carbon-900 px-3 py-1.5 font-mono text-[11px] text-zinc-300 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="datetime-local"
                      value={newRoundEndsAt}
                      onChange={(e) => setNewRoundEndsAt(e.target.value)}
                      className="mt-2.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 font-mono text-xs text-white outline-none focus:border-neon-cyan"
                    />
                  </div>

                  {/* Participant Selector */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                        Select Participating Players (
                        {selectedParticipantIds.size}/{registeredUsers.length})
                      </label>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedParticipantIds(
                              new Set(registeredUsers.map((u) => u.id))
                            )
                          }
                          className="min-h-[40px] px-2 text-neon-lime hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-zinc-600">•</span>
                        <button
                          type="button"
                          onClick={() => setSelectedParticipantIds(new Set())}
                          className="min-h-[40px] px-2 text-zinc-400 hover:text-white hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                      {registeredUsers.map((u) => {
                        const checked = selectedParticipantIds.has(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => toggleNewParticipant(u.id)}
                            className={`flex min-h-[52px] items-center justify-between rounded-xl border p-3 text-left transition ${
                              checked
                                ? 'border-white/50 bg-zinc-800/80'
                                : 'border-border-subtle bg-carbon-950/70 opacity-60 hover:opacity-100'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="h-3.5 w-3.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: u.colorHex,
                                  boxShadow: `0 0 8px ${u.colorHex}`,
                                }}
                              />
                              <div className="min-w-0">
                                <p className="break-words text-xs font-bold text-white">
                                  {u.displayName}
                                </p>
                                <p className="break-words font-mono text-[10px] text-zinc-400">
                                  @{u.username}
                                </p>
                              </div>
                            </div>

                            <div
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                                checked
                                  ? 'border-neon-lime bg-neon-lime text-carbon-950'
                                  : 'border-zinc-700 bg-carbon-900'
                              }`}
                            >
                              {checked && (
                                <Check className="h-3.5 w-3.5 stroke-[3]" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex min-h-[48px] cursor-pointer items-center gap-2.5 rounded-xl border border-border-subtle bg-carbon-950/70 p-3">
                    <input
                      type="checkbox"
                      checked={setAsActive}
                      onChange={(e) => setSetAsActive(e.target.checked)}
                      className="h-4 w-4 accent-neon-lime"
                    />
                    <span className="text-xs text-zinc-200">
                      Set as the active round immediately (archives previous active round while preserving its map history)
                    </span>
                  </label>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('switch')}
                      className="min-h-[48px] rounded-xl border border-border-subtle bg-carbon-950 px-4 py-2.5 font-mono text-xs text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !newRoundName.trim()}
                      className="flex min-h-[48px] items-center gap-2 rounded-xl bg-neon-lime px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-carbon-950 shadow transition hover:brightness-110 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      <span>Create Round</span>
                    </button>
                  </div>
                </form>
              )}

              {activeTab === 'manage' && currentRound && (
                <div className="space-y-5">
                  {/* Admin Role Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-carbon-950/80 p-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-neon-amber/40 bg-neon-amber/15 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-neon-amber">
                          <Shield className="h-3 w-3" />
                          <span>
                            {isCurrentRoundAdmin
                              ? 'ROUND ADMIN PRIVILEGES ACTIVE'
                              : `ROUND ADMIN: ${
                                  currentRound.adminDisplayName || 'Creator'
                                }`}
                          </span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                            formatRoundCountdownStatus(currentRound).isConcluded
                              ? 'border border-amber-400/40 bg-amber-400/15 text-amber-300'
                              : 'border border-neon-lime/40 bg-neon-lime/15 text-neon-lime'
                          }`}
                        >
                          {formatRoundCountdownStatus(currentRound).label}
                        </span>
                      </div>
                      <h3 className="mt-1.5 break-words font-display text-base font-bold text-white">
                        {currentRound.name}
                      </h3>
                    </div>

                    {isCurrentRoundAdmin && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() =>
                          handleUpdateRoundGovernance(
                            currentRound.id,
                            {
                              status:
                                currentRound.status === 'active'
                                  ? 'archived'
                                  : 'active',
                            },
                            currentRound.status === 'active'
                              ? 'Round concluded and locked.'
                              : 'Round re-activated.'
                          )
                        }
                        className={`flex min-h-[48px] items-center gap-1.5 rounded-xl border px-4 py-2 font-mono text-xs font-bold transition ${
                          currentRound.status === 'active'
                            ? 'border-amber-400/50 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25'
                            : 'border-neon-lime/50 bg-neon-lime/15 text-neon-lime hover:bg-neon-lime/25'
                        }`}
                      >
                        {currentRound.status === 'active' ? (
                          <>
                            <Lock className="h-4 w-4" />
                            <span>Conclude / Freeze Round Now</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            <span>Re-Open Round</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Round Details & Hard Expiration Date (ends_at) Editor */}
                  {isCurrentRoundAdmin && (
                    <div className="space-y-3 rounded-2xl border border-border-subtle bg-carbon-950/60 p-4">
                      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-200">
                        1. Round Details &amp; Hard Expiration Date
                      </p>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block font-mono text-[11px] uppercase text-zinc-400">
                            Round Name
                          </label>
                          <input
                            type="text"
                            value={editRoundName}
                            onChange={(e) => setEditRoundName(e.target.value)}
                            className="mt-1 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-900 px-3 py-2 text-xs text-white outline-none focus:border-neon-amber"
                          />
                        </div>
                        <div>
                          <label className="block font-mono text-[11px] uppercase text-zinc-400">
                            Description / Rules
                          </label>
                          <input
                            type="text"
                            value={editRoundDesc}
                            onChange={(e) => setEditRoundDesc(e.target.value)}
                            className="mt-1 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-900 px-3 py-2 text-xs text-white outline-none focus:border-neon-amber"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block font-mono text-[11px] uppercase text-zinc-400">
                          Expiration Date &amp; Time (Hard Lock Ingestion Cutoff)
                        </label>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {[
                            { label: 'No Expiration', hours: null },
                            { label: '+24 Hours', hours: 24 },
                            { label: '+3 Days', hours: 72 },
                            { label: '+7 Days', hours: 168 },
                          ].map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() =>
                                applyDurationPreset(
                                  preset.hours,
                                  setEditRoundEndsAt
                                )
                              }
                              className="min-h-[40px] rounded-lg border border-border-subtle bg-carbon-900 px-3 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-neon-amber/50 hover:text-neon-amber"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="datetime-local"
                          value={editRoundEndsAt}
                          onChange={(e) => setEditRoundEndsAt(e.target.value)}
                          className="mt-2 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 font-mono text-xs text-white outline-none focus:border-neon-amber"
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() =>
                            handleUpdateRoundGovernance(
                              currentRound.id,
                              {
                                name: editRoundName.trim() || currentRound.name,
                                description: editRoundDesc.trim(),
                                endsAt: editRoundEndsAt.trim()
                                  ? new Date(editRoundEndsAt).toISOString()
                                  : null,
                              },
                              'Round settings and expiration date updated.'
                            )
                          }
                          className="flex min-h-[48px] items-center gap-2 rounded-xl bg-neon-cyan px-4 py-2 font-mono text-xs font-bold uppercase text-carbon-950 transition hover:brightness-110 disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" />
                          <span>Save Details &amp; Expiration</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Roster Management */}
                  <div className="space-y-3 rounded-2xl border border-border-subtle bg-carbon-950/60 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-200">
                        2. Active Round Roster ({manageParticipantIds.size}/
                        {registeredUsers.length})
                      </p>
                      <Users className="h-4 w-4 text-neon-amber" />
                    </div>

                    <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                      {registeredUsers.map((u) => {
                        const checked = manageParticipantIds.has(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            disabled={!isCurrentRoundAdmin}
                            onClick={() => toggleManageParticipant(u.id)}
                            className={`flex min-h-[52px] items-center justify-between rounded-xl border p-3 text-left transition ${
                              checked
                                ? 'border-neon-amber/60 bg-zinc-800/80'
                                : 'border-border-subtle bg-carbon-950/70 opacity-60 hover:opacity-100'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                className="h-3.5 w-3.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: u.colorHex,
                                  boxShadow: `0 0 8px ${u.colorHex}`,
                                }}
                              />
                              <div className="min-w-0">
                                <p className="break-words text-xs font-bold text-white">
                                  {u.displayName}
                                </p>
                                <p className="break-words font-mono text-[10px] text-zinc-400">
                                  @{u.username}
                                </p>
                              </div>
                            </div>

                            <div
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                                checked
                                  ? 'border-neon-amber bg-neon-amber text-carbon-950'
                                  : 'border-zinc-700 bg-carbon-900'
                              }`}
                            >
                              {checked && (
                                <Check className="h-3.5 w-3.5 stroke-[3]" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {isCurrentRoundAdmin && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() =>
                            handleUpdateRoundGovernance(
                              currentRound.id,
                              {
                                participantUserIds:
                                  Array.from(manageParticipantIds),
                              },
                              'Round player roster updated.'
                            )
                          }
                          className="flex min-h-[48px] items-center gap-2 rounded-xl bg-neon-amber px-4 py-2 font-mono text-xs font-bold uppercase text-carbon-950 transition hover:brightness-110 disabled:opacity-50"
                        >
                          <Shield className="h-4 w-4" />
                          <span>Save Round Roster</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Round Activity Ledger & State Rollback */}
                  <div className="space-y-3 rounded-2xl border border-border-subtle bg-carbon-950/60 p-4">
                    <div>
                      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-200">
                        3. Round Activity Ledger &amp; Hex State Rollback (
                        {roundActivities.length})
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        Removing an activity automatically reverts its H3 cells to the most recent preceding walk covering them.
                      </p>
                    </div>

                    {roundActivities.length === 0 ? (
                      <p className="py-4 text-center font-mono text-xs text-zinc-500">
                        No activities recorded in this round yet.
                      </p>
                    ) : (
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {roundActivities.map((act) => {
                          const canRemove = Boolean(
                            currentUserId &&
                              (isCurrentRoundAdmin ||
                                act.userId === currentUserId)
                          );
                          const isConfirming = confirmingActivityId === act.id;
                          const isDeleting = deletingActivityId === act.id;

                          return (
                            <div
                              key={act.id}
                              className="rounded-xl border border-border-subtle bg-carbon-900/90 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className="text-xs font-bold"
                                      style={{ color: act.userColor }}
                                    >
                                      {act.displayName}
                                    </span>
                                    <span className="text-zinc-600">•</span>
                                    <span className="font-mono text-[11px] text-zinc-400">
                                      +{act.cellsCaptured} hex •{' '}
                                      {formatDistanceKm(act.distanceMeters)} km
                                    </span>
                                  </div>
                                  <p className="mt-0.5 break-words text-xs font-semibold text-white">
                                    {act.name}
                                  </p>
                                </div>

                                {canRemove && !isConfirming && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmingActivityId(act.id)
                                    }
                                    aria-label={`Remove ${act.name}`}
                                    className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-carbon-950 text-zinc-400 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>

                              {isConfirming && (
                                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-950/30 p-2.5">
                                  <span className="flex items-center gap-1.5 text-xs font-semibold text-red-200">
                                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                                    <span>
                                      Remove &amp; revert H3 cells?
                                    </span>
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmingActivityId(null)
                                      }
                                      className="min-h-[40px] rounded-lg border border-border-subtle bg-carbon-900 px-3 py-1 font-mono text-xs text-zinc-300"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() =>
                                        handleDeleteRoundActivity(act)
                                      }
                                      className="flex min-h-[40px] items-center gap-1 rounded-lg border border-red-500/60 bg-red-500/20 px-3 py-1 font-mono text-xs font-bold text-red-200"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                      <span>Confirm Rollback</span>
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
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
