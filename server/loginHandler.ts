/**
 * Login endpoint handler.
 *
 * POST /api/login  →  { username, password }  →  { token, user }
 *
 * Includes per-IP rate limiting (5 failed attempts per 15-minute window → 429).
 * Zero external dependencies.
 */

import http from 'node:http';
import { validateCredentials, createToken } from './auth';
import {
  assertJsonContentType,
  getTrustedClientIp,
  readJsonBodyWithLimit,
} from './httpSecurity';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per IP)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** Timestamps (ms) of recent failed attempts. */
  failures: number[];
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_FAILURES = 5;

/** IP → rate-limit state */
const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Periodically purge stale rate-limit entries so the map doesn't grow
 * unboundedly in long-running servers.
 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    entry.failures = entry.failures.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );
    if (entry.failures.length === 0) {
      rateLimitMap.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS).unref(); // unref so the timer doesn't keep the process alive

/**
 * Check whether the IP has exceeded the allowed number of failed login
 * attempts within the current window.
 */
function isRateLimited(ip: string): boolean {
  const entry = rateLimitMap.get(ip);
  if (!entry) return false;

  const now = Date.now();
  // Keep only failures inside the window
  entry.failures = entry.failures.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
  );

  return entry.failures.length >= RATE_LIMIT_MAX_FAILURES;
}

/** Record a failed login attempt for the given IP. */
function recordFailure(ip: string): void {
  let entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { failures: [] };
    rateLimitMap.set(ip, entry);
  }
  entry.failures.push(Date.now());
}

/** Clear failure history for an IP on successful login. */
function clearFailures(ip: string): void {
  rateLimitMap.delete(ip);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle the `/api/login` endpoint.
 */
export async function handleLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // 1. Only POST allowed
  if (req.method !== 'POST') {
    res.writeHead(405, {
      Allow: 'POST',
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // 2. Rate-limit check
  const ip = getTrustedClientIp(req);
  if (isRateLimited(ip)) {
    console.warn(`[auth] RATE_LIMITED ip=${ip}`);
    jsonResponse(res, 429, {
      error: 'Too many failed login attempts. Please try again later.',
    });
    return;
  }

  // 3. Parse body
  let body: { username?: string; password?: string };
  try {
    if (!assertJsonContentType(req)) {
      jsonResponse(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    body = await readJsonBodyWithLimit(req);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid or oversized JSON body' });
    return;
  }

  const { username, password } = body;

  // 4. Validate required fields
  if (!username || !password) {
    jsonResponse(res, 400, {
      error: 'Missing required fields: username and password',
    });
    return;
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    jsonResponse(res, 400, { error: 'username/password must be strings' });
    return;
  }
  if (username.length > 128 || password.length > 1024) {
    jsonResponse(res, 400, { error: 'username/password exceed maximum length' });
    return;
  }

  // 5. Authenticate
  const user = validateCredentials(username, password);

  if (!user) {
    recordFailure(ip);
    console.warn(`[auth] LOGIN_FAILED ip=${ip} username=${username.slice(0, 20)}`);
    jsonResponse(res, 401, { error: 'Invalid username or password' });
    return;
  }

  // 6. Success – issue token and clear rate-limit history
  clearFailures(ip);
  console.info(`[auth] LOGIN_OK ip=${ip} username=${user.username}`);

  const token = createToken({ username: user.username, role: user.role });
  jsonResponse(res, 200, {
    token,
    user: { username: user.username, role: user.role },
  });
}
