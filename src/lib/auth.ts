export const SESSION_COOKIE_NAME = 'intvl_session';
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTE_LENGTH = 16;
const KEY_BIT_LENGTH = 256;

export interface SessionPayload {
  userId: string;
  username: string;
  issuedAt: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Hashes a plaintext password using Web Crypto API PBKDF2-SHA256 (`crypto.subtle.deriveBits`).
 * Executes natively on Cloudflare Pages/Workers Edge runtime and Node.js.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(SALT_BYTE_LENGTH);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BIT_LENGTH
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

/**
 * Verifies a plaintext password against a stored PBKDF2-SHA256 password hash.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];

    if (!Number.isFinite(iterations) || iterations < 1000 || !saltHex || !expectedHashHex) {
      return false;
    }

    const encoder = new TextEncoder();
    const salt = hexToBytes(saltHex);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      KEY_BIT_LENGTH
    );

    const candidateHashHex = bytesToHex(new Uint8Array(derivedBits));
    return timingSafeEqualHex(candidateHashHex, expectedHashHex);
  } catch {
    return false;
  }
}

/**
 * Encodes and signs an HTTP-only session cookie payload using Web Crypto HMAC-SHA256.
 */
export async function encodeSessionCookie(
  userId: string,
  username: string
): Promise<string> {
  const payload: SessionPayload = {
    userId,
    username,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const payloadBase64 = btoa(JSON.stringify(payload));
  const signature = await computeHmacHex(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies and decodes the session token from an HTTP-only cookie value.
 */
export async function decodeSessionCookie(
  cookieValue?: string | null
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const expectedSig = await computeHmacHex(payloadBase64);
  if (!timingSafeEqualHex(signature, expectedSig)) return null;

  try {
    const decoded = JSON.parse(atob(payloadBase64)) as SessionPayload;
    if (typeof decoded.userId === 'string' && decoded.userId.length > 0) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

async function computeHmacHex(message: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || 'intvl-2-default-edge-hmac-key-2025';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(new Uint8Array(sigBuffer));
}
