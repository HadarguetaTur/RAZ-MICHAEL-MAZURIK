/**
 * Conflicts check service: overlap detection vs lessons and slot_inventory.
 * Uses utils/overlaps (pure). Fetchers are injected so it can run from client (nexusApi) or server (Airtable REST).
 * - Lessons: exclude status 'בוטל' (LessonStatus.CANCELLED), exclude recordId if given.
 * - Slots: only "open" (getOpenSlots returns open-only); exclude recordId if given.
 */

import { findConflicts, type ExistingInterval, type Conflict } from '../utils/overlaps';
import { LessonStatus } from '../types';

/** Minimal lesson shape needed for conflict building. */
export interface LessonLike {
  id: string;
  date: string;
  startTime: string;
  duration: number;
  studentName?: string;
  status: string;
  teacherId?: string;
}

/** Minimal open-slot shape (getOpenSlots returns these). */
export interface OpenSlotLike {
  id: string;
  startDateTime: string;
  endDateTime: string;
  teacherId?: string;
}

export interface ConflictsCheckFetchers {
  getLessons: (startDate: string, endDate: string, teacherId?: string) => Promise<LessonLike[]>;
  getOpenSlots: (startISO: string, endISO: string, teacherId?: string) => Promise<OpenSlotLike[]>;
}

/** Request body for conflicts check. */
export interface CheckConflictsParams {
  entity: 'lesson' | 'slot_inventory';
  recordId?: string; // For self-exclusion (editing existing record)
  linkedLessonIds?: string[]; // For slot_inventory: exclude lessons already linked to this slot
  teacherId: string | number;
  date: string; // YYYY-MM-DD
  start: string; // "HH:mm" or ISO datetime
  end: string;   // "HH:mm" or ISO datetime
}

/** One conflict item in the response. */
export interface ConflictItem {
  source: 'lessons' | 'slot_inventory';
  recordId: string;
  start: string;
  end: string;
  label: string;
  meta: Record<string, unknown>;
}

export interface CheckConflictsResult {
  hasConflicts: boolean;
  conflicts: ConflictItem[];
}

/** Build a short conflict summary string, e.g. "lessons:recA 10:00-11:00; slot_inventory:recB 10:30-11:30" */
export function buildConflictSummary(conflicts: ConflictItem[]): string {
  if (!conflicts.length) return '';
  const toTime = (s: string) => {
    const t = String(s).trim();
    if (t.includes('T')) return t.slice(11, 16);
    return t.length >= 5 ? t.slice(0, 5) : t;
  };
  return conflicts
    .map((c) => `${c.source}:${c.recordId} ${toTime(c.start)}-${toTime(c.end)}`)
    .join('; ');
}

const CANCELLED_STATUS = LessonStatus.CANCELLED; // 'בוטל' — from existing code
const PENDING_CANCEL_STATUS = LessonStatus.PENDING_CANCEL; // 'ממתין לאישור ביטול' — from existing code

function toISO(date: string, timeOrIso: string): string {
  const s = String(timeOrIso).trim();
  if (s.includes('T')) return s; // already ISO
  const timePart = s.length === 5 ? `${s}:00` : s.slice(0, 8);
  return new Date(`${date}T${timePart}`).toISOString();
}

function lessonToInterval(
  l: LessonLike, 
  excludeRecordId?: string,
  excludeLinkedLessonIds?: string[]
): ExistingInterval | null {
  // Exclude cancelled lessons: 'בוטל' (CANCELLED) and 'ממתין לאישור ביטול' (PENDING_CANCEL)
  if (l.status === CANCELLED_STATUS || l.status === PENDING_CANCEL_STATUS) return null;
  
  // PART 4A: Exclude self if editing existing lesson
  if (excludeRecordId && l.id === excludeRecordId) return null;
  
  // PART 4A: Exclude linked lessons (lessons already linked to the slot being edited)
  if (excludeLinkedLessonIds && excludeLinkedLessonIds.length > 0 && excludeLinkedLessonIds.includes(l.id)) {
    return null;
  }
  
  const startStr = l.startTime.length >= 8 ? l.startTime.slice(0, 8) : (l.startTime.length === 5 ? `${l.startTime}:00` : l.startTime);
  const start = new Date(`${l.date}T${startStr}`);
  const end = new Date(start.getTime() + (l.duration ?? 60) * 60 * 1000);
  return {
    recordId: l.id,
    source: 'lessons',
    start: start.toISOString(),
    end: end.toISOString(),
    label: l.studentName ?? 'שיעור',
  };
}

function slotToInterval(s: OpenSlotLike, excludeRecordId?: string): ExistingInterval | null {
  if (excludeRecordId && s.id === excludeRecordId) return null;
  return {
    recordId: s.id,
    source: 'slot_inventory',
    start: s.startDateTime,
    end: s.endDateTime,
    label: 'חלון פתוח',
  };
}

function toConflictItem(c: Conflict): ConflictItem {
  const start = typeof c.start === 'string' ? c.start : (c.start as Date).toISOString();
  const end = typeof c.end === 'string' ? c.end : (c.end as Date).toISOString();
  return {
    source: c.source === 'lessons' ? 'lessons' : 'slot_inventory',
    recordId: c.recordId,
    start,
    end,
    label: c.label,
    meta: {},
  };
}

/**
 * Check overlap of a proposed interval against lessons and open slot_inventory for the same teacher/date.
 * Uses findConflicts from utils/overlaps. On fetcher/API errors, logs minimally and throws with a clean message.
 */
export async function checkConflicts(
  params: CheckConflictsParams,
  fetchers: ConflictsCheckFetchers
): Promise<CheckConflictsResult> {
  const { entity, recordId, linkedLessonIds, teacherId, date, start, end } = params;
  const proposedStartISO = toISO(date, start);
  const proposedEndISO = toISO(date, end);
  const teacherIdStr = typeof teacherId === 'number' ? String(teacherId) : String(teacherId);
  const dayStartISO = new Date(`${date}T00:00:00`).toISOString();
  const dayEndISO = new Date(`${date}T23:59:59.999`).toISOString();

  let existing: ExistingInterval[] = [];

  try {
    const [lessons, openSlots] = await Promise.all([
      fetchers.getLessons(dayStartISO, dayEndISO, teacherIdStr || undefined),
      fetchers.getOpenSlots(dayStartISO, dayEndISO, teacherIdStr || undefined),
    ]);

    // PART 4A: Exclude linked lessons when editing slot_inventory
    const lessonIntervals = lessons
      .map((l) => lessonToInterval(l, recordId, linkedLessonIds))
      .filter((x): x is ExistingInterval => x !== null);
    
    // PART 4B: Self-exclusion for slot_inventory (already implemented in slotToInterval)
    const slotIntervals = openSlots
      .map((s) => slotToInterval(s, recordId))
      .filter((x): x is ExistingInterval => x !== null);
    existing = [...lessonIntervals, ...slotIntervals];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[conflictsCheckService] fetcher error', {
      entity,
      date,
      teacherId: teacherIdStr ? (teacherIdStr.length > 6 ? teacherIdStr.slice(0, 6) + '…' : teacherIdStr) : undefined,
    });
    throw new Error('שגיאה בבדיקת חפיפות. נסה שוב.');
  }

  // Pass recordId to exclude self from conflicts (for slot_inventory internal comparisons)
  const conflicts = findConflicts(proposedStartISO, proposedEndISO, existing, recordId);
  return {
    hasConflicts: conflicts.length > 0,
    conflicts: conflicts.map(toConflictItem),
  };
}
