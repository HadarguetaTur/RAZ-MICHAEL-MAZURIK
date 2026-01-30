/**
 * Pure overlap utilities for interval comparison.
 * Rule: overlap iff aStart < bEnd && aEnd > bStart (touching edges count as no overlap).
 * Times: use ISO strings or Date; stay consistent with existing code (no new libs).
 * For Asia/Jerusalem, pass ISO strings with offset (e.g. 2024-01-15T10:00:00+02:00) or UTC.
 */

export type DateTimeLike = string | Date;

function toMs(x: DateTimeLike): number {
  return typeof x === 'string' ? new Date(x).getTime() : x.getTime();
}

/**
 * Returns true iff the two ranges [aStart, aEnd) and [bStart, bEnd) overlap.
 * Touching at an endpoint (e.g. aEnd === bStart) is not overlap.
 */
export function isOverlapping(
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

/** Existing interval shape: recordId, source, start, end, label. */
export interface ExistingInterval {
  recordId: string;
  source: string;
  start: DateTimeLike;
  end: DateTimeLike;
  label: string;
}

/** Conflict: same shape as existing interval, used as overlap result. */
export interface Conflict {
  recordId: string;
  source: string;
  start: DateTimeLike;
  end: DateTimeLike;
  label: string;
}

/**
 * Returns existing intervals that overlap the proposed [proposedStart, proposedEnd),
 * sorted by start (asc). Touching edges (proposedEnd === ex.start or proposedStart === ex.end) are not conflicts.
 * Excludes the record with excludeRecordId if provided (for edit mode).
 */
export function findConflicts(
  proposedStart: DateTimeLike,
  proposedEnd: DateTimeLike,
  existing: ExistingInterval[],
  excludeRecordId?: string
): Conflict[] {
  const conflicts = existing.filter((ex) => {
    // Exclude self if excludeRecordId is provided
    if (excludeRecordId && ex.recordId === excludeRecordId) {
      return false;
    }
    // Check overlap: startA < endB && startB < endA (strict, no <=)
    return isOverlapping(proposedStart, proposedEnd, ex.start, ex.end);
  });
  conflicts.sort((a, b) => toMs(a.start) - toMs(b.start));
  return conflicts.map((ex) => ({
    recordId: ex.recordId,
    source: ex.source,
    start: ex.start,
    end: ex.end,
    label: ex.label,
  }));
}
