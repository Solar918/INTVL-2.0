export const runtime = 'edge';

/**
 * /api/user/profile — alias of /api/auth/me (GET to read, PATCH to update
 * display name, bio, color, and the personal Home Area).
 */
export { GET, PATCH } from '@/app/api/auth/me/route';
