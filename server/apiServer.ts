/**
 * API server for conflicts checking: /api/conflicts/check
 * Run: npx tsx server/apiServer.ts
 * Env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, PORT (for cloud platforms)
 * 
 * Production deployment:
 * - Render/Railway will set PORT automatically
 * - Set ALLOWED_ORIGINS env var for CORS (comma-separated list)
 */

import http from 'node:http';
import { checkConflicts } from '../services/conflictsCheckService';
import type {
  CheckConflictsParams,
  ConflictsCheckFetchers,
  LessonLike,
  OpenSlotLike,
} from '../services/conflictsCheckService';
import { getTableId, getField } from '../contracts/fieldMap';

const API_BASE = 'https://api.airtable.com/v0';
const CANCELLED_STATUS = 'בוטל';
const PENDING_CANCEL_STATUS = 'ממתין לאישור ביטול';

// CORS configuration - add your production domains here or via ALLOWED_ORIGINS env var
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    return [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins.split(',').map(o => o.trim())];
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = req.headers.origin || '';
  const allowedOrigins = getAllowedOrigins();
  
  // Allow if origin matches or if no origin (same-origin request)
  if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    return true;
  }
  return false;
}

function env(name: string): string {
  const v =
    process.env[name] ?? process.env[name.replace('AIRTABLE_', 'VITE_AIRTABLE_')] ?? '';
  return String(v).trim();
}

function escapeFormula(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function airtableGet(
  baseId: string,
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<{ records: Array<{ id: string; fields: Record<string, unknown> }> }> {
  const url = new URL(`${API_BASE}/${baseId}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Airtable ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function getLessonsForConflicts(
  baseId: string,
  token: string,
  startDate: string,
  endDate: string,
  teacherId?: string
): Promise<LessonLike[]> {
  const tableId = getTableId('lessons');
  const statusF = getField('lessons', 'status');
  const startDtF = getField('lessons', 'start_datetime');
  const endDtF = getField('lessons', 'end_datetime');
  const teacherF = getField('lessons', 'teacher_id');
  const studentF = getField('lessons', 'full_name');

  // Exclude cancelled lessons: 'בוטל' (CANCELLED) and 'ממתין לאישור ביטול' (PENDING_CANCEL)
  let formula = `AND({${statusF}} != "${escapeFormula(CANCELLED_STATUS)}", {${statusF}} != "${escapeFormula(PENDING_CANCEL_STATUS)}", IS_AFTER({${startDtF}}, "${escapeFormula(startDate)}"), IS_BEFORE({${endDtF}}, "${escapeFormula(endDate)}"))`;
  if (teacherId && teacherId.startsWith('rec')) {
    formula = `AND(${formula}, FIND("${escapeFormula(teacherId)}", ARRAYJOIN({${teacherF}})) > 0)`;
  }
  const params: Record<string, string> = {
    filterByFormula: formula,
    pageSize: '100',
    [`sort[0][field]`]: startDtF,
    [`sort[0][direction]`]: 'asc',
  };
  const data = await airtableGet(baseId, token, `/${tableId}`, params);
  const list: LessonLike[] = [];
  for (const r of data.records ?? []) {
    const f = r.fields ?? {};
    const startDt = (f[startDtF] as string) ?? '';
    const endDt = (f[endDtF] as string) ?? '';
    if (!startDt) continue;
    const startDateStr = startDt.includes('T') ? startDt.slice(0, 10) : startDt;
    const startTimeStr = startDt.includes('T') ? startDt.slice(11, 19) : '00:00:00';
    const startTime = startTimeStr.slice(0, 5);
    const duration =
      endDt && startDt
        ? Math.round((new Date(endDt).getTime() - new Date(startDt).getTime()) / 60000)
        : 60;
    let studentName = 'שיעור';
    const sf = f[studentF];
    if (Array.isArray(sf) && sf[0] && typeof sf[0] === 'object' && (sf[0] as { name?: string }).name) {
      studentName = (sf[0] as { name: string }).name;
    } else if (typeof sf === 'string') studentName = sf;
    list.push({
      id: r.id,
      date: startDateStr,
      startTime,
      duration,
      studentName,
      status: (f[statusF] as string) ?? '',
      teacherId,
    });
  }
  return list;
}

async function getOpenSlotsForConflicts(
  baseId: string,
  token: string,
  startISO: string,
  endISO: string,
  teacherId?: string
): Promise<OpenSlotLike[]> {
  const tableId = getTableId('slotInventory');
  const startDtF = getField('slotInventory', 'StartDT');
  const endDtF = getField('slotInventory', 'EndDT');
  const statusF = getField('slotInventory', 'סטטוס');
  const teacherF = getField('slotInventory', 'מורה');

  // Only include open slots: 'open' (English) or 'פתוח' (Hebrew)
  let formula = `AND({${startDtF}} < "${escapeFormula(endISO)}", {${endDtF}} > "${escapeFormula(startISO)}", OR({${statusF}} = "open", {${statusF}} = "פתוח"))`;
  if (teacherId && teacherId.startsWith('rec')) {
    formula = `AND(${formula}, FIND("${escapeFormula(teacherId)}", ARRAYJOIN({${teacherF}})) > 0)`;
  }
  const params: Record<string, string> = {
    filterByFormula: formula,
    pageSize: '100',
  };
  const data = await airtableGet(baseId, token, `/${tableId}`, params);
  const list: OpenSlotLike[] = [];
  for (const r of data.records ?? []) {
    const f = r.fields ?? {};
    const startDateTime = (f[startDtF] as string) ?? '';
    const endDateTime = (f[endDtF] as string) ?? '';
    if (!startDateTime || !endDateTime) continue;
    const tv = f[teacherF];
    const tid = Array.isArray(tv)
      ? typeof tv[0] === 'string'
        ? tv[0]
        : (tv[0] as { id?: string })?.id
      : typeof tv === 'string'
        ? tv
        : (tv as { id?: string })?.id;
    list.push({
      id: r.id,
      startDateTime,
      endDateTime,
      teacherId: typeof tid === 'string' ? tid : undefined,
    });
  }
  return list;
}

// PORT: Use PORT (cloud platforms like Render/Railway) or CONFLICTS_CHECK_PORT or default 3001
const PORT = Number(process.env.PORT ?? process.env.CONFLICTS_CHECK_PORT ?? '3001');

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '';

  // Set CORS headers for all requests
  setCorsHeaders(req, res);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint for monitoring
  if (req.method === 'GET' && (url === '/health' || url === '/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // --- Conflicts: POST /api/conflicts/check ---
  if (req.method === 'POST' && url === '/api/conflicts/check') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let params: CheckConflictsParams;
    try {
      params = JSON.parse(body || '{}') as CheckConflictsParams;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
    
    // Validate required fields
    if (!params.entity || (params.entity !== 'lesson' && params.entity !== 'slot_inventory')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid entity. Must be "lesson" or "slot_inventory"' }));
      return;
    }
    if (!params.teacherId || !params.date || !params.start || !params.end) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: teacherId, date, start, end' }));
      return;
    }
    
    const baseId = env('AIRTABLE_BASE_ID') || env('VITE_AIRTABLE_BASE_ID');
    const token = env('AIRTABLE_API_KEY') || env('VITE_AIRTABLE_API_KEY');
    if (!baseId || !token) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'שגיאה בבדיקת חפיפות. נסה שוב.' }));
      return;
    }
    const fetchers: ConflictsCheckFetchers = {
      getLessons: (s, e, t) => getLessonsForConflicts(baseId, token, s, e, t),
      getOpenSlots: (si, ei, t) => getOpenSlotsForConflicts(baseId, token, si, ei, t),
    };
    try {
      const result = await checkConflicts(params, fetchers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בבדיקת חפיפות. נסה שוב.';
      console.error('[apiServer] conflicts error', { 
        entity: params?.entity, 
        date: params?.date,
        teacherId: typeof params?.teacherId === 'string' ? params.teacherId.slice(0, 6) + '…' : params?.teacherId
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: msg }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.info(`[apiServer] Server running on port ${PORT}`);
  console.info(`  GET  /health - Health check`);
  console.info(`  POST /api/conflicts/check - Conflicts checking`);
  if (process.env.ALLOWED_ORIGINS) {
    console.info(`  CORS origins: ${process.env.ALLOWED_ORIGINS}`);
  }
});
