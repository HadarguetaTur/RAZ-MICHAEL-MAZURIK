/**
 * Zero-dependency authentication module using Node.js built-in crypto.
 *
 * Provides:
 *  - JWT creation & verification (HMAC-SHA256)
 *  - Password hashing & verification (scrypt)
 *  - Request-level auth helper
 *  - In-memory user management (seeded from env vars)
 */

import crypto from 'node:crypto';
import http from 'node:http';

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      '[auth] JWT_SECRET environment variable is not set. ' +
        'Please set it to a long random string before starting the server.',
    );
  }
  if (secret.length < 48) {
    throw new Error('[auth] JWT_SECRET is too short. Use at least 48 random characters.');
  }
  return secret;
}

function getTokenEpoch(): number {
  const raw = (process.env.JWT_TOKEN_EPOCH || '0').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function sign(headerB64: string, payloadB64: string, secret: string): string {
  const data = `${headerB64}.${payloadB64}`;
  const hmac = crypto.createHmac('sha256', secret).update(data).digest();
  return hmac.toString('base64url');
}

/**
 * Create a signed JWT token.
 *
 * @param payload  – must contain `username` and `role`
 * @param expiresInSeconds – token lifetime in seconds (default 24 h)
 * @returns signed JWT string (header.payload.signature)
 */
export function createToken(
  payload: { username: string; role: string },
  expiresInSeconds = 86400,
): string {
  const secret = getJwtSecret();

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
    ver: getTokenEpoch(),
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const signature = sign(headerB64, payloadB64, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify a JWT token.
 *
 * @returns decoded payload or `null` if the token is invalid / expired
 */
export function verifyToken(
  token: string
): { username: string; role: string; iat: number; exp: number; ver?: number } | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(
      Buffer.from(headerB64, 'base64url').toString('utf8')
    ) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    // Recompute expected signature
    const expectedSig = sign(headerB64, payloadB64, secret);

    // Constant-time comparison (prevent timing attacks)
    const sigBuf = Buffer.from(signatureB64, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as { username: string; role: string; iat: number; exp: number; ver?: number };

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    if (typeof payload.iat !== 'number') return null;
    if (typeof payload.username !== 'string' || !payload.username) return null;
    if (typeof payload.role !== 'string' || !payload.role) return null;
    const requiredEpoch = getTokenEpoch();
    const tokenEpoch = typeof payload.ver === 'number' ? payload.ver : 0;
    if (tokenEpoch < requiredEpoch) return null;

    return payload;
  } catch (error) {
    console.warn(
      '[auth] verifyToken failed:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Password helpers (scrypt)
// ---------------------------------------------------------------------------

/**
 * Hash a plain-text password with a random salt.
 *
 * @returns `"salt:hash"` (both hex-encoded)
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verify a plain-text password against a stored `"salt:hash"` value.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const storedDerived = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, salt, 64);

    if (derived.length !== storedDerived.length) return false;
    return crypto.timingSafeEqual(derived, storedDerived);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request-level auth helper
// ---------------------------------------------------------------------------

export interface AuthUser {
  username: string;
  role: string;
}

/**
 * Extract and verify a Bearer JWT from the `Authorization` header.
 *
 * @returns the authenticated user or `null`
 */
export function getAuthFromRequest(req: http.IncomingMessage): AuthUser | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  return { username: payload.username, role: payload.role };
}

// ---------------------------------------------------------------------------
// User management (in-memory)
// ---------------------------------------------------------------------------

let users: Map<string, { passwordHash: string; role: string }> = new Map();

/**
 * Initialise the in-memory user store from environment variables.
 *
 * Must be called once at server startup.
 *
 * Reads:
 *  - `ADMIN_USERNAME` (default `"admin"`)
 *  - `ADMIN_PASSWORD` (required, plain text – hashed at startup)
 *
 * @throws if `ADMIN_PASSWORD` is not set
 */
export function initUsers(): void {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error(
      '[auth] ADMIN_PASSWORD environment variable is not set. ' +
        'Please set it before starting the server.',
    );
  }
  if (adminPassword.length < 12) {
    throw new Error('[auth] ADMIN_PASSWORD is too short. Use at least 12 characters.');
  }

  const passwordHash = hashPassword(adminPassword);
  users = new Map();
  users.set(adminUsername, { passwordHash, role: 'admin' });

  console.info(`[auth] User store initialised (${users.size} user(s))`);
}

/**
 * Validate a username/password pair against the in-memory store.
 *
 * @returns an `AuthUser` on success, or `null` on failure
 */
export function validateCredentials(
  username: string,
  password: string,
): AuthUser | null {
  const record = users.get(username);
  if (!record) return null;

  if (!verifyPassword(password, record.passwordHash)) return null;

  return { username, role: record.role };
}
