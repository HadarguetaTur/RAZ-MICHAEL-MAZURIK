/**
 * Billing Breakdown Service
 *
 * getBillingBreakdown(studentId, monthKey) – פירוט לחודש: שיעורים, מנויים, ביטולים בתשלום.
 * Enrichment only; does not change or validate the main Total.
 */

import type { AirtableClient } from './airtableClient';
import { TABLES, FIELDS, getField } from '../contracts/fieldMap';

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

  // --- A) Lessons: billing_month = monthKey OR start_datetime in month range ---
  const lessonsTableId = TABLES.lessons.id;
  // Filter by billing_month (text match) OR start_datetime date range (fallback)
  const startDateStr = `${monthKey}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  const lessonsFilter = `OR({${L.billing_month}} = "${monthKey}", FIND("${monthKey}", {${L.billing_month}}) = 1, AND(IS_AFTER({${L.start_datetime}}, "${startDateStr}"), IS_BEFORE({${L.start_datetime}}, "${endDateStr}T23:59:59")))`;
  let lessonsRaw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  try {
    lessonsRaw = await client.getRecords(lessonsTableId, {
      filterByFormula: lessonsFilter,
      maxRecords: 5000,
    });
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
  const lessonsStudentField = getField('lessons', 'full_name');
  for (const r of lessonsRaw) {
    const f = r.fields;
    const rawStudentLink = f[lessonsStudentField] ?? (f as Record<string, unknown>)['Student'];
    const studentIds = linkedRecordIds(rawStudentLink);
    if (!studentIds.includes(studentId)) continue;
    // Application-level month check (double-check Airtable filter results)
    const billingMonthVal = f[L.billing_month] ? String(f[L.billing_month]) : '';
    const lessonDatetime = f[L.start_datetime] ? String(f[L.start_datetime]) : '';
    let belongsToMonth = false;
    if (billingMonthVal === monthKey || billingMonthVal.substring(0, 7) === monthKey) {
      belongsToMonth = true;
    }
    if (!belongsToMonth && lessonDatetime) {
      const lessonDate = new Date(lessonDatetime);
      if (lessonDate >= monthStart && lessonDate <= monthEndInclusive) {
        belongsToMonth = true;
      }
    }
    if (!belongsToMonth) continue;
    const dateVal = f[L.lesson_date] ?? f[L.start_datetime];
    const date = dateVal ? String(dateVal).split('T')[0] : '';
    let lineAmount = parseAmount(f[L.line_amount] as string | number);
    const lessonType = String(f[L.lesson_type] ?? '').toLowerCase().trim();
    const isPair = lessonType === 'pair' || lessonType === 'זוגי';
    const isGroup = lessonType === 'group' || lessonType === 'קבוצתי';
    const isPrivate = lessonType === 'private' || lessonType === 'פרטי';
    // Private: prefer price (manual override by Raz), then line_amount (formula), then 175
    // MUST match billingRules.ts which checks price FIRST (price > line_amount > 175)
    if (isPrivate) {
      const manualPrice = parseAmount(f[L.price] as string | number);
      if (manualPrice > 0) {
        lineAmount = manualPrice;
      } else if (lineAmount <= 0) {
        lineAmount = 175;
      }
    }
    // Pair: line_amount, then price/2, then 112.5
    if (lineAmount <= 0 && isPair) {
      const totalPrice = parseAmount(f[L.price] as string | number);
      lineAmount = totalPrice > 0 ? Math.round((totalPrice / 2) * 100) / 100 : 112.5;
    }
    // Group: line_amount, then 120
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
      unitPrice: isPrivate
        ? (parseAmount(f[L.price] as string | number) || parseAmount(f[L.unit_price] as string | number) || lineAmount)
        : (parseAmount(f[L.unit_price] as string | number) || (isPair || isGroup ? lineAmount : 0)),
      lineAmount,
      status: String(f[L.status] ?? ''),
    });
    lessonsTotal += lineAmount;
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
  const cancellationsStudentField = getField('cancellations', 'student');
  for (const r of cancellationsRaw) {
    const f = r.fields;
    const rawStudentLink = f[cancellationsStudentField] ?? (f as Record<string, unknown>)['student'];
    const linkId = extractLinkedId(rawStudentLink);
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

  const subscriptions: BreakdownSubscription[] = [];
  let subscriptionsTotal = 0;
  const subsStudentField = getField('subscriptions', 'student_id');
  for (const r of subsRaw) {
    const f = r.fields;
    const rawStudentLink = f[subsStudentField] ?? (f as Record<string, unknown>)['student_id'];
    const linkId = extractLinkedId(rawStudentLink);
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

  lessons.sort((a, b) => a.date.localeCompare(b.date));
  paidCancellations.sort((a, b) => a.date.localeCompare(b.date));

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


  return result;
}
