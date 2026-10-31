export const runtime = 'edge';

/**
 * Alias route for `GET /api/user/settings` and `PATCH /api/user/settings`
 * so the Settings modal and Automatic Activity Sync toggle can save directly to `/api/user/settings`.
 */
export { GET, PATCH } from '@/app/api/auth/me/route';
