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

/**
 * Fetch all records from Airtable with pagination
 */
async function listAllAirtableRecords<TFields>(
  baseId: string,
  token: string,
  tableId: string,
  params: Record<string, string | undefined> = {}
): Promise<Array<{ id: string; fields: TFields }>> {
  const allRecords: Array<{ id: string; fields: TFields }> = [];
  let offset: string | undefined;

  do {
    const queryParams: Record<string, string> = {};
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        queryParams[key] = value;
      }
    });
    if (offset) {
      queryParams.offset = offset;
    }

    const data = await airtableGet(baseId, token, `/${tableId}`, queryParams);
    allRecords.push(...(data.records as Array<{ id: string; fields: TFields }>));
    offset = (data as { offset?: string }).offset;
  } while (offset);

  return allRecords;
}

/**
 * Get teachers map (id -> name) for slot inventory
 */
async function getTeachersMap(baseId: string, token: string): Promise<Map<string, string>> {
  const teachersTableId = getTableId('teachers');
  const teacherIdField = getField('teachers', 'teacher_id');
  const fullNameField = getField('teachers', 'full_name');
  
  const data = await airtableGet(baseId, token, `/${teachersTableId}`, { pageSize: '100' });
  const map = new Map<string, string>();
  
  for (const record of data.records ?? []) {
    const fields = record.fields ?? {};
    const teacherId = fields[teacherIdField];
    const name = fields[fullNameField];
    if (teacherId && name && typeof name === 'string') {
      const id = typeof teacherId === 'string' ? teacherId : String(teacherId);
      map.set(id, name);
    }
    // Also map by record ID
    if (name && typeof name === 'string') {
      map.set(record.id, name);
    }
  }
  
  return map;
}

/**
 * Get slot inventory with full deduplication logic (same as frontend)
 */
async function getSlotInventoryForAPI(
  baseId: string,
  token: string,
  start: string,
  end: string,
  teacherId?: string
): Promise<any[]> {
  const tableId = getTableId('slotInventory');
  const teachersMap = await getTeachersMap(baseId, token);
  const dateField = getField('slotInventory', 'תאריך_שיעור');
  const teacherIdField = getField('slotInventory', 'מורה');
  const startTimeField = getField('slotInventory', 'שעת_התחלה');
  
  // Build filter formula
  const startDate = start.split('T')[0];
  const endDate = end.split('T')[0];
  let filterFormula = `AND({${dateField}} >= "${startDate}", {${dateField}} <= "${endDate}")`;
  
  if (teacherId) {
    const escapedTeacherId = escapeFormula(teacherId);
    filterFormula = `AND(${filterFormula}, FIND("${escapedTeacherId}", ARRAYJOIN({${teacherIdField}})) > 0)`;
  }
  
  // Fetch all records with pagination
  const params: Record<string, string | undefined> = {
    filterByFormula: filterFormula,
    pageSize: '100',
    'sort[0][field]': dateField,
    'sort[0][direction]': 'asc',
    'sort[1][field]': startTimeField,
    'sort[1][direction]': 'asc',
  };
  const records = await listAllAirtableRecords(baseId, token, tableId, params);
  
  // Map records to SlotInventory format
  const mappedInventory = records.map(record => {
    const fields = record.fields || {};
    
    // Extract teacher ID
    const teacherIdValue = fields[teacherIdField];
    let extractedTeacherId = Array.isArray(teacherIdValue) 
      ? (typeof teacherIdValue[0] === 'string' ? teacherIdValue[0] : teacherIdValue[0]?.id || '')
      : (typeof teacherIdValue === 'string' ? teacherIdValue : teacherIdValue?.id || '');
    
    // Extract source weekly slot
    const sourceField = getField('slotInventory', 'נוצר_מתוך');
    const sourceValue = fields[sourceField];
    const sourceWeeklySlot = sourceValue
      ? (Array.isArray(sourceValue) 
          ? (typeof sourceValue[0] === 'string' ? sourceValue[0] : sourceValue[0]?.id || undefined)
          : (typeof sourceValue === 'string' ? sourceValue : sourceValue?.id || undefined))
      : undefined;
    
    // Map status (Hebrew ↔ English)
    const statusField = getField('slotInventory', 'סטטוס');
    const rawStatusValue = fields[statusField] || 'open';
    const statusValue = typeof rawStatusValue === 'string' ? rawStatusValue.trim() : String(rawStatusValue).trim();
    const status = (
      statusValue === 'פתוח' || statusValue === 'open'
        ? 'open'
        : statusValue === 'סגור' || statusValue === 'closed' || statusValue === 'booked'
        ? 'closed'
        : statusValue === 'חסום ע"י מנהל' || statusValue === 'חסום' || statusValue === 'blocked'
        ? 'blocked'
        : statusValue === 'מבוטל' || statusValue === 'canceled'
        ? 'canceled'
        : 'open'
    ) as 'open' | 'closed' | 'canceled' | 'blocked';
    
    const occupied = (fields[getField('slotInventory', 'תפוסה_נוכחית' as any)] as number) || 0;
    const capacity = (fields[getField('slotInventory', 'קיבולת_כוללת' as any)] as number) || 1;
    
    // Extract student IDs
    const studentField = getField('slotInventory', 'תלמידים' as any);
    const studentVal = fields[studentField];
    let studentIds: string[] = [];
    if (Array.isArray(studentVal)) {
      studentIds = studentVal.map((s: any) => typeof s === 'string' ? s : s.id).filter(Boolean);
    }
    
    // Extract lesson IDs
    const lessonsField = getField('slotInventory', 'lessons');
    const lessonsVal = fields[lessonsField] || fields.lessons;
    let lessonIds: string[] = [];
    if (Array.isArray(lessonsVal)) {
      lessonIds = lessonsVal.map((l: any) => typeof l === 'string' ? l : l.id).filter(Boolean);
    } else if (lessonsVal) {
      lessonIds = [typeof lessonsVal === 'string' ? lessonsVal : lessonsVal.id].filter(Boolean);
    }
    
    return {
      id: record.id,
      naturalKey: fields.natural_key || '',
      teacherId: extractedTeacherId || '',
      teacherName: teachersMap.get(extractedTeacherId || '') || '',
      lessonDate: fields[dateField] || '',
      date: fields[dateField] || '',
      startTime: fields[startTimeField] || '',
      endTime: fields[getField('slotInventory', 'שעת_סיום')] || '',
      lessonType: fields[getField('slotInventory', 'סוג_שיעור')],
      sourceWeeklySlot: sourceWeeklySlot,
      status: status,
      occupied,
      capacityOptional: capacity,
      students: studentIds,
      lessons: lessonIds,
      dayOfWeek: fields.day_of_week,
      startDT: fields.StartDT,
      endDT: fields.EndDT,
      isFull: fields.is_full === true || fields.is_full === 1,
      isBlock: fields.is_block === true || fields.is_block === 1,
      isLocked: fields.is_locked === true || fields.is_locked === 1,
    };
  });
  
  // Deduplication logic (same as frontend)
  const statusPriority: Record<string, number> = {
    'blocked': 4,
    'closed': 3,
    'open': 2,
    'canceled': 1,
  };
  
  const getDedupeKey = (slot: any): string => {
    if (slot.naturalKey && slot.naturalKey.trim() !== '') {
      return `natural_key:${slot.naturalKey}`;
    }
    const teacherId = slot.teacherId || 'none';
    return `composite:${slot.date}|${slot.startTime}|${slot.endTime}|${teacherId}`;
  };
  
  const selectWinner = (slot1: any, slot2: any): any => {
    const priority1 = statusPriority[slot1.status] || 0;
    const priority2 = statusPriority[slot2.status] || 0;
    if (priority1 !== priority2) {
      return priority1 > priority2 ? slot1 : slot2;
    }
    
    const hasLinks1 = (slot1.lessons && slot1.lessons.length > 0) || (slot1.students && slot1.students.length > 0);
    const hasLinks2 = (slot2.lessons && slot2.lessons.length > 0) || (slot2.students && slot2.students.length > 0);
    if (hasLinks1 !== hasLinks2) {
      return hasLinks1 ? slot1 : slot2;
    }
    
    return slot1.id > slot2.id ? slot1 : slot2;
  };
  
  // Dedupe by key
  const dedupeMap = new Map<string, any>();
  for (const slot of mappedInventory) {
    const key = getDedupeKey(slot);
    const existing = dedupeMap.get(key);
    
    if (!existing) {
      dedupeMap.set(key, slot);
    } else {
      const winner = selectWinner(existing, slot);
      dedupeMap.set(key, winner);
    }
  }
  
  const deduplicatedInventory = Array.from(dedupeMap.values());
  
  // Sort by date, then startTime
  deduplicatedInventory.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });
  
  return deduplicatedInventory;
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

  // --- Slot Inventory: GET /api/slot-inventory ---
  if (req.method === 'GET' && url.startsWith('/api/slot-inventory')) {
    const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const start = parsedUrl.searchParams.get('start');
    const end = parsedUrl.searchParams.get('end');
    const teacherId = parsedUrl.searchParams.get('teacherId') || undefined;
    
    if (!start || !end) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required query params: start, end' }));
      return;
    }
    
    const baseId = env('AIRTABLE_BASE_ID') || env('VITE_AIRTABLE_BASE_ID');
    const token = env('AIRTABLE_API_KEY') || env('VITE_AIRTABLE_API_KEY');
    if (!baseId || !token) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Airtable credentials not configured' }));
      return;
    }
    
    try {
      const slotInventory = await getSlotInventoryForAPI(baseId, token, start, end, teacherId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(slotInventory));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch slot inventory';
      console.error('[apiServer] slot-inventory error', { start, end, teacherId: teacherId?.slice(0, 6) + '…' });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
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
  console.info(`  GET  /api/slot-inventory - Slot inventory (with deduplication)`);
  console.info(`  POST /api/conflicts/check - Conflicts checking`);
  if (process.env.ALLOWED_ORIGINS) {
    console.info(`  CORS origins: ${process.env.ALLOWED_ORIGINS}`);
  }
});
