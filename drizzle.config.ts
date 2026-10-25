import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.LOCAL_SQLITE_PATH || './.local-intvl2.sqlite',
  },
  verbose: true,
  strict: true,
} satisfies Config;
