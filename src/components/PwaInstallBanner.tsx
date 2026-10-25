'use client';

import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface PwaInstallBannerProps {
  variant?: 'floating' | 'card';
}

export default function PwaInstallBanner({
  variant = 'card',
}: PwaInstallBannerProps) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));

    if (window.localStorage.getItem('intvl2_pwa_banner_dismissed') === '1') {
      setDismissed(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return;
    }
    setShowInstructions((prev) => !prev);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem('intvl2_pwa_banner_dismissed', '1');
    } catch {
      // Ignore storage error
    }
  };

  if (isStandalone) {
    if (variant === 'floating') return null;
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-neon-lime/30 bg-neon-lime/10 p-3.5">
        <div className="flex items-center gap-2.5">
          <Smartphone className="h-4 w-4 text-neon-lime" />
          <div>
            <p className="text-xs font-bold text-white">
              INTVL 2.0 Standalone App Active
            </p>
            <p className="font-mono text-[10px] text-zinc-300">
              Running in full-screen native display mode
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'floating' && dismissed) {
    return null;
  }

  return (
    <div
      className={
        variant === 'floating'
          ? 'rounded-2xl border border-neon-cyan/40 bg-carbon-900/95 p-3 shadow-glass backdrop-blur-2xl'
          : 'rounded-2xl border border-border-subtle bg-carbon-950/80 p-4'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white">
              Add INTVL 2.0 to Home Screen
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Install as a standalone full-screen app without browser bars.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex min-h-[48px] items-center gap-1.5 rounded-xl border border-neon-cyan/50 bg-neon-cyan/15 px-3.5 py-2 font-mono text-xs font-bold text-neon-cyan transition hover:bg-neon-cyan/25"
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {deferredPrompt ? 'Install App' : 'Add to Home Screen'}
            </span>
          </button>

          {variant === 'floating' && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss Install Prompt"
              className="flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-border-subtle bg-carbon-950 text-zinc-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {showInstructions && (
        <div className="mt-3 rounded-xl border border-border-subtle bg-carbon-900/90 p-3 text-xs text-zinc-300">
          {isIos ? (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 font-semibold text-white">
                <Share className="h-3.5 w-3.5 text-neon-cyan" />
                <span>iOS Safari Installation:</span>
              </p>
              <ol className="list-inside list-decimal space-y-1 text-[11px] text-zinc-300">
                <li>
                  Tap the <strong>Share</strong> icon in the bottom Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Launch <strong>INTVL 2.0</strong> from your home screen for full-screen standalone gameplay.
                </li>
              </ol>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="font-semibold text-white">
                Android / Chrome Installation:
              </p>
              <ol className="list-inside list-decimal space-y-1 text-[11px] text-zinc-300">
                <li>
                  Tap the <strong>⋮ Browser Menu</strong> in the top-right corner of Chrome.
                </li>
                <li>
                  Select <strong>Add to Home screen</strong> or <strong>Install app</strong>.
                </li>
                <li>
                  Open <strong>INTVL 2.0</strong> from your home screen for full-screen standalone mode.
                </li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
