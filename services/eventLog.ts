/**
 * Event log for UI/ErrorCenter. Used to record CONFLICT_OVERRIDE when the user
 * clicks "המשך בכל זאת" (save despite overlap). Events are kept in memory and
 * exposed for ErrorCenter; they are also logged to console in dev.
 */

export const EVENT_CODE_CONFLICT_OVERRIDE = 'CONFLICT_OVERRIDE';

export interface ConflictOverrideEvent {
  code: typeof EVENT_CODE_CONFLICT_OVERRIDE;
  timestamp: string; // ISO
  recordId?: string;
  entity: 'lesson' | 'slot_inventory';
  teacherId: string;
  date: string;
  conflictSummary?: string;
}

const MAX_EVENTS = 100;
const conflictOverrideEvents: ConflictOverrideEvent[] = [];

export function logConflictOverride(payload: {
  recordId?: string;
  entity: 'lesson' | 'slot_inventory';
  teacherId: string;
  date: string;
  conflictSummary?: string;
}): void {
  const event: ConflictOverrideEvent = {
    code: EVENT_CODE_CONFLICT_OVERRIDE,
    timestamp: new Date().toISOString(),
    recordId: payload.recordId,
    entity: payload.entity,
    teacherId: payload.teacherId,
    date: payload.date,
    conflictSummary: payload.conflictSummary,
  };
  conflictOverrideEvents.unshift(event);
  if (conflictOverrideEvents.length > MAX_EVENTS) conflictOverrideEvents.pop();
  if (import.meta.env?.DEV) {
    console.log('[eventLog] CONFLICT_OVERRIDE', {
      recordId: event.recordId,
      entity: event.entity,
      teacherId: event.teacherId.slice(0, 8) + '…',
      date: event.date,
      conflictSummary: event.conflictSummary,
    });
  }
}

export function getConflictOverrideEvents(): ConflictOverrideEvent[] {
  return [...conflictOverrideEvents];
}
