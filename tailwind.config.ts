import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        carbon: {
          950: '#09090b',
          900: '#0f1117',
          850: '#141720',
          800: '#18181b',
        },
        border: {
          subtle: '#27272a',
          active: '#3f3f46',
        },
        neon: {
          cyan: '#00f0ff',
          lime: '#22c55e',
          magenta: '#ec4899',
          amber: '#f59e0b',
          purple: '#a855f7',
        },
        strava: {
          orange: '#FC4C02',
          hover: '#E34402',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glass': '0 20px 50px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        'neon-cyan': '0 0 20px rgba(0, 240, 255, 0.35)',
        'neon-lime': '0 0 20px rgba(34, 197, 94, 0.35)',
        'neon-magenta': '0 0 20px rgba(236, 72, 153, 0.35)',
        'neon-amber': '0 0 20px rgba(245, 158, 11, 0.35)',
        'neon-purple': '0 0 20px rgba(168, 85, 247, 0.35)',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.65', transform: 'scale(1.03)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
      animation: {
        'pulse-glow': 'pulseGlow 2.8s ease-in-out infinite',
        'scanline': 'scanline 4s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
