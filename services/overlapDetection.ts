/**
 * Overlap detection utility for lesson-save and slot-save flows.
 * Rule: ranges overlap iff aStart < bEnd && aEnd > bStart (strict; touching counts as no overlap).
 */

export type DateTimeLike = string | Date;

function toMs(x: DateTimeLike): number {
  return typeof x === 'string' ? new Date(x).getTime() : x.getTime();
}

/**
 * Returns true iff the two ranges [aStart, aEnd) and [bStart, bEnd) overlap.
 * Touching at an endpoint (e.g. aEnd === bStart) is not overlap.
 */
export function hasOverlap(
  aStart: DateTimeLike,
  aEnd: DateTimeLike,
  bStart: DateTimeLike,
  bEnd: DateTimeLike
): boolean {
  const aS = toMs(aStart);
  const aE = toMs(aEnd);
  const bS = toMs(bStart);
  const bE = toMs(bEnd);
  return aS < bE && aE > bS;
}

/** Slot-like shape: either datetime fields (OpenSlot/OpenSlotRecord) or date+time fields (SlotInventory). */
type OpenSlotLike =
  | { id: string; teacherId: string; status: string; startDateTime: string; endDateTime: string }
  | { id: string; teacherId: string; status: string; date: string; startTime: string; endTime: string };

function slotRange(slot: OpenSlotLike): { start: string; end: string } {
  if ('startDateTime' in slot && slot.startDateTime) {
    return { start: slot.startDateTime, end: slot.endDateTime };
  }
  const s = slot as { date: string; startTime: string; endTime: string };
  const startStr = s.startTime.length === 5 ? `${s.date}T${s.startTime}:00` : `${s.date}T${s.startTime}`;
  const endStr = s.endTime.length === 5 ? `${s.date}T${s.endTime}:00` : `${s.date}T${s.endTime}`;
  return {
    start: new Date(startStr).toISOString(),
    end: new Date(endStr).toISOString(),
  };
}

export interface LessonDraft {
  date: string;
  startTime: string;
  duration: number;
  teacherId?: string;
}

/**
 * Returns open slots that overlap the lesson draft’s time range,
 * filtered by same teacherId (when provided) and status === "open".
 */
export function findOverlappingOpenSlots<T extends OpenSlotLike>(
  lessonDraft: LessonDraft | null | undefined,
  openSlots: T[],
  excludeSlotId?: string
): T[] {
  if (!lessonDraft?.date || !lessonDraft?.startTime || lessonDraft.duration == null) {
    return [];
  }
  const startStr =
    lessonDraft.startTime.length >= 8
      ? lessonDraft.startTime
      : lessonDraft.startTime.length === 5
        ? `${lessonDraft.startTime}:00`
        : `${lessonDraft.startTime}:00`;
  const lessonStart = new Date(`${lessonDraft.date}T${startStr}`);
  const lessonEnd = new Date(lessonStart.getTime() + lessonDraft.duration * 60 * 1000);
  const lessonStartISO = lessonStart.toISOString();
  const lessonEndISO = lessonEnd.toISOString();

  return openSlots.filter((slot) => {
    // Exclude self if excludeSlotId is provided (for edit mode)
    if (excludeSlotId && slot.id === excludeSlotId) {
      return false;
    }
    if (slot.status !== 'open') return false;
    if (
      lessonDraft.teacherId != null &&
      lessonDraft.teacherId !== '' &&
      slot.teacherId != null &&
      slot.teacherId !== lessonDraft.teacherId
    ) {
      return false;
    }
    const { start, end } = slotRange(slot);
    return hasOverlap(lessonStartISO, lessonEndISO, start, end);
  });
}

export interface SlotDraft {
  date: string;
  startTime: string;
  endTime: string;
  teacherId?: string;
}

/** Lesson-like shape: has date, startTime, duration, optional teacherId. */
type LessonLike = {
  id: string;
  date: string;
  startTime: string;
  duration: number;
  teacherId?: string;
  [k: string]: unknown;
};

/**
 * Returns lessons that overlap the slot draft's time range,
 * filtered by same teacherId (when both provided).
 * Uses currently loaded lessons — no network calls.
 * Excludes lesson with excludeLessonId if provided (for edit mode).
 */
export function findOverlappingLessons<T extends LessonLike>(
  slotDraft: SlotDraft | null | undefined,
  lessons: T[],
  excludeLessonId?: string
): T[] {
  if (!slotDraft?.date || !slotDraft.startTime || !slotDraft.endTime) {
    return [];
  }
  const startStr =
    slotDraft.startTime.length >= 8
      ? slotDraft.startTime.slice(0, 8)
      : slotDraft.startTime.length === 5
        ? `${slotDraft.startTime}:00`
        : `${slotDraft.startTime}:00`;
  const endStr =
    slotDraft.endTime.length >= 8
      ? slotDraft.endTime.slice(0, 8)
      : slotDraft.endTime.length === 5
        ? `${slotDraft.endTime}:00`
        : `${slotDraft.endTime}:00`;
  const slotStart = new Date(`${slotDraft.date}T${startStr}`);
  const slotEnd = new Date(`${slotDraft.date}T${endStr}`);
  const slotStartISO = slotStart.toISOString();
  const slotEndISO = slotEnd.toISOString();

  return lessons.filter((lesson) => {
    // Exclude self if excludeLessonId is provided (for edit mode)
    if (excludeLessonId && lesson.id === excludeLessonId) {
      return false;
    }
    if (
      slotDraft.teacherId != null &&
      slotDraft.teacherId !== '' &&
      lesson.teacherId != null &&
      lesson.teacherId !== slotDraft.teacherId
    ) {
      return false;
    }
    const lStartStr =
      lesson.startTime.length >= 8
        ? lesson.startTime.slice(0, 8)
        : lesson.startTime.length === 5
          ? `${lesson.startTime}:00`
          : `${lesson.startTime}:00`;
    const lessonStart = new Date(`${lesson.date}T${lStartStr}`);
    const lessonEnd = new Date(
      lessonStart.getTime() + (lesson.duration ?? 60) * 60 * 1000
    );
    // Overlap condition: startA < endB && startB < endA (strict, no <=)
    return hasOverlap(
      slotStartISO,
      slotEndISO,
      lessonStart.toISOString(),
      lessonEnd.toISOString()
    );
  });
}

// DEV-only self-check: skip when running in Jest (NODE_ENV=test)
const _isTest =
  typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';
if (!_isTest) {
  try {
    const ok =
      hasOverlap('2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z', '2024-01-15T10:30:00Z', '2024-01-15T11:30:00Z') === true &&
      hasOverlap('2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z', '2024-01-15T11:00:00Z', '2024-01-15T12:00:00Z') === false;
    if (!ok) {
      console.warn('[overlapDetection] DEV self-check failed for hasOverlap');
    }
  } catch (_) {}
}
