/**
 * Unified API server: /api/conflicts/check and /api/inbox/*.
 * Run: npx tsx server/apiServer.ts
 * Env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID; AIRTABLE_ADMIN_INBOX_TABLE for inbox.
 * Inbox proxy: add in vite.config proxy /api/inbox -> http://localhost:3001
 */

import http from 'node:http';
import { checkConflicts } from './services/conflictsCheckService';
import type {
  CheckConflictsParams,
  ConflictsCheckFetchers,
  LessonLike,
  OpenSlotLike,
} from './services/conflictsCheckService';
import { getTableId, getField } from './contracts/fieldMap';
import {
  handleGetInbox,
  handlePostInbox,
  handlePatchInbox,
  handlePostInboxIdAction,
} from './inbox/routes';

const API_BASE = 'https://api.airtable.com/v0';
const CANCELLED_STATUS = 'בוטל';

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

  let formula = `AND({${statusF}} != "${escapeFormula(CANCELLED_STATUS)}", IS_AFTER({${startDtF}}, "${escapeFormula(startDate)}"), IS_BEFORE({${endDtF}}, "${escapeFormula(endDate)}"))`;
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

  let formula = `AND({${startDtF}} < "${escapeFormula(endISO)}", {${endDtF}} > "${escapeFormula(startISO)}", {${statusF}} = "open")`;
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

const PORT = Number(process.env.CONFLICTS_CHECK_PORT ?? process.env.INBOX_API_PORT ?? '3001');

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '';

  // --- Inbox: /api/inbox* ---
  if (url.startsWith('/api/inbox')) {
    let handled = false;
    if (req.method === 'GET') {
      handled = await handleGetInbox(req, res, url);
    }
    if (!handled && req.method === 'POST') {
      handled = await handlePostInboxIdAction(req, res, url);
      if (!handled) handled = await handlePostInbox(req, res, url);
    }
    if (!handled && req.method === 'PATCH') {
      handled = await handlePatchInbox(req, res, url);
    }
    if (handled) return;
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
      console.error('[apiServer] conflicts', { entity: params?.entity, date: params?.date });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: msg }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.info(`[apiServer] http://localhost:${PORT}`);
  console.info(`  POST /api/conflicts/check`);
  console.info(`  GET/POST/PATCH /api/inbox, POST /api/inbox/:id/close, POST /api/inbox/:id/snooze`);
});
