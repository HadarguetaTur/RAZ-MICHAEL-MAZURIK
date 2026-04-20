/**
 * Billing Breakdown Service
 *
 * getBillingBreakdown(studentId, monthKey) – פירוט לחודש: שיעורים, מנויים, ביטולים בתשלום.
 * Enrichment only; does not change or validate the main Total.
 */

import type { AirtableClient } from './airtableClient';
import { TABLES, FIELDS, getField } from '../contracts/fieldMap';
import { isLessonExcluded, isBillableStatus, checkActiveSubscriptionForLesson } from '../billing/billingRules';
import type { SubscriptionsAirtableFields, LinkedRecord } from '../contracts/types';

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
  status: 'active' | 'paused' | 'expired';
}

export interface PaidCancellation {
  date: string;
  hoursBefore: number | null;
  isLt24h: boolean;
  isCharged: boolean;
  linkedLessonId?: string;
  amount: number;
}

export interface BillingBreakdownTotals {
  lessonsTotal: number;
  subscriptionsTotal: number;
  cancellationsTotal: number;
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

/**
 * Map raw Airtable subscription records to typed SubscriptionsAirtableFields,
 * then delegate to the shared checkActiveSubscriptionForLesson from billingRules.
 */
function hasActiveSubscriptionForDate(
  studentId: string,
  lessonDateStr: string,
  subsRaw: Array<{ id: string; fields: Record<string, unknown> }>,
  S: typeof FIELDS.subscriptions
): boolean {
  const typed: SubscriptionsAirtableFields[] = subsRaw.map((r) => ({
    id: r.id,
    student_id: (r.fields[S.student_id] ?? '') as LinkedRecord,
    subscription_start_date: r.fields[S.subscription_start_date]
      ? String(r.fields[S.subscription_start_date]).split('T')[0]
      : '',
    subscription_end_date: r.fields[S.subscription_end_date]
      ? String(r.fields[S.subscription_end_date]).split('T')[0]
      : undefined,
    monthly_amount: (r.fields[S.monthly_amount] ?? 0) as string | number,
    subscription_type: String(r.fields[S.subscription_type] ?? ''),
    pause_subscription:
      r.fields[S.pause_subscription] === true || r.fields[S.pause_subscription] === 1,
    pause_date: r.fields[S.pause_date]
      ? String(r.fields[S.pause_date]).split('T')[0]
      : undefined,
  }));
  return checkActiveSubscriptionForLesson(studentId, lessonDateStr.split('T')[0], typed);
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
    totals: { lessonsTotal: 0, subscriptionsTotal: 0, cancellationsTotal: 0 },
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

  // Fetch subscriptions so we can set lesson amount to 0 for pair/group when subscription is active
  const subsTableId = TABLES.subscriptions.id;
  let subsRaw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  try {
    subsRaw = await client.getRecords(subsTableId, { maxRecords: 5000 });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[getBillingBreakdown] subscriptions fetch failed (for lesson coverage)', e);
  }

  // --- B) Cancellations: fetch ALL for the month (not just charged) so we can
  //     cross-reference and exclude cancelled lessons from the lessons section. ---
  const cancellationsTableId = TABLES.cancellations.id;
  const cancelledFilter = `OR({${C.billing_month}} = "${monthKey}", FIND("${monthKey}", {${C.billing_month}}) = 1)`;
  let cancellationsRaw: Array<{ id: string; fields: Record<string, unknown> }> = [];
  try {
    cancellationsRaw = await client.getRecords(cancellationsTableId, {
      filterByFormula: cancelledFilter,
      maxRecords: 2000,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[getBillingBreakdown] cancellations fetch failed', e);
  }

  // Build set of lesson IDs that have a cancellation record for this student
  const cancellationsStudentField = getField('cancellations', 'student');
  const cancelledLessonIds = new Set<string>();
  const paidCancellations: PaidCancellation[] = [];
  let cancellationsTotal = 0;

  for (const r of cancellationsRaw) {
    const f = r.fields;
    const rawStudentLink = f[cancellationsStudentField] ?? (f as Record<string, unknown>)['student'];
    const linkId = extractLinkedId(rawStudentLink);
    if (linkId !== studentId) continue;

    const lessonLink = f[C.lesson];
    const linkedLessonId = extractLinkedId(lessonLink) ?? undefined;

    // Track every cancelled lesson ID (regardless of charge status)
    if (linkedLessonId) {
      cancelledLessonIds.add(linkedLessonId);
    }

    // Only include charged cancellations in the paid cancellations output
    const isCharged = f[C.is_charged] === true || f[C.is_charged] === 1;
    if (!isCharged) continue;

    const dateVal = f[C.cancellation_date];
    const date = dateVal ? String(dateVal).split('T')[0] : '';
    const hoursBefore = f[C.hours_before] != null ? Number(f[C.hours_before]) : null;
    const isLt24h = f[C.is_lt_24h] === 1 || f[C.is_lt_24h] === '1' || f[C.is_lt_24h] === true;
    const amount = parseAmount(f[C.charge] as string | number);
    cancellationsTotal += amount;
    paidCancellations.push({ date, hoursBefore, isLt24h, isCharged, linkedLessonId, amount });
  }

  // --- A) Lessons: process after cancellations so we can cross-reference ---
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

    // Exclude lessons that have a cancellation record (regardless of lesson status)
    if (cancelledLessonIds.has(r.id)) continue;

    // Filter out cancelled and non-billable lessons by status
    const lessonStatus = String(f[L.status] ?? '');
    if (isLessonExcluded(lessonStatus)) continue;
    if (!isBillableStatus(lessonStatus)) continue;
    const dateVal = f[L.lesson_date] ?? f[L.start_datetime];
    const date = dateVal ? String(dateVal).split('T')[0] : '';
    let lineAmount = parseAmount(f[L.line_amount] as string | number);
    const lessonType = String(f[L.lesson_type] ?? '').toLowerCase().trim();
    const isPair = lessonType === 'pair' || lessonType === 'זוגי';
    const isGroup = lessonType === 'group' || lessonType === 'קבוצתי';
    const isPrivate = lessonType === 'private' || lessonType === 'פרטי';
    const isCustom = lessonType === 'מותאם' || lessonType === 'custom';
    // Private: prefer price (manual override by Raz), then line_amount (formula), then 175
    // MUST match billingRules.ts: price field is checked first even if 0 (explicit waiver)
    if (isPrivate) {
      const rawPrice = f[L.price];
      if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
        lineAmount = parseAmount(rawPrice as string | number);
      } else if (lineAmount <= 0) {
        lineAmount = 175;
      }
    }
    // Pair: prefer explicit price (manual override), then line_amount formula value, then 112.5
    if (isPair) {
      const totalPrice = parseAmount(f[L.price] as string | number);
      if (totalPrice > 0) {
        lineAmount = Math.round((totalPrice / 2) * 100) / 100;
      } else if (lineAmount <= 0) {
        lineAmount = 112.5;
      }
      // else: line_amount from formula (112.5) is the correct default — keep it
    }
    // Group: line_amount, then 120
    if (lineAmount <= 0 && isGroup) {
      lineAmount = 120;
    }
    // Custom: price (frozen per-student at creation) → line_amount fallback
    if (isCustom) {
      const billingMode = String(f[L.custom_billing_mode] ?? 'per_student');
      if (billingMode === 'free') {
        // Deliberately free — skip entirely, nothing to show in breakdown
        continue;
      }
      if (billingMode === 'subscription') {
        const eligible = f[L.custom_subscription_eligible];
        const coveredCustom =
          eligible && date && hasActiveSubscriptionForDate(studentId, date, subsRaw, S);
        if (coveredCustom) {
          lineAmount = 0;
        } else {
          // Subscription doesn't cover this lesson — use fallback price
          const fallback = parseAmount(f[L.custom_fallback_price] as string | number);
          lineAmount = fallback > 0 ? fallback : 0;
        }
      } else {
        const rawPrice = parseAmount(f[L.price] as string | number);
        if (rawPrice > 0) {
          lineAmount = rawPrice;
        }
        // If price is still 0/missing, keep lineAmount as-is (from line_amount formula or 0).
        // per_student/split_total lessons with missing price are shown as ₪0 (data gap, not a waiver).
      }
    }
    // Pair/group with active subscription for this date => do not charge (show row with 0)
    const coveredBySubscription =
      (isPair || isGroup) && date && hasActiveSubscriptionForDate(studentId, date, subsRaw, S);
    if (coveredBySubscription && lineAmount > 0) lineAmount = 0;
    // Non-custom lessons with lineAmount = 0 that aren't subscription-covered are not billable
    if (lineAmount <= 0 && !coveredBySubscription && !isCustom) continue;
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

  // --- C) Subscriptions: include active, paused & expired subs that overlap with month ---

  const subscriptions: BreakdownSubscription[] = [];
  let subscriptionsTotal = 0;
  const subsStudentField = getField('subscriptions', 'student_id');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const r of subsRaw) {
    const f = r.fields;
    const rawStudentLink = f[subsStudentField] ?? (f as Record<string, unknown>)['student_id'];
    const linkId = extractLinkedId(rawStudentLink);
    if (linkId !== studentId) continue;
    const paused = f[S.pause_subscription] === true || f[S.pause_subscription] === 1;
    const startDate = f[S.subscription_start_date] ? String(f[S.subscription_start_date]).split('T')[0] : '';
    const endDateVal = f[S.subscription_end_date];
    const endDate = endDateVal ? String(endDateVal).split('T')[0] : null;

    const overlapsMonth =
      (!startDate || new Date(startDate) <= monthEndInclusive) &&
      (!endDate || new Date(endDate) >= monthStart);
    if (!overlapsMonth) continue;

    let status: 'active' | 'paused' | 'expired';
    if (paused) {
      status = 'paused';
    } else if (endDate && new Date(endDate) < today) {
      status = 'expired';
    } else {
      status = 'active';
    }

    const fullAmount = parseAmount(f[S.monthly_amount] as string | number);
    let chargedAmount = fullAmount;

    if (paused) {
      chargedAmount = 0;
    } else if (endDate || startDate) {
      const daysInMonth = new Date(year, month, 0).getDate();
      const effectiveStart = startDate && new Date(startDate) > monthStart
        ? new Date(startDate) : monthStart;
      const effectiveEnd = endDate && new Date(endDate) < monthEndInclusive
        ? new Date(endDate) : monthEndInclusive;
      const activeDays = Math.max(0, Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / 86400000) + 1);
      if (activeDays < daysInMonth) {
        chargedAmount = Math.round((fullAmount * activeDays / daysInMonth) * 100) / 100;
      }
    }

    subscriptions.push({
      type: String(f[S.subscription_type] ?? ''),
      amount: chargedAmount,
      startDate,
      endDate,
      paused,
      status,
    });
    subscriptionsTotal += chargedAmount;
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
      cancellationsTotal,
    },
  };


  return result;
}
