'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Lock,
  LogIn,
  ShieldAlert,
  User,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          password,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Invalid credentials.');
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-carbon-950 p-4">
      <div
        className="pointer-events-none fixed inset-0 opacity-20"
        style={{
          background:
            'radial-gradient(circle at 50% 25%, rgba(0, 240, 255, 0.25) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-border-subtle bg-carbon-900/95 shadow-glass backdrop-blur-2xl">
        <div className="h-1.5 w-full bg-gradient-to-r from-neon-cyan via-neon-lime to-neon-cyan" />

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

          {/* INTVL 2.0 Logo & Heading */}
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
              Sign in to access your Auckland territory command center and sync Strava runs.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Username
              </label>
              <div className="relative mt-1.5">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  autoComplete="username"
                  className="w-full rounded-xl border border-border-subtle bg-carbon-950 py-3 pl-10 pr-4 font-mono text-sm text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Password
              </label>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-border-subtle bg-carbon-950 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-neon-cyan"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-neon-cyan px-5 py-3.5 text-sm font-bold uppercase tracking-wider text-carbon-950 shadow-neon-cyan transition hover:brightness-110 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  <span>Log In to INTVL 2.0</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-border-subtle pt-4 text-center text-xs text-zinc-400">
            New to the Auckland squad?{' '}
            <Link
              href="/register"
              className="font-semibold text-neon-lime hover:underline"
            >
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
