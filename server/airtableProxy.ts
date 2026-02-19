/**
 * Airtable proxy – forwards authenticated requests to the Airtable REST API
 * so the API key never leaves the server.
 *
 * Route pattern:  /api/airtable/<tableIdOrName>[/<recordId>][?queryString]
 *
 * Uses Node.js native `fetch` (Node 18+). Zero external dependencies.
 */

import http from 'node:http';
import { getAuthFromRequest } from './auth';
import { getTableId } from '../contracts/fieldMap';

// ---------------------------------------------------------------------------
// Airtable configuration (server-side only, read lazily so env loader runs first)
// ---------------------------------------------------------------------------

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const MAX_BODY_BYTES = 1024 * 1024; // 1MB
const AIRTABLE_TIMEOUT_MS = 10000;
const TABLE_ID_RE = /^tbl[a-zA-Z0-9]{14}$/;
const RECORD_ID_RE = /^rec[a-zA-Z0-9]{14}$/;
const ALLOWED_TABLES = new Set<string>([
  getTableId('students'),
  getTableId('lessons'),
  getTableId('teachers'),
  getTableId('homework'),
  getTableId('homeworkAssignments'),
  getTableId('subscriptions'),
  getTableId('cancellations'),
  getTableId('monthlyBills'),
  getTableId('weeklySlot'),
  getTableId('slotInventory'),
  getTableId('entities'),
  getTableId('studentGroups'),
]);

function getAirtableApiKey(): string {
  return process.env.AIRTABLE_API_KEY || '';
}

function getAirtableBaseId(): string {
  return process.env.AIRTABLE_BASE_ID || '';
}

const isDev =
  !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the full body of an incoming request as a UTF-8 string. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parsePathParts(pathAndQuery: string): { tableId: string; recordId?: string; queryString: string } | null {
  const questionIdx = pathAndQuery.indexOf('?');
  const airtablePath = questionIdx >= 0 ? pathAndQuery.slice(0, questionIdx) : pathAndQuery;
  const queryString = questionIdx >= 0 ? pathAndQuery.slice(questionIdx) : '';
  const decodedPath = airtablePath
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part.trim()));
  if (decodedPath.length === 0 || decodedPath.length > 2) return null;
  const tableId = decodedPath[0];
  const recordId = decodedPath[1];
  if (!TABLE_ID_RE.test(tableId)) return null;
  if (recordId && !RECORD_ID_RE.test(recordId)) return null;
  if (!ALLOWED_TABLES.has(tableId)) return null;
  return { tableId, recordId, queryString };
}

function isMethodAllowed(method: string, hasRecordId: boolean): boolean {
  if (method === 'GET') return true;
  if (method === 'POST') return !hasRecordId;
  if (method === 'PATCH' || method === 'PUT') return hasRecordId;
  if (method === 'DELETE') return true;
  return false;
}

/** Send a JSON response. */
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
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming request destined for the Airtable proxy.
 *
 * @param req     – Node.js incoming request
 * @param res     – Node.js server response
 * @param urlPath – the full URL path, e.g. `"/api/airtable/tblXXX?filterByFormula=..."`
 */
export async function handleAirtableProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
): Promise<void> {
  // 1. Auth check – every request must carry a valid JWT
  const user = getAuthFromRequest(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Unauthorized – valid JWT required' });
    return;
  }

  // 2. Validate server-side Airtable configuration (read lazily)
  const AIRTABLE_API_KEY = getAirtableApiKey();
  const AIRTABLE_BASE_ID = getAirtableBaseId();
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    console.error(
      '[AirtableProxy] Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID env vars',
    );
    jsonResponse(res, 500, {
      error: 'Airtable is not configured on the server',
    });
    return;
  }

  // 3. Extract the Airtable sub-path and query string
  //    urlPath looks like: /api/airtable/tblXXX/recYYY?foo=bar
  const prefixLength = '/api/airtable/'.length;
  const pathAndQuery = urlPath.slice(prefixLength); // "tblXXX/recYYY?foo=bar"

  const parsed = parsePathParts(pathAndQuery);
  if (!parsed) {
    if (isDev) console.warn(`[AirtableProxy] Rejected path: ${pathAndQuery}`);
    jsonResponse(res, 400, { error: 'Invalid or disallowed Airtable table path' });
    return;
  }
  const { tableId, recordId, queryString } = parsed;
  const airtablePath = recordId ? `${tableId}/${recordId}` : tableId;

  // 4. Build the upstream Airtable URL
  const airtableUrl = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${airtablePath}${queryString}`;

  // 5. Read request body for write methods
  const method = (req.method || 'GET').toUpperCase();
  if (!isMethodAllowed(method, Boolean(recordId))) {
    jsonResponse(res, 405, { error: 'Method not allowed for this resource path' });
    return;
  }
  let body: string | undefined;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    try {
      body = await readBody(req);
    } catch (error) {
      if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
        jsonResponse(res, 413, { error: 'Request body too large (max 1MB)' });
        return;
      }
      throw error;
    }
  }

  if (isDev) {
    console.info(`[AirtableProxy] ${method} /${airtablePath}${queryString}`);
  }

  // 6. Forward request to Airtable
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AIRTABLE_TIMEOUT_MS);
    let airtableRes: Response;
    try {
      const fetchOptions: RequestInit = {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      };

      if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        fetchOptions.body = body;
      }

      airtableRes = await fetch(airtableUrl, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }

    // 7. Relay status + body back to the client
    const responseBody = await airtableRes.text();

    // Forward relevant headers from Airtable
    const responseHeaders: Record<string, string> = {
      'Content-Type': airtableRes.headers.get('content-type') || 'application/json',
    };

    res.writeHead(airtableRes.status, responseHeaders);
    res.end(responseBody);
  } catch (err) {
    // Never leak the Airtable API key in error messages
    if (err instanceof Error && err.name === 'AbortError') {
      jsonResponse(res, 504, {
        error: 'Airtable request timed out',
      });
      return;
    }
    const message =
      err instanceof Error ? err.message : 'Unknown error contacting Airtable';
    console.error('[AirtableProxy] Upstream error:', message);
    jsonResponse(res, 502, {
      error: 'Failed to reach Airtable API',
    });
  }
}
