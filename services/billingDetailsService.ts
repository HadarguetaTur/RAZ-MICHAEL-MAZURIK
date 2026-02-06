/**
 * Billing Breakdown Service
 *
 * getBillingBreakdown(studentId, monthKey) – פירוט לחודש: שיעורים, מנויים, ביטולים בתשלום.
 * Enrichment only; does not change or validate the main Total.
 */

import type { AirtableClient } from './airtableClient';
import { TABLES, FIELDS } from '../contracts/fieldMap';

// --- Types (output of getBillingBreakdown) ---

export interface BreakdownLesson {
  date: string;
  type: string;
  unitPrice: number;
  lineAmount: number;
  status: string;
}

export interface BreakdownSubscription {
  type: string;
  amount: number;
  startDate: string;
  endDate: string | null;
  paused: boolean;
}

export interface PaidCancellation {
  date: string;
  hoursBefore: number | null;
  isLt24h: boolean;
  isCharged: boolean;
  linkedLessonId?: string;
}

export interface BillingBreakdownTotals {
  lessonsTotal: number;
  subscriptionsTotal: number;
  cancellationsTotal: number | null;
}

export interface BillingBreakdown {
  lessons: BreakdownLesson[];
  subscriptions: BreakdownSubscription[];
  paidCancellations: PaidCancellation[];
  // Optional manual adjustment (for future use in UI/PDF), kept in sync with charges row
  manualAdjustment?: {
    amount: number;
    reason: string;
    date: string;
  };
  totals: BillingBreakdownTotals;
}

function extractLinkedId(field: unknown): string | null {
  if (!field) return null;
  if (typeof field === 'string' && field.startsWith('rec')) return field;
  if (Array.isArray(field) && field.length > 0) {
    const v = field[0];
    return typeof v === 'string' ? v : (v && typeof v === 'object' && 'id' in v ? (v as { id: string }).id : null);
  }
  return null;
}

function linkedRecordIds(field: unknown): string[] {
  if (!field) return [];
  if (typeof field === 'string' && field.startsWith('rec')) return [field];
  if (Array.isArray(field)) {
    return field.map((v: unknown) => (typeof v === 'string' ? v : (v && typeof v === 'object' && 'id' in v ? (v as { id: string }).id : null))).filter(Boolean) as string[];
  }
  return [];
}

function parseAmount(val: string | number | undefined | null): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (val == null || val === '') return 0;
  const s = String(val).replace(/[₪,\s]/g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/** True if student has an active (non-paused) subscription covering the given lesson date. */
function hasActiveSubscriptionForDate(
  studentId: string,
  lessonDateStr: string,
  subsRaw: Array<{ id: string; fields: Record<string, unknown> }>,
  S: typeof FIELDS.subscriptions
): boolean {
  const lessonDate = new Date(lessonDateStr);
  lessonDate.setHours(0, 0, 0, 0);
  for (const r of subsRaw) {
    const f = r.fields;
    const linkId = extractLinkedId(f[S.student_id]);
    if (linkId !== studentId) continue;
    if (f[S.pause_subscription] === true || f[S.pause_subscription] === 1) continue;
    const startDate = f[S.subscription_start_date] ? String(f[S.subscription_start_date]).split('T')[0] : '';
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      if (start > lessonDate) continue;
    }
    const endDateVal = f[S.subscription_end_date];
    const endDate = endDateVal ? String(endDateVal).split('T')[0] : null;
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(0, 0, 0, 0);
      if (end < lessonDate) continue;
    }
    return true;
  }
  return false;
}

/**
 * Get billing breakdown for a student in a given month (YYYY-MM).
 * Enrichment only – total from the main screen is not recalculated or validated.
 */
export async function getBillingBreakdown(
  client: AirtableClient,
  studentId: string,
  monthKey: string
): Promise<BillingBreakdown> {
  if (import.meta.env.DEV) {
    console.log('[getBillingBreakdown] Start', { studentId, monthKey });
  }
  const L = FIELDS.lessons;
  const C = FIELDS.cancellations;
  const S = FIELDS.subscriptions;

  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEndExclusive = new Date(year, month, 1);
  const monthEndInclusive = new Date(year, month, 0, 23, 59, 59);

  const empty: BillingBreakdown = {
    lessons: [],
    subscriptions: [],
    paidCancellations: [],
    totals: { lessonsTotal: 0, subscriptionsTotal: 0, cancellationsTotal: null },
  };

  // --- A) Lessons: billing_month = monthKey AND student link contains studentId ---
  const lessonsTableId = TABLES.lessons.id;
  // Make filter more flexible to handle both YYYY-MM and YYYY-MM-DD
  const lessonsFilter = `OR({${L.billing_month}} = "${monthKey}", FIND("${monthKey}", {${L.billing_month}}) = 1)`;
  let lessonsRaw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  try {
    lessonsRaw = await client.getRecords(lessonsTableId, {
      filterByFormula: lessonsFilter,
      maxRecords: 5000,
    });
    if (import.meta.env.DEV) {
      console.log('[getBillingBreakdown] Fetched lessons', {
        monthKey,
        studentId,
        filter: lessonsFilter,
        count: lessonsRaw.length,
        sampleLessons: lessonsRaw.slice(0, 3).map(r => ({
          id: r.id,
          studentLink: r.fields[L.full_name],
          billingMonth: r.fields[L.billing_month],
        })),
      });
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[getBillingBreakdown] lessons fetch failed', e);
  }

  // Fetch subscriptions now so we can set lesson amount to 0 for pair/group when subscription is active
  const subsTableId = TABLES.subscriptions.id;
  let subsRaw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  try {
    subsRaw = await client.getRecords(subsTableId, { maxRecords: 5000 });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[getBillingBreakdown] subscriptions fetch failed (for lesson coverage)', e);
  }

  const lessons: BreakdownLesson[] = [];
  let lessonsTotal = 0;
  for (const r of lessonsRaw) {
    const f = r.fields;
    const studentIds = linkedRecordIds(f[L.full_name]);
    if (!studentIds.includes(studentId)) continue;
    const dateVal = f[L.lesson_date] ?? f[L.start_datetime];
    const date = dateVal ? String(dateVal).split('T')[0] : '';
    let lineAmount = parseAmount(f[L.line_amount] as string | number);
    const lessonType = String(f[L.lesson_type] ?? '').toLowerCase().trim();
    const isPair = lessonType === 'pair' || lessonType === 'זוגי';
    const isGroup = lessonType === 'group' || lessonType === 'קבוצתי';
    if (lineAmount <= 0 && isPair) {
      const totalPrice = parseAmount(f[L.price] as string | number);
      if (totalPrice > 0) lineAmount = Math.round((totalPrice / 2) * 100) / 100;
    }
    if (lineAmount <= 0 && isGroup) {
      lineAmount = 120;
    }
    // Pair/group with active subscription for this date => do not charge (show row with 0)
    const coveredBySubscription =
      (isPair || isGroup) && date && hasActiveSubscriptionForDate(studentId, date, subsRaw, S);
    if (coveredBySubscription && lineAmount > 0) lineAmount = 0;
    if (lineAmount <= 0 && !coveredBySubscription) continue;
    lessons.push({
      date,
      type: String(f[L.lesson_type] ?? ''),
      unitPrice: parseAmount(f[L.unit_price] as string | number) || (isPair || isGroup ? lineAmount : 0),
      lineAmount,
      status: String(f[L.status] ?? ''),
    });
    lessonsTotal += lineAmount;
  }

  if (import.meta.env.DEV) {
    console.log('[getBillingBreakdown] Lessons summary', {
      studentId,
      monthKey,
      count: lessons.length,
      lessonsTotal,
    });
  }

  // --- B) Paid cancellations: billing_month = monthKey AND student contains studentId AND is_charged = true ---
  const cancellationsTableId = TABLES.cancellations.id;
  // Make filter more flexible
  const cancelledFilter = `AND(OR({${C.billing_month}} = "${monthKey}", FIND("${monthKey}", {${C.billing_month}}) = 1), {${C.is_charged}} = TRUE())`;
  let cancellationsRaw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  try {
    cancellationsRaw = await client.getRecords(cancellationsTableId, {
      filterByFormula: cancelledFilter,
      maxRecords: 2000,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[getBillingBreakdown] cancellations fetch failed', e);
  }

  const paidCancellations: PaidCancellation[] = [];
  for (const r of cancellationsRaw) {
    const f = r.fields;
    const linkId = extractLinkedId(f[C.student]);
    if (linkId !== studentId) continue;
    const lessonLink = f[C.lesson];
    const linkedLessonId = extractLinkedId(lessonLink) ?? undefined;
    const dateVal = f[C.cancellation_date];
    const date = dateVal ? String(dateVal).split('T')[0] : '';
    const hoursBefore = f[C.hours_before] != null ? Number(f[C.hours_before]) : null;
    const isLt24h = f[C.is_lt_24h] === 1 || f[C.is_lt_24h] === '1' || f[C.is_lt_24h] === true;
    const isCharged = f[C.is_charged] === true || f[C.is_charged] === 1;
    paidCancellations.push({ date, hoursBefore, isLt24h, isCharged, linkedLessonId });
  }

  // --- C) Subscriptions: use subsRaw already fetched (student_id contains studentId, active in month) ---
  if (import.meta.env.DEV) {
    console.log('[getBillingBreakdown] Subscriptions (from same fetch)', {
      studentId,
      monthKey,
      count: subsRaw.length,
      sampleSubs: subsRaw.slice(0, 3).map(r => ({
        id: r.id,
        studentLink: r.fields[S.student_id],
        type: r.fields[S.subscription_type],
        paused: r.fields[S.pause_subscription],
      })),
    });
  }

  const subscriptions: BreakdownSubscription[] = [];
  let subscriptionsTotal = 0;
  for (const r of subsRaw) {
    const f = r.fields;
    const linkId = extractLinkedId(f[S.student_id]);
    if (import.meta.env.DEV && subsRaw.length > 0) {
      console.log('[getBillingBreakdown] Checking subscription', {
        subId: r.id,
        linkId,
        studentId,
        matches: linkId === studentId,
      });
    }
    if (linkId !== studentId) continue;
    const paused = f[S.pause_subscription] === true || f[S.pause_subscription] === 1;
    const startDate = f[S.subscription_start_date] ? String(f[S.subscription_start_date]).split('T')[0] : '';
    const endDateVal = f[S.subscription_end_date];
    const endDate = endDateVal ? String(endDateVal).split('T')[0] : null;
    // Treat subscriptions with missing startDate as active (legacy rows)
    const active =
      !paused &&
      (!startDate || new Date(startDate) <= monthEndInclusive) &&
      (!endDate || new Date(endDate) >= monthStart);
    if (!active) continue;
    const amount = parseAmount(f[S.monthly_amount] as string | number);
    subscriptions.push({
      type: String(f[S.subscription_type] ?? ''),
      amount,
      startDate,
      endDate,
      paused,
    });
    subscriptionsTotal += amount;
  }

  if (import.meta.env.DEV) {
    console.log('[getBillingBreakdown] Subscriptions summary', {
      studentId,
      monthKey,
      rawCount: subsRaw.length,
      matchedCount: subscriptions.length,
      subscriptionsTotal,
      details: subscriptions.map(s => ({
        type: s.type,
        amount: s.amount,
        startDate: s.startDate,
        endDate: s.endDate,
        paused: s.paused,
      })),
    });
  }

  const result: BillingBreakdown = {
    lessons,
    subscriptions,
    paidCancellations,
    // NOTE: manualAdjustment is intentionally not fetched here to avoid extra API calls
    // for manual_* fields – those come directly from the MonthlyBill row (table source of truth).
    totals: {
      lessonsTotal,
      subscriptionsTotal,
      cancellationsTotal: null,
    },
  };

  if (import.meta.env.DEV) {
    console.log('[getBillingBreakdown] Result', {
      studentId,
      monthKey,
      lessonsTotal: result.totals.lessonsTotal,
      subscriptionsTotal: result.totals.subscriptionsTotal,
      cancellationsTotal: result.totals.cancellationsTotal,
      lessonsCount: result.lessons.length,
      subscriptionsCount: result.subscriptions.length,
      paidCancellationsCount: result.paidCancellations.length,
    });
  }

  return result;
}
