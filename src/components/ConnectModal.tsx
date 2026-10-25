'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { TACTICAL_PALETTE, isValidTacticalColor } from '@/lib/utils';
import type { LeaderboardEntry } from '@/lib/d1';
import PwaInstallBanner from '@/components/PwaInstallBanner';
import type { HomeArea, MapViewport } from '@/components/Map';
import {
  Check,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  Home,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  Palette,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  User,
  UserCheck,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';

export interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAthlete: LeaderboardEntry | null;
  isAuthenticated: boolean;
  stravaConfigured: boolean;
  onProfileUpdated: () => void;
  onLogout: () => void;
  homeArea?: HomeArea | null;
  getMapView?: () => MapViewport | null;
}

export default function ConnectModal({
  isOpen,
  onClose,
  currentAthlete,
  isAuthenticated,
  stravaConfigured,
  onProfileUpdated,
  onLogout,
  homeArea,
  getMapView,
}: ConnectModalProps) {
  const [displayName, setDisplayName] = useState<string>(
    currentAthlete?.displayName || currentAthlete?.username || ''
  );
  const [bio, setBio] = useState<string>(currentAthlete?.bio || '');
  const [selectedColor, setSelectedColor] = useState<string>(
    currentAthlete?.color || TACTICAL_PALETTE[0].hex
  );
  const [stravaLinkedLocal, setStravaLinkedLocal] = useState<boolean>(
    Boolean(currentAthlete?.stravaConnected)
  );
  const [stravaAthleteIdLocal, setStravaAthleteIdLocal] = useState<
    number | null
  >(currentAthlete?.stravaAthleteId ?? null);

  // Home Area state
  const [homeLat, setHomeLat] = useState<number | null>(homeArea?.lat ?? null);
  const [homeLng, setHomeLng] = useState<number | null>(homeArea?.lng ?? null);
  const [homeZoom, setHomeZoom] = useState<number>(homeArea?.zoom ?? 14);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnectingStrava, setIsDisconnectingStrava] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentAthlete) {
      setDisplayName(currentAthlete.displayName || currentAthlete.username);
      setBio(currentAthlete.bio || '');
      setSelectedColor(currentAthlete.color);
      setStravaLinkedLocal(Boolean(currentAthlete.stravaConnected));
      setStravaAthleteIdLocal(currentAthlete.stravaAthleteId ?? null);
    }
    if (homeArea) {
      setHomeLat(homeArea.lat);
      setHomeLng(homeArea.lng);
      setHomeZoom(homeArea.zoom ?? 14);
    } else {
      setHomeLat(null);
      setHomeLng(null);
      setHomeZoom(14);
    }
    setLocationNotice(null);
    setStatusMessage(null);
    setError(null);
  }, [currentAthlete, isOpen, homeArea]);

  const activeColorMeta = TACTICAL_PALETTE.find(
    (c) => c.hex.toLowerCase() === selectedColor.toLowerCase()
  );

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setIsLocating(true);
    setError(null);
    setLocationNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setHomeLat(lat);
        setHomeLng(lng);
        setIsLocating(false);
        setLocationNotice(`Captured GPS coordinates: ${lat}, ${lng}`);
      },
      (err) => {
        setIsLocating(false);
        setError(`Geolocation failed: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSetFromMapCenter = () => {
    const viewport = getMapView?.();
    if (!viewport) {
      setError('Map view is not ready yet.');
      return;
    }
    const center = viewport.getCenter();
    const zoom = viewport.getZoom();
    const lat = Number(center.lat.toFixed(6));
    const lng = Number(center.lng.toFixed(6));
    setHomeLat(lat);
    setHomeLng(lng);
    setHomeZoom(zoom || 14);
    setLocationNotice(
      `Captured current map center: ${lat}, ${lng} (Zoom level ${zoom || 14})`
    );
  };

  const handleClearHome = () => {
    setHomeLat(null);
    setHomeLng(null);
    setHomeZoom(14);
    setLocationNotice('Home area cleared. Tap Save Profile to apply.');
  };

  const handleDisconnectStrava = async () => {
    if (isDisconnectingStrava) return;
    setIsDisconnectingStrava(true);
    setError(null);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/auth/strava/disconnect', {
        method: 'POST',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to disconnect Strava account.');
      }

      setStravaLinkedLocal(false);
      setStravaAthleteIdLocal(null);
      setStatusMessage(
        'Strava account disconnected and developer athlete slot freed.'
      );
      onProfileUpdated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to disconnect Strava account.'
      );
    } finally {
      setIsDisconnectingStrava(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) return;
    setError(null);
    setStatusMessage(null);

    const trimmedName = displayName.trim();
    if (!trimmedName || trimmedName.length > 32) {
      setError('Display Name must be between 1 and 32 characters.');
      return;
    }

    if (!isValidTacticalColor(selectedColor)) {
      setError('Please pick a valid hex color (e.g. #00f0ff).');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: trimmedName,
          bio: bio.trim(),
          colorHex: selectedColor,
          homeLat: homeLat,
          homeLng: homeLng,
          homeZoom: homeZoom,
        }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update profile.');
      }

      onProfileUpdated();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save profile settings.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
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
            className="safe-bottom relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border-subtle bg-carbon-900 shadow-glass sm:rounded-3xl"
          >
            <div
              className="h-1.5 w-full shrink-0 transition-colors duration-300"
              style={{
                backgroundColor: selectedColor,
                boxShadow: `0 0 20px ${selectedColor}`,
              }}
            />

            {/* Mobile Drag Indicator Handle */}
            <div className="flex shrink-0 justify-center pt-2.5 pb-1 sm:hidden">
              <div className="h-1.5 w-12 rounded-full bg-zinc-700" />
            </div>

            {/* Fixed Header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-3.5 sm:px-6 sm:py-4">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl border border-neon-cyan/40 bg-carbon-950 shadow-neon-cyan">
                  <img
                    src="/logo.png"
                    alt="INTVL 2.0 Logo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                    INTVL 2.0 // ATHLETE SETTINGS
                  </span>
                  <h2 className="font-display text-lg font-bold text-white sm:text-xl">
                    {isAuthenticated && currentAthlete
                      ? currentAthlete.displayName
                      : 'Squad Account Setup'}
                  </h2>
                  {isAuthenticated && currentAthlete && (
                    <p className="font-mono text-[11px] text-zinc-400">
                      Login ID: @{currentAthlete.username}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close Settings Modal"
                className="flex h-12 w-12 min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-carbon-950/60 text-zinc-400 transition hover:border-zinc-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Modal Body */}
            <div className="touch-scroll flex-1 overflow-y-auto p-5 sm:p-6">
              {isAuthenticated && currentAthlete ? (
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  {error && (
                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                      {error}
                    </div>
                  )}

                  {statusMessage && (
                    <div className="rounded-xl border border-neon-lime/40 bg-neon-lime/10 px-3.5 py-2.5 text-xs text-neon-lime">
                      {statusMessage}
                    </div>
                  )}

                  {/* Dedicated Athlete Profile Link */}
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-carbon-950/80 p-3.5">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                        PERSONAL ATHLETE HUB
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-zinc-200">
                        View your career stats, pace, and Strava-style activity feed.
                      </p>
                    </div>
                    <Link
                      href={`/profile/${currentAthlete.userId}`}
                      onClick={onClose}
                      className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl border border-neon-cyan/50 bg-neon-cyan/15 px-3.5 py-2 font-mono text-xs font-bold text-neon-cyan transition hover:bg-neon-cyan/25"
                    >
                      <User className="h-4 w-4" />
                      <span>View Profile</span>
                    </Link>
                  </div>

                  {/* PWA Add to Home Screen Standalone App Card */}
                  <PwaInstallBanner variant="card" />

                  {/* Strava Connection & Slot Management Box */}
                  <div className="rounded-2xl border border-border-subtle bg-carbon-950/85 p-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                            STRAVA OAUTH TELEMETRY &amp; SLOT MANAGEMENT
                          </p>
                          {stravaLinkedLocal ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-neon-lime">
                              <CheckCircle2 className="h-4 w-4 shrink-0" />
                              <span>
                                Connected (Athlete #{stravaAthleteIdLocal})
                              </span>
                            </p>
                          ) : (
                            <p className="mt-1 text-xs font-medium text-amber-300">
                              No Strava account currently linked. Connect with Strava to sync Walk, Run, and Hike loops.
                            </p>
                          )}
                        </div>
                      </div>

                      {stravaLinkedLocal ? (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isDisconnectingStrava}
                            onClick={handleDisconnectStrava}
                            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-xs font-bold text-red-200 transition hover:bg-red-500/25 disabled:opacity-50"
                          >
                            {isDisconnectingStrava ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Unplug className="h-4 w-4" />
                            )}
                            <span>
                              {isDisconnectingStrava
                                ? 'Disconnecting...'
                                : 'Disconnect Strava'}
                            </span>
                          </button>

                          <a
                            href="/api/auth/strava"
                            className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                          >
                            <Zap className="h-3.5 w-3.5 text-strava-orange" />
                            <span>Reconnect</span>
                          </a>
                        </div>
                      ) : (
                        <a
                          href="/api/auth/strava"
                          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-strava-orange px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow transition hover:bg-strava-hover"
                        >
                          <Zap className="h-4 w-4 fill-current" />
                          <span>Connect with Strava</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Public Display Name (Decoupled from Login Username) */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                        <UserCheck className="h-3.5 w-3.5 text-neon-cyan" />
                        <span>Public Display Name</span>
                      </label>
                      <span className="font-mono text-[10px] text-zinc-500">
                        Login: @{currentAthlete.username}
                      </span>
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={32}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your in-game name on leaderboards & map"
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-950 px-3.5 py-2.5 text-sm font-medium text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                    />
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">
                      Shown across leaderboards, map hex tooltips, and activity feeds.
                    </p>
                  </div>

                  {/* Profile Details / Bio */}
                  <div>
                    <label className="block font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Athlete Bio / Tagline
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="e.g. Auckland Waterfront loop runner • Sub-20 5K"
                      className="mt-1.5 min-h-[48px] w-full rounded-xl border border-border-subtle bg-carbon-950 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                    />
                  </div>

                  {/* Custom Territory Color Picker (Presets + Custom Hex Color Input) */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                        <Palette className="h-3.5 w-3.5 text-zinc-400" />
                        <span>Territory Hex Color</span>
                      </label>
                      <span
                        className="font-mono text-xs font-bold uppercase"
                        style={{ color: selectedColor }}
                      >
                        {activeColorMeta
                          ? `${activeColorMeta.name} (${selectedColor})`
                          : `Custom (${selectedColor})`}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
                      {TACTICAL_PALETTE.map((option) => {
                        const isSelected =
                          option.hex.toLowerCase() ===
                          selectedColor.toLowerCase();
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setSelectedColor(option.hex)}
                            className={`group flex min-h-[48px] min-w-[48px] flex-col items-center justify-center rounded-xl border p-2 transition ${
                              isSelected
                                ? 'border-white bg-zinc-800/90'
                                : 'border-border-subtle bg-carbon-950/70 hover:border-zinc-700'
                            }`}
                          >
                            <div
                              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 transition-transform group-hover:scale-110"
                              style={{
                                backgroundColor: option.hex,
                                boxShadow: `0 0 10px ${option.hex}`,
                              }}
                            >
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 stroke-[2.5] text-carbon-950" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom Color Picker Row */}
                    <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-border-subtle bg-carbon-950/70 px-3 py-2">
                      <input
                        type="color"
                        value={
                          isValidTacticalColor(selectedColor)
                            ? selectedColor
                            : '#00f0ff'
                        }
                        onChange={(e) => setSelectedColor(e.target.value)}
                        className="h-9 w-11 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <span className="font-mono text-[11px] text-zinc-400">
                        Custom Hex:
                      </span>
                      <input
                        type="text"
                        maxLength={7}
                        value={selectedColor}
                        onChange={(e) => setSelectedColor(e.target.value)}
                        className="min-h-[42px] w-28 rounded-lg border border-border-subtle bg-carbon-900 px-2.5 py-1 font-mono text-xs uppercase text-white outline-none focus:border-neon-cyan"
                      />
                    </div>
                  </div>

                  {/* Home Territory / Base Area Configuration */}
                  <div className="rounded-2xl border border-border-subtle bg-carbon-950/85 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-zinc-300">
                          <Home className="h-3.5 w-3.5 text-neon-lime" />
                          <span>Home Territory / Base Area</span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">
                          Configure your personal neighborhood camera anchor. One tap on the Home button in the map cluster zooms straight here.
                        </p>
                      </div>
                      {homeLat !== null && homeLng !== null && (
                        <span className="shrink-0 rounded-lg border border-neon-lime/40 bg-neon-lime/10 px-2.5 py-1 font-mono text-[11px] font-bold text-neon-lime">
                          Configured
                        </span>
                      )}
                    </div>

                    {/* Current Coordinates Banner */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-carbon-900/80 px-3.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-zinc-400" />
                        <span className="font-mono text-xs text-zinc-200">
                          {homeLat !== null && homeLng !== null
                            ? `${homeLat.toFixed(5)}, ${homeLng.toFixed(5)} (Zoom ${homeZoom})`
                            : 'No home base set (using default Auckland Central)'}
                        </span>
                      </div>
                      {homeLat !== null && homeLng !== null && (
                        <button
                          type="button"
                          onClick={handleClearHome}
                          className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 transition hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Clear</span>
                        </button>
                      )}
                    </div>

                    {locationNotice && (
                      <p className="mt-2 text-xs font-medium text-neon-lime">
                        {locationNotice}
                      </p>
                    )}

                    {/* Dual Location Action Buttons */}
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={handleUseCurrentLocation}
                        disabled={isLocating}
                        className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-3.5 py-2 text-xs font-bold text-neon-cyan transition hover:bg-neon-cyan/20 disabled:opacity-50"
                      >
                        {isLocating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Navigation className="h-4 w-4" />
                        )}
                        <span>Use Current Location</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSetFromMapCenter}
                        className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-border-subtle bg-carbon-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                      >
                        <Crosshair className="h-4 w-4 text-neon-lime" />
                        <span>Set from Current Map Center</span>
                      </button>
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-zinc-500">
                      Tip: Pan or zoom the map behind this window to center your neighborhood, then tap &quot;Set from Current Map Center&quot;.
                    </p>
                  </div>

                  {/* Save Profile + Logout Actions */}
                  <div className="flex flex-col gap-2.5 pt-2 sm:flex-row">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-carbon-950 px-5 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:border-zinc-600 disabled:opacity-50"
                      style={{
                        borderColor: `${selectedColor}66`,
                        boxShadow: `0 0 20px ${selectedColor}22`,
                      }}
                    >
                      <Sparkles
                        className="h-4 w-4"
                        style={{ color: selectedColor }}
                      />
                      <span>
                        {isSaving ? 'Saving Profile...' : 'Save Profile Settings'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onLogout();
                      }}
                      className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-500/20"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Log Out</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col gap-3">
                  <PwaInstallBanner variant="card" />

                  <Link
                    href="/register"
                    onClick={onClose}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-neon-cyan px-5 py-3.5 text-sm font-bold text-carbon-950 shadow-neon-cyan transition hover:brightness-110"
                  >
                    <UserPlus className="h-4 w-4" />
                    <span>Create INTVL 2.0 Account</span>
                  </Link>

                  <Link
                    href="/login"
                    onClick={onClose}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-carbon-950 px-5 py-3 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                  >
                    <LogIn className="h-4 w-4 text-neon-cyan" />
                    <span>Already have an account? Log In</span>
                  </Link>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-border-subtle/70 pt-3 font-mono text-[10px] text-zinc-500">
                <span className="flex items-center gap-1">
                  <Lock className="h-3 w-3 text-zinc-400" />
                  Walk • Run • Hike Only
                </span>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-neon-lime" />
                  {stravaConfigured
                    ? 'Strava OAuth Ready'
                    : 'Awaiting STRAVA_CLIENT_ID'}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
