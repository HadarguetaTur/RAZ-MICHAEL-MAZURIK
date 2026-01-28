/**
 * Domain event → inbox upsert payload (server-only).
 * Callers: internal server code (cron, flows) and POST /api/inbox/events.
 */

import type { AirtableInboxFields } from './airtableInboxRepo';

function nowPlusHours(h: number): string {
  const d = new Date();
  d.setHours(d.getHours() + h);
  return d.toISOString();
}

function nowPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Late cancellation approval needed */
export function onLateCancellationRequested(p: {
  lessonId: string;
  studentId: string;
  lessonDateTime: string;
  hoursUntil: number;
  studentName?: string;
}): AirtableInboxFields & { inbox_key: string } {
  const inboxKey = `cancel_approval|${p.lessonId}`;
  const title = `בקשת ביטול מאוחר${p.studentName ? ` – ${p.studentName}` : ''}`;
  const details = `שיעור ${p.lessonDateTime}, כ־${p.hoursUntil} שעות לפני השיעור. שיעור ID: ${p.lessonId}, תלמיד: ${p.studentId}.`;
  return {
    inbox_key: inboxKey,
    category: 'ביטולים',
    type: 'approve_late_cancel',
    title,
    details,
    priority: 'גבוה',
    status: 'פתוח',
    due_at: nowPlusHours(6),
  };
}

/** Waitlist slot offered */
export function onWaitlistCreated(p: {
  waitlistId: string;
  teacherId?: string;
  date?: string;
  slotId?: string;
  studentId?: string;
  studentName?: string;
}): AirtableInboxFields & { inbox_key: string } {
  const inboxKey = `waitlist|${p.waitlistId}`;
  const title = `הצעת מקום ברשימת המתנה${p.studentName ? ` – ${p.studentName}` : ''}`;
  const details = [
    p.date && `תאריך: ${p.date}`,
    p.teacherId && `מורה: ${p.teacherId}`,
    p.slotId && ` slot: ${p.slotId}`,
    p.studentId && `תלמיד: ${p.studentId}`,
  ]
    .filter(Boolean)
    .join('; ');
  return {
    inbox_key: inboxKey,
    category: 'שיבוצים/וויטליסט',
    type: 'waitlist_offer',
    title,
    details: details || `רשימת המתנה ${p.waitlistId}`,
    priority: 'בינוני',
    status: 'פתוח',
  };
}

/** System error to resolve */
export function onSystemError(p: {
  signature: string;
  message: string;
  source?: string;
  code?: string;
}): AirtableInboxFields & { inbox_key: string } {
  const inboxKey = `error|${p.signature}`;
  const details = [p.message, p.source && `source: ${p.source}`, p.code && `code: ${p.code}`]
    .filter(Boolean)
    .join('\n');
  return {
    inbox_key: inboxKey,
    category: 'שגיאות',
    type: 'resolve_error',
    title: p.message.slice(0, 80) + (p.message.length > 80 ? '…' : ''),
    details,
    priority: 'גבוה',
    status: 'פתוח',
  };
}

/** Payment overdue follow-up */
export function onPaymentOverdue(p: {
  studentId: string;
  billingMonth: string;
  amount?: number;
  studentName?: string;
}): AirtableInboxFields & { inbox_key: string } {
  const inboxKey = `payment_followup|${p.studentId}|${p.billingMonth}`;
  const title = `תשלום באיחור – ${p.billingMonth}${p.studentName ? ` (${p.studentName})` : ''}`;
  const details = [
    `תלמיד: ${p.studentId}`,
    `חודש: ${p.billingMonth}`,
    p.amount != null && `סכום: ${p.amount}`,
  ]
    .filter(Boolean)
    .join('; ');
  return {
    inbox_key: inboxKey,
    category: 'חיובים',
    type: 'payment_followup',
    title,
    details,
    priority: 'בינוני',
    status: 'פתוח',
    due_at: nowPlusHours(24),
  };
}

export type InboxEventKind =
  | 'late_cancel'
  | 'waitlist'
  | 'system_error'
  | 'payment_overdue';

export type InboxEventPayload =
  | { event: 'late_cancel'; lessonId: string; studentId: string; lessonDateTime: string; hoursUntil: number; studentName?: string }
  | { event: 'waitlist'; waitlistId: string; teacherId?: string; date?: string; slotId?: string; studentId?: string; studentName?: string }
  | { event: 'system_error'; signature: string; message: string; source?: string; code?: string }
  | { event: 'payment_overdue'; studentId: string; billingMonth: string; amount?: number; studentName?: string };

/** Build upsert payload from a domain event. */
export function buildInboxPayloadFromEvent(
  payload: InboxEventPayload
): AirtableInboxFields & { inbox_key: string } {
  switch (payload.event) {
    case 'late_cancel':
      return onLateCancellationRequested(payload);
    case 'waitlist':
      return onWaitlistCreated(payload);
    case 'system_error':
      return onSystemError(payload);
    case 'payment_overdue':
      return onPaymentOverdue(payload);
    default:
      throw new Error(`Unknown inbox event: ${(payload as { event?: string }).event}`);
  }
}
