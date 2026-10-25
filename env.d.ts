import type { D1Database } from '@cloudflare/workers-types';

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    NEXT_PUBLIC_APP_URL?: string;
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
    STRAVA_VERIFY_TOKEN?: string;
    SESSION_SECRET?: string;
  }

  namespace NodeJS {
    interface ProcessEnv {
      DB?: unknown;
      NEXT_PUBLIC_APP_URL?: string;
      STRAVA_CLIENT_ID?: string;
      STRAVA_CLIENT_SECRET?: string;
      STRAVA_VERIFY_TOKEN?: string;
      SESSION_SECRET?: string;
      LOCAL_SQLITE_PATH?: string;
    }
  }
}

export {};
