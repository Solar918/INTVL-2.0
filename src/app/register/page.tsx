'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TACTICAL_PALETTE } from '@/lib/utils';
import {
  ArrowLeft,
  Check,
  Loader2,
  Lock,
  Palette,
  ShieldAlert,
  User,
  UserCheck,
  UserPlus,
} from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [colorHex, setColorHex] = useState<string>(TACTICAL_PALETTE[0].hex);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedColorMeta =
    TACTICAL_PALETTE.find(
      (c) => c.hex.toLowerCase() === colorHex.toLowerCase()
    ) || TACTICAL_PALETTE[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const normalizedUsername = username.trim().toLowerCase();
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUsername,
          displayName: displayName.trim() || normalizedUsername,
          password,
          colorHex,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Could not create account.');
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-carbon-950 p-4">
      {/* Subtle Neon Radial Glow */}
      <div
        className="pointer-events-none fixed inset-0 opacity-25 transition-all duration-500"
        style={{
          background: `radial-gradient(circle at 50% 25%, ${colorHex}33 0%, transparent 60%)`,
        }}
      />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border-subtle bg-carbon-900/95 shadow-glass backdrop-blur-2xl">
        {/* Top Signature Neon Bar */}
        <div
          className="h-1.5 w-full transition-colors duration-300"
          style={{
            backgroundColor: colorHex,
            boxShadow: `0 0 20px ${colorHex}`,
          }}
        />

        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-400 transition hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Auckland Map</span>
            </Link>
            <span className="rounded border border-zinc-700/80 bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
              H3 • RES 9
            </span>
          </div>

          {/* Brand Logo & Heading */}
          <div className="mt-5 flex flex-col items-center text-center">
            <div className="h-20 w-20 overflow-hidden rounded-2xl border border-neon-cyan/40 bg-carbon-950 shadow-neon-cyan">
              <img
                src="/logo.png"
                alt="INTVL 2.0 Logo"
                className="h-full w-full object-cover"
              />
            </div>
            <h1 className="mt-3.5 font-display text-2xl font-bold tracking-wider text-white">
              INTVL 2.0
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              Create your athlete profile, pick your neon turf color, and link Strava to conquer Auckland.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Public Display Name Input */}
            <div>
              <label className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Public Display Name
              </label>
              <div className="relative mt-1.5">
                <UserCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  maxLength={32}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Ethan (Shown on Leaderboard & Map)"
                  className="w-full rounded-xl border border-border-subtle bg-carbon-950 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-zinc-500">
                Customizable anytime in settings.
              </p>
            </div>

            {/* Login Username Input */}
            <div>
              <label className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Login Username
              </label>
              <div className="relative mt-1.5">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={24}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. ethan_akl"
                  autoComplete="username"
                  className="w-full rounded-xl border border-border-subtle bg-carbon-950 py-3 pl-10 pr-4 font-mono text-sm text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-zinc-500">
                Used strictly for signing in (lowercase, 3–24 chars).
              </p>
            </div>

            {/* Password Input */}
            <div>
              <label className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Password
              </label>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-border-subtle bg-carbon-950 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                />
              </div>
            </div>

            {/* Signature Neon Color Picker */}
            <div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  <Palette className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Signature Territory Color</span>
                </label>
                <span
                  className="font-mono text-xs font-bold"
                  style={{ color: colorHex }}
                >
                  {selectedColorMeta.name}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-2">
                {TACTICAL_PALETTE.map((option) => {
                  const isSelected =
                    option.hex.toLowerCase() === colorHex.toLowerCase();
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setColorHex(option.hex)}
                      className={`group flex flex-col items-center justify-center rounded-xl border p-2.5 transition ${
                        isSelected
                          ? 'border-white bg-zinc-800/90'
                          : 'border-border-subtle bg-carbon-950/70 hover:border-zinc-700'
                      }`}
                      style={{
                        boxShadow: isSelected
                          ? `0 0 18px ${option.glowRgba}`
                          : undefined,
                      }}
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
                      <span className="mt-1 font-mono text-[10px] text-zinc-300">
                        {option.id.toUpperCase()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                backgroundColor: colorHex,
                boxShadow: `0 0 24px ${colorHex}44`,
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-bold uppercase tracking-wider text-carbon-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Creating Profile...</span>
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  <span>Create INTVL 2.0 Account</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-border-subtle pt-4 text-center text-xs text-zinc-400">
            Already registered with the squad?{' '}
            <Link
              href="/login"
              className="font-semibold text-neon-cyan hover:underline"
            >
              Log in here
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
