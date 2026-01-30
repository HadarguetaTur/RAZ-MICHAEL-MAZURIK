/**
 * Pure Billing Calculation Functions
 * 
 * These functions contain the business logic for calculating billing amounts.
 * They are pure functions (no side effects) for easy testing.
 */

import {
  LessonsAirtableFields,
  CancellationsAirtableFields,
  SubscriptionsAirtableFields,
  LinkedRecord,
} from '../contracts/types';
import { MissingFieldsError } from './domainErrors';

/**
 * Extract student record ID from linked record
 */
export function extractStudentId(linkedRecord: LinkedRecord): string {
  if (typeof linkedRecord === 'string') {
    return linkedRecord;
  }
  if (Array.isArray(linkedRecord) && linkedRecord.length > 0) {
    return linkedRecord[0];
  }
  throw new Error('Invalid linked record format');
}

/**
 * Check if linked record has multiple students
 */
export function hasMultipleStudents(linkedRecord: LinkedRecord): boolean {
  return Array.isArray(linkedRecord) && linkedRecord.length > 1;
}

/**
 * Get all student IDs from linked record
 */
export function getAllStudentIds(linkedRecord: LinkedRecord): string[] {
  if (typeof linkedRecord === 'string') {
    return [linkedRecord];
  }
  if (Array.isArray(linkedRecord)) {
    return linkedRecord;
  }
  return [];
}

/**
 * Extract lesson record ID from linked record
 */
export function extractLessonId(linkedRecord: LinkedRecord): string {
  return extractStudentId(linkedRecord); // Same logic
}

/**
 * Check if lesson should be excluded (cancelled)
 */
export function isLessonExcluded(status: string): boolean {
  if (!status) return false;
  // Trim whitespace to handle cases with trailing spaces
  const trimmedStatus = status.trim();
  return trimmedStatus === 'בוטל' || trimmedStatus === 'בוטל ע"י מנהל';
}

/**
 * Check if lesson status is billable (Completed or Scheduled)
 */
export function isBillableStatus(status: string): boolean {
  if (!status) return false;
  // Trim whitespace to handle cases like "מתוכנן " (with trailing space)
  const trimmedStatus = status.trim();
  return trimmedStatus === 'הסתיים' || trimmedStatus === 'מתוכנן' || trimmedStatus === 'בוצע' || trimmedStatus === 'אישר הגעה' || trimmedStatus === 'attended' || trimmedStatus === 'scheduled';
}

/**
 * Check if lesson type is private
 */
export function isPrivateLesson(lessonType: string): boolean {
  if (!lessonType) return false;
  // Trim whitespace to handle cases with trailing spaces
  return lessonType.trim() === 'פרטי';
}

/**
 * Calculate lesson amount
 */
export function calculateLessonAmount(lesson: LessonsAirtableFields): number {
  // Prefer line_amount if present
  if (lesson.line_amount !== undefined && lesson.line_amount !== null) {
    return lesson.line_amount;
  }
  
  // Default: 175 for private lessons
  return 175;
}

/**
 * Calculate lessons contribution
 */
export interface LessonsContribution {
  lessonsTotal: number;
  lessonsCount: number;
}

export function calculateLessonsContribution(
  lessons: LessonsAirtableFields[],
  billingMonth: string,
  targetStudentId: string
): LessonsContribution | MissingFieldsError {
  let lessonsTotal = 0;
  let lessonsCount = 0;
  const missingFields: Array<{
    table: string;
    field: string;
    why_needed: string;
    example_values: string[];
  }> = [];

  // Calculate date range for the billing month (for lessons without billing_month)
  const [year, month] = billingMonth.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
  // Get last day of month: new Date(year, month, 0) gives last day of (month-1)
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const endDate = new Date(year, month - 1, lastDayOfMonth, 23, 59, 59, 999);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  console.log(`[calculateLessonsContribution] Processing ${lessons.length} lessons for student ${targetStudentId}, month ${billingMonth}`);
  
  for (const lesson of lessons) {
    // Check if lesson belongs to billing month
    // First check billing_month field, then fallback to start_datetime
    let belongsToMonth = false;
    
    if (lesson.billing_month === billingMonth) {
      // billing_month matches exactly
      belongsToMonth = true;
    } else if (!lesson.billing_month && lesson.start_datetime) {
      // billing_month not set, check by start_datetime
      const lessonDate = new Date(lesson.start_datetime);
      if (lessonDate >= startDate && lessonDate <= endDate) {
        belongsToMonth = true;
      }
    }
    
    if (!belongsToMonth) {
      console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: not in billing month (billing_month=${lesson.billing_month}, start_datetime=${lesson.start_datetime})`);
      continue;
    }

    // Exclude cancelled lessons
    if (isLessonExcluded(lesson.status)) {
      console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: excluded status (${lesson.status})`);
      continue;
    }

    // Only include billable statuses (Completed or Scheduled)
    if (!isBillableStatus(lesson.status)) {
      console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: not billable status (${lesson.status})`);
      continue;
    }

    // Check if lesson is for this student
    const studentIds = getAllStudentIds(lesson.full_name);
    if (!studentIds.includes(targetStudentId)) {
      console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: not for this student (studentIds=${JSON.stringify(studentIds)}, target=${targetStudentId})`);
      continue; // Lesson not for this student
    }

    // Handle multi-student lessons
    if (hasMultipleStudents(lesson.full_name)) {
      if (isPrivateLesson(lesson.lesson_type)) {
        // Private lesson with multiple students - need split rule
        console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: private lesson with multiple students (need business rule)`);
        missingFields.push({
          table: 'lessons',
          field: 'full_name (multi-link)',
          why_needed: `Private lesson (lesson_type="פרטי") has multiple students linked. Need business rule: how to split the amount? Options: split evenly, charge per student, or disallow multi-student private lessons.`,
          example_values: ['split_evenly', 'charge_per_student', 'disallow'],
        });
        continue; // Skip this lesson until rule is defined
      }
      // For זוגי/קבוצתי: amount is 0, so no split needed
      // Continue to next lesson (these contribute 0 anyway)
      console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: group/pair lesson (amount=0)`);
      continue;
    }

    // Only include private lessons
    if (!isPrivateLesson(lesson.lesson_type)) {
      console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} skipped: not private lesson (lesson_type=${lesson.lesson_type})`);
      continue;
    }
    
    console.log(`[calculateLessonsContribution] Lesson ${lesson.id || 'unknown'} INCLUDED: private lesson, status=${lesson.status}, amount=${calculateLessonAmount(lesson)}`);

    const amount = calculateLessonAmount(lesson);
    lessonsTotal += amount;
    lessonsCount++;
  }

  console.log(`[calculateLessonsContribution] Final result for student ${targetStudentId}: lessonsCount=${lessonsCount}, lessonsTotal=${lessonsTotal}`);

  if (missingFields.length > 0) {
    return new MissingFieldsError(missingFields);
  }

  return { lessonsTotal, lessonsCount };
}

/**
 * Calculate cancellation amount
 * Returns null if charge cannot be determined (should return MISSING_FIELDS)
 */
export function calculateCancellationAmount(
  cancellation: CancellationsAirtableFields,
  linkedLesson?: LessonsAirtableFields
): number | null {
  // Prefer explicit charge if present
  if (cancellation.charge !== undefined && cancellation.charge !== null) {
    return cancellation.charge;
  }

  // If we have a linked lesson, use its lesson_type
  if (linkedLesson) {
    if (isPrivateLesson(linkedLesson.lesson_type)) {
      return 175;
    }
    // For pair/group lessons, charge is 0 unless explicit
    return 0;
  }

  // No linked lesson and no explicit charge - cannot determine
  return null;
}

/**
 * Calculate cancellations contribution
 */
export interface CancellationsContribution {
  cancellationsTotal: number;
  cancellationsCount: number;
  pendingCancellationsCount: number;
}

export function calculateCancellationsContribution(
  cancellations: CancellationsAirtableFields[],
  billingMonth: string,
  getLinkedLesson?: (lessonId: string) => LessonsAirtableFields | undefined
): CancellationsContribution | MissingFieldsError {
  let cancellationsTotal = 0;
  let cancellationsCount = 0;
  let pendingCancellationsCount = 0;
  const missingFields: Array<{
    table: string;
    field: string;
    why_needed: string;
    example_values: string[];
  }> = [];

  for (const cancellation of cancellations) {
    // Only include if billing_month matches
    if (cancellation.billing_month !== billingMonth) {
      continue;
    }

    // Only include if is_lt_24h == 1
    if (cancellation.is_lt_24h !== 1) {
      continue;
    }

    // Check if charged
    if (cancellation.is_charged === false) {
      pendingCancellationsCount++;
      continue;
    }

    // Calculate amount
    const lessonId = extractLessonId(cancellation.lesson);
    const linkedLesson = getLinkedLesson ? getLinkedLesson(lessonId) : undefined;
    const amount = calculateCancellationAmount(cancellation, linkedLesson);

    if (amount === null) {
      // Cannot determine charge
      if (cancellation.charge === undefined || cancellation.charge === null) {
        if (!linkedLesson) {
          // No charge and no linked lesson
          missingFields.push({
            table: 'cancellations',
            field: 'charge or lesson (linked record)',
            why_needed: 'Cannot determine cancellation charge. Either set charge field explicitly, or provide linked lesson to determine charge based on lesson_type',
            example_values: ['175', 'rec123 (lesson ID)'],
          });
        } else {
          // Has linked lesson but still couldn't determine (shouldn't happen, but handle it)
          missingFields.push({
            table: 'cancellations',
            field: 'charge',
            why_needed: 'Cannot determine cancellation charge from linked lesson. Please set charge field explicitly',
            example_values: ['175', '0'],
          });
        }
      }
      continue;
    }

    cancellationsTotal += amount;
    cancellationsCount++;
  }

  if (missingFields.length > 0) {
    return new MissingFieldsError(missingFields);
  }

  return {
    cancellationsTotal,
    cancellationsCount,
    pendingCancellationsCount,
  };
}

/**
 * Get month boundaries in Asia/Jerusalem timezone
 * 
 * Note: For production use, consider using a timezone library like:
 * - date-fns-tz: https://date-fns.org/docs/Time-Zones
 * - luxon: https://moment.github.io/luxon/
 * 
 * This implementation uses UTC dates which should work correctly if:
 * - All dates in Airtable are stored consistently (UTC or local)
 * - Month boundaries are compared correctly
 * 
 * For proper Asia/Jerusalem timezone support with DST handling, use:
 * ```typescript
 * import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
 * const timeZone = 'Asia/Jerusalem';
 * const startOfMonth = zonedTimeToUtc(`${year}-${month}-01 00:00:00`, timeZone);
 * ```
 */
function getMonthBoundaries(billingMonth: string): { start: Date; end: Date } {
  const [year, month] = billingMonth.split('-').map(Number);
  
  // Create dates representing month boundaries
  // Start: first moment of the month (YYYY-MM-01 00:00:00)
  // End: last moment of the month (YYYY-MM-lastDay 23:59:59.999)
  
  // Get last day of month
  const lastDay = new Date(year, month, 0).getDate();
  
  // Create start and end dates
  // Using local time - in production, convert to/from Asia/Jerusalem timezone
  const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(year, month - 1, lastDay, 23, 59, 59, 999);
  
  return { start: startOfMonth, end: endOfMonth };
}

/**
 * Check if subscription is active for a billing month
 * Uses Asia/Jerusalem timezone for month boundaries
 */
export function isSubscriptionActiveForMonth(
  subscription: SubscriptionsAirtableFields,
  billingMonth: string
): boolean {
  // Not active if paused
  if (subscription.pause_subscription === true) {
    return false;
  }

  const { start: startOfMonth, end: endOfMonth } = getMonthBoundaries(billingMonth);

  // Check start date - subscription must start before or at end of billing month
  const startDate = new Date(subscription.subscription_start_date);
  if (startDate > endOfMonth) {
    return false;
  }

  // Check end date (if present) - subscription must end after or at start of billing month
  if (subscription.subscription_end_date) {
    const endDate = new Date(subscription.subscription_end_date);
    if (endDate < startOfMonth) {
      return false;
    }
  }

  return true;
}

/**
 * Parse monthly amount from currency string or number
 */
export function parseMonthlyAmount(amount: string | number): number {
  if (typeof amount === 'number') {
    return isNaN(amount) || amount < 0 ? 0 : amount;
  }

  if (typeof amount === 'string') {
    // Remove currency symbols, commas, whitespace
    const cleaned = amount.replace(/[₪,\s]/g, '').trim();
    if (cleaned === '') {
      return 0;
    }
    const num = parseFloat(cleaned);
    return isNaN(num) || num < 0 ? 0 : num;
  }

  return 0;
}

/**
 * Calculate subscriptions contribution
 */
export interface SubscriptionsContribution {
  subscriptionsTotal: number;
  activeSubscriptionsCount: number;
}

export function calculateSubscriptionsContribution(
  subscriptions: SubscriptionsAirtableFields[],
  billingMonth: string
): SubscriptionsContribution | MissingFieldsError {
  const activeSubscriptions: SubscriptionsAirtableFields[] = [];

  for (const subscription of subscriptions) {
    if (isSubscriptionActiveForMonth(subscription, billingMonth)) {
      activeSubscriptions.push(subscription);
    }
  }

  // Check for overlapping subscriptions
  if (activeSubscriptions.length > 1) {
    // Check if they overlap in time
    const overlapping = activeSubscriptions.some((sub1, i) => {
      return activeSubscriptions.some((sub2, j) => {
        if (i === j) return false;
        
        const start1 = new Date(sub1.subscription_start_date);
        const end1 = sub1.subscription_end_date ? new Date(sub1.subscription_end_date) : new Date('2099-12-31');
        const start2 = new Date(sub2.subscription_start_date);
        const end2 = sub2.subscription_end_date ? new Date(sub2.subscription_end_date) : new Date('2099-12-31');
        
        return (start1 <= end2 && start2 <= end1);
      });
    });

    if (overlapping) {
      return new MissingFieldsError([{
        table: 'Subscriptions',
        field: 'business_rule',
        why_needed: 'Multiple overlapping subscriptions found for the same student and billing month. Need business rule: should we sum them, take max, or prioritize one?',
        example_values: ['sum', 'max', 'priority_by_type'],
      }]);
    }
  }

  let subscriptionsTotal = 0;
  for (const subscription of activeSubscriptions) {
    const amount = parseMonthlyAmount(subscription.monthly_amount);
    subscriptionsTotal += amount;
  }

  return {
    subscriptionsTotal,
    activeSubscriptionsCount: activeSubscriptions.length,
  };
}

/**
 * Calculate total billing amount (no VAT)
 */
export function calculateTotal(
  lessonsTotal: number,
  cancellationsTotal: number,
  subscriptionsTotal: number
): number {
  return lessonsTotal + cancellationsTotal + subscriptionsTotal;
}

/**
 * Determine billing status
 */
export type BillingStatus = 'draft' | 'pending_approval' | 'approved' | 'paid';

export function determineBillingStatus(
  pendingCancellationsCount: number,
  isPaid: boolean
): BillingStatus {
  if (isPaid) {
    return 'paid';
  }

  if (pendingCancellationsCount > 0) {
    return 'pending_approval';
  }

  return 'approved';
}
