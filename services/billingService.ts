/**
 * Billing Service - Monthly billing logic for tutoring system
 * 
 * Rules:
 * - Private (פרטי): 175
 * - Pair (זוגי): 0 (billed via subscription)
 * - Group (קבוצתי): 0 (billed via subscription)
 * - Cancellation <24h: full charge
 * - Cancellation >=24h: no charge
 * - total = lessons_total + cancellations_total + subscriptions_total (no VAT)
 */

/** Dev flag: Jest-safe (no import.meta); Vite sets process.env.NODE_ENV in define. */
const _isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

import { AirtableClient } from './airtableClient';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { getField } from '../contracts/fieldMap';
import { Lesson, Subscription, MonthlyBill } from '../types';
import { LessonStatus } from '../types';
import { buildMonthForAllActiveStudents } from '../billing/billingEngine';

export interface BillingCalculationResult {
  lessonsTotal: number;
  cancellationsTotal: number;
  subscriptionsTotal: number;
  total: number;
  lineItems: Array<{
    id: string;
    description: string;
    amount: number;
    type: 'lesson' | 'cancellation' | 'subscription';
    date?: string;
  }>;
}

export interface MissingFields {
  table: string;
  field: string;
  why_needed: string;
  example_values: string[];
}

/**
 * Check if student has active subscription for a given date
 */
function checkActiveSubscription(
  studentId: string,
  lessonDate: string,
  subscriptions: Subscription[]
): boolean {
  const lessonDateObj = new Date(lessonDate);
  lessonDateObj.setHours(0, 0, 0, 0);
  
  for (const subscription of subscriptions) {
    // בדוק שהמנוי שייך לתלמיד הנכון
    if (subscription.studentId !== studentId) {
      continue;
    }
    
    // בדוק שהמנוי לא מושהה
    if (subscription.pauseSubscription === true) {
      continue;
    }
    
    // בדוק תאריך התחלה
    if (subscription.subscriptionStartDate) {
      const startDate = new Date(subscription.subscriptionStartDate);
      startDate.setHours(0, 0, 0, 0);
      if (startDate > lessonDateObj) {
        continue;  // המנוי עוד לא התחיל
      }
    }
    
    // בדוק תאריך סיום
    if (subscription.subscriptionEndDate) {
      const endDate = new Date(subscription.subscriptionEndDate);
      endDate.setHours(0, 0, 0, 0);
      if (endDate < lessonDateObj) {
        continue;  // המנוי פג תוקף
      }
    }
    
    // המנוי פעיל!
    return true;
  }
  
  // לא נמצא מנוי פעיל
  return false;
}

/**
 * Pure function: Calculate lesson price based on type and duration
 * Private: 175 (proportional) or lesson price. Pair: 0 with subscription; else pairTotalPrice/2 or 112.5. Group: 0 with subscription; else 120.
 */
export function calculateLessonPrice(
  lessonType: string | undefined | null,
  duration?: number,
  studentId?: string,
  subscriptions?: Subscription[],
  lessonDate?: string,
  pairTotalPrice?: number
): number {
  const normalized = (lessonType || '').toLowerCase().trim();

  if (normalized === 'private' || normalized === 'פרטי') {
    const minutes = duration || 60;
    return Math.round((minutes / 60) * 175 * 100) / 100;
  }

  if (normalized === 'group' || normalized === 'קבוצתי') {
    if (studentId && subscriptions && subscriptions.length > 0) {
      const dateToCheck = lessonDate || new Date().toISOString().split('T')[0];
      const hasActiveSubscription = checkActiveSubscription(
        studentId,
        dateToCheck,
        subscriptions
      );
      if (hasActiveSubscription) return 0;
    }
    return 120;
  }

  if (normalized === 'pair' || normalized === 'זוגי') {
    if (studentId && subscriptions && subscriptions.length > 0) {
      const dateToCheck = lessonDate || new Date().toISOString().split('T')[0];
      const hasActiveSubscription = checkActiveSubscription(
        studentId,
        dateToCheck,
        subscriptions
      );
      if (hasActiveSubscription) return 0;
    }
    if (pairTotalPrice !== undefined && pairTotalPrice !== null && pairTotalPrice >= 0) {
      return Math.round((pairTotalPrice / 2) * 100) / 100;
    }
    return 112.5;
  }

  const minutes = duration || 60;
  return Math.round((minutes / 60) * 175 * 100) / 100;
}

/**
 * Pure function: Check if cancellation is billable (<24h before lesson)
 * Returns true if cancellation should be charged
 */
export function isCancellationBillable(
  lessonStartDatetime: string,
  cancellationDatetime?: string | null
): boolean {
  if (!cancellationDatetime) {
    // If no cancellation time provided, assume not billable
    // This might need adjustment based on business rules
    return false;
  }

  const lessonStart = new Date(lessonStartDatetime);
  const cancellationTime = new Date(cancellationDatetime);
  
  // Calculate difference in milliseconds
  const diffMs = lessonStart.getTime() - cancellationTime.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // Billable if cancelled less than 24 hours before lesson
  return diffHours < 24;
}

/**
 * Pure function: Calculate cancellation charge
 */
export function calculateCancellationCharge(
  lessonStartDatetime: string,
  lessonType: string | undefined | null,
  cancellationDatetime?: string | null,
  duration?: number,
  studentId?: string,
  subscriptions?: Subscription[]
): number {
  if (!isCancellationBillable(lessonStartDatetime, cancellationDatetime)) {
    return 0;
  }
  
  // Extract date from lessonStartDatetime
  const lessonDate = lessonStartDatetime.split('T')[0];
  
  // Full charge for billable cancellations
  return calculateLessonPrice(
    lessonType, 
    duration,
    studentId,
    subscriptions,
    lessonDate
  );
}

/**
 * Pure function: Calculate billing month string (YYYY-MM format)
 */
export function getBillingMonth(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Pure function: Generate deterministic billing key
 */
export function generateBillingKey(studentRecordId: string, billingMonth: string): string {
  return `${studentRecordId}_${billingMonth}`;
}

/**
 * Extended Lesson type with optional cancellation datetime
 */
export interface LessonWithCancellation extends Lesson {
  cancellationDatetime?: string | null;
  rawFields?: any; // Raw Airtable fields for accessing unmapped fields
}

/**
 * Pure function: Calculate billing for a single student
 */
export function calculateStudentBilling(
  lessons: (Lesson | LessonWithCancellation)[],
  subscriptions: Subscription[],
  studentId: string,
  billingMonth: string
): BillingCalculationResult {
  // Filter lessons for this student and month
  const monthLessons = lessons.filter(lesson => {
    if (lesson.studentId !== studentId) return false;
    
    const lessonMonth = getBillingMonth(lesson.date);
    return lessonMonth === billingMonth;
  });

  // Filter subscriptions for this student that are active in the billing month
  const monthSubscriptions = subscriptions.filter(sub => {
    if (sub.studentId !== studentId) return false;
    if (sub.pauseSubscription) return false;
    
    // Check if subscription is active during the billing month
    const billingDate = new Date(`${billingMonth}-01`);
    const billingYear = billingDate.getFullYear();
    const billingMonthNum = billingDate.getMonth() + 1;
    
    if (sub.subscriptionStartDate) {
      const startDate = new Date(sub.subscriptionStartDate);
      if (startDate.getFullYear() > billingYear || 
          (startDate.getFullYear() === billingYear && startDate.getMonth() + 1 > billingMonthNum)) {
        return false;
      }
    }
    
    if (sub.subscriptionEndDate) {
      const endDate = new Date(sub.subscriptionEndDate);
      if (endDate.getFullYear() < billingYear || 
          (endDate.getFullYear() === billingYear && endDate.getMonth() + 1 < billingMonthNum)) {
        return false;
      }
    }
    
    return true;
  });

  const lineItems: BillingCalculationResult['lineItems'] = [];
  let lessonsTotal = 0;
  let cancellationsTotal = 0;

  // Process lessons
  for (const lesson of monthLessons) {
    // Handle cancelled lessons
    if (lesson.status === LessonStatus.CANCELLED) {
      // Extract cancellation datetime from lesson (check multiple possible field names)
      let cancellationDatetime: string | null | undefined = null;
      
      if ('cancellationDatetime' in lesson && lesson.cancellationDatetime) {
        cancellationDatetime = lesson.cancellationDatetime;
      } else if ('rawFields' in lesson && lesson.rawFields) {
        // Try to get from raw Airtable fields
        const raw = lesson.rawFields;
        cancellationDatetime = raw.cancellation_datetime || 
                              raw.cancellationDatetime || 
                              raw.Cancellation_Datetime ||
                              raw['תאריך ביטול'] ||
                              null;
      }
      
      // Check if cancellation is billable
      const lessonStartDatetime = lesson.date && lesson.startTime 
        ? `${lesson.date}T${lesson.startTime}:00` 
        : '';
      
      const cancellationCharge = calculateCancellationCharge(
        lessonStartDatetime,
        lesson.lessonType,
        cancellationDatetime,
        lesson.duration,
        lesson.studentId,
        subscriptions
      );
      
      if (cancellationCharge > 0) {
        cancellationsTotal += cancellationCharge;
        lineItems.push({
          id: `cancel_${lesson.id}`,
          description: `ביטול שיעור ${lesson.date} ${lesson.startTime}`,
          amount: cancellationCharge,
          type: 'cancellation',
          date: lesson.date,
        });
      }
    } else if (lesson.status === LessonStatus.COMPLETED || lesson.status === LessonStatus.SCHEDULED) {
      const normalizedType = (lesson.lessonType || '').toLowerCase().trim();
      const isPair = normalizedType === 'pair' || normalizedType === 'זוגי';
      const isGroup = normalizedType === 'group' || normalizedType === 'קבוצתי';
      const price = isPair
        ? calculateLessonPrice(lesson.lessonType, lesson.duration, lesson.studentId, subscriptions, lesson.date, lesson.price)
        : isGroup
          ? calculateLessonPrice(lesson.lessonType, lesson.duration, lesson.studentId, subscriptions, lesson.date)
          : (lesson.price !== undefined ? lesson.price : calculateLessonPrice(lesson.lessonType, lesson.duration, lesson.studentId, subscriptions, lesson.date));
      
      if (price > 0) {
        lessonsTotal += price;
        lineItems.push({
          id: `lesson_${lesson.id}`,
          description: `שיעור ${lesson.lessonType === 'private' || lesson.lessonType === 'פרטי' ? 'פרטי' : lesson.lessonType} ${lesson.date} ${lesson.startTime}`,
          amount: price,
          type: 'lesson',
          date: lesson.date,
        });
      }
    }
  }

  // Process subscriptions
  let subscriptionsTotal = 0;
  for (const subscription of monthSubscriptions) {
    // Parse monthly amount (handles currency strings like "₪480.00")
    const amountStr = subscription.monthlyAmount || '';
    const amount = parseSubscriptionAmount(amountStr);
    
    if (amount > 0) {
      subscriptionsTotal += amount;
      lineItems.push({
        id: `sub_${subscription.id}`,
        description: `מנוי ${subscription.subscriptionType || ''}`,
        amount: amount,
        type: 'subscription',
      });
    }
  }

  const total = lessonsTotal + cancellationsTotal + subscriptionsTotal;

  return {
    lessonsTotal,
    cancellationsTotal,
    subscriptionsTotal,
    total,
    lineItems,
  };
}

/**
 * Pure function: Parse subscription amount from currency string
 */
export function parseSubscriptionAmount(amount: string | number | undefined | null): number {
  if (amount === null || amount === undefined) {
    return 0;
  }

  if (typeof amount === 'number') {
    return isNaN(amount) || amount < 0 ? 0 : amount;
  }

  if (typeof amount === 'string') {
    // Remove currency symbols (₪), commas, and whitespace
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
 * Validate required Airtable fields exist
 * Returns MISSING_FIELDS if any required fields are missing
 */
export async function validateBillingFields(
  client: AirtableClient
): Promise<MissingFields[] | null> {
  const missing: MissingFields[] = [];

  try {
    // Check lessons table for required fields
    const lessonsTableId = client.getTableId('lessons');
    const sampleLessons = await client.getRecords(lessonsTableId, { maxRecords: 1 });
    
    if (sampleLessons.length > 0) {
      const fields = Object.keys(sampleLessons[0].fields);
      
      // Check for lesson type field (needed for pricing)
      const hasLessonType = fields.some(f => 
        f.toLowerCase().includes('type') || 
        f.includes('סוג') ||
        f === 'Lesson_Type' ||
        f === 'lesson_type'
      );
      
      if (!hasLessonType) {
        missing.push({
          table: 'lessons',
          field: 'lesson_type (or Lesson_Type)',
          why_needed: 'Required to determine lesson pricing (Private=175, Pair/Group=0)',
          example_values: ['פרטי', 'זוגי', 'קבוצתי', 'private', 'pair', 'group'],
        });
      }

      // Check for cancellation datetime field (needed for <24h rule)
      const hasCancellationDatetime = fields.some(f =>
        f.toLowerCase().includes('cancellation') ||
        f.toLowerCase().includes('cancel') ||
        f.includes('ביטול')
      );
      
      if (!hasCancellationDatetime) {
        missing.push({
          table: 'lessons',
          field: 'cancellation_datetime (or cancellation_datetime)',
          why_needed: 'Required to determine if cancellation is billable (<24h before lesson)',
          example_values: ['2024-03-15T10:00:00', '2024-03-15 10:00:00'],
        });
      }
    }

    // Check subscriptions table
    const subscriptionsTableId = client.getTableId('subscriptions');
    const sampleSubscriptions = await client.getRecords(subscriptionsTableId, { maxRecords: 1 });
    
    if (sampleSubscriptions.length > 0) {
      const fields = Object.keys(sampleSubscriptions[0].fields);
      
      // Check for monthly_amount field
      const hasMonthlyAmount = fields.some(f =>
        f.toLowerCase().includes('monthly') && f.toLowerCase().includes('amount') ||
        f.includes('חודשי')
      );
      
      if (!hasMonthlyAmount) {
        missing.push({
          table: 'subscriptions',
          field: 'monthly_amount (or Monthly_Amount)',
          why_needed: 'Required to calculate subscription billing amount',
          example_values: ['₪480.00', '480', '480.00'],
        });
      }
    }

    // Check for billing table
    try {
      const billingTableId = client.getTableId('monthlyBills');
      const sampleBills = await client.getRecords(billingTableId, { maxRecords: 1 });
      
      if (sampleBills.length > 0) {
        const fields = Object.keys(sampleBills[0].fields);
        
        // Check for billing_key field (for idempotency)
        const hasBillingKey = fields.some(f =>
          f.toLowerCase().includes('billing_key') ||
          f.toLowerCase().includes('idempotency')
        );
        
        if (!hasBillingKey) {
          missing.push({
            table: 'monthlyBills',
            field: 'billing_key (or idempotency_key)',
            why_needed: 'Required for idempotent billing (one record per student_id + billing_month)',
            example_values: ['rec123_2024-03', 'student123_2024-03'],
          });
        }

        // Check for student_id field
        const hasStudentId = fields.some(f =>
          f.toLowerCase().includes('student') && f.toLowerCase().includes('id')
        );
        
        if (!hasStudentId) {
          missing.push({
            table: 'monthlyBills',
            field: 'student_id (or Student_ID)',
            why_needed: 'Required to link billing record to student',
            example_values: ['rec123', 'rec456'],
          });
        }

        // Check for billing_month field
        const hasBillingMonth = fields.some(f =>
          f.toLowerCase().includes('month') ||
          f.includes('חודש')
        );
        
        if (!hasBillingMonth) {
          missing.push({
            table: 'monthlyBills',
            field: 'billing_month (or Billing_Month)',
            why_needed: 'Required to identify which month the bill is for',
            example_values: ['2024-03', '2024-04'],
          });
        }
      }
    } catch (error) {
      // Table might not exist
      missing.push({
        table: 'monthlyBills',
        field: 'table_does_not_exist',
        why_needed: 'Required table for storing monthly billing records',
        example_values: ['Create table with fields: billing_key, student_id, billing_month, lessons_total, cancellations_total, subscriptions_total, total'],
      });
    }

  } catch (error) {
    // If we can't validate, return null (assume fields exist)
    console.warn('Could not validate billing fields:', error);
    return null;
  }

  return missing.length > 0 ? missing : null;
}

/**
 * Generate or update monthly bill for a student
 * Idempotent: returns existing bill if billingKey already exists
 */
export async function generateMonthlyBill(
  client: AirtableClient,
  studentId: string,
  studentName: string,
  billingMonth: string,
  lessons: (Lesson | LessonWithCancellation)[],
  subscriptions: Subscription[]
): Promise<MonthlyBill> {
  // Validate fields first
  const missingFields = await validateBillingFields(client);
  if (missingFields) {
    throw {
      MISSING_FIELDS: missingFields,
    };
  }

  // Generate billing key
  const billingKey = generateBillingKey(studentId, billingMonth);

  // Check if bill already exists (idempotency)
  const billingTableId = client.getTableId('monthlyBills');
  
  // Try to find existing bill by billing_key
  let existingBill = null;
  try {
    const existingRecords = await client.getRecords(billingTableId, {
      filterByFormula: `{billing_key} = "${billingKey}"`,
      maxRecords: 1,
    });
    
    if (existingRecords.length > 0) {
      existingBill = existingRecords[0];
    }
  } catch (error) {
    // Field might be named differently, try alternative
    try {
      const allRecords = await client.getRecords(billingTableId, { maxRecords: 100 });
      const found = allRecords.find(r => {
        const fields = r.fields as any;
        return (fields.billing_key === billingKey || 
                fields.idempotency_key === billingKey ||
                fields.Billing_Key === billingKey);
      });
      if (found) {
        existingBill = found;
      }
    } catch (e) {
      // Continue to create new bill
    }
  }

  // Calculate billing
  const calculation = calculateStudentBilling(lessons, subscriptions, studentId, billingMonth);

  // Prepare Airtable fields
  const fields: any = {
    billing_key: billingKey,
    student_id: [studentId], // Linked record
    student_name: studentName,
    billing_month: billingMonth,
    lessons_total: calculation.lessonsTotal,
    cancellations_total: calculation.cancellationsTotal,
    subscriptions_total: calculation.subscriptionsTotal,
    total: calculation.total,
    status: existingBill ? (existingBill.fields as any).status || 'draft' : 'draft',
  };

  if (existingBill) {
    // Update existing bill
    const updated = await client.updateRecord(billingTableId, existingBill.id, fields);
    
    return {
      id: updated.id,
      studentId,
      studentName,
      month: billingMonth,
      lessonsAmount: calculation.lessonsTotal,
      subscriptionsAmount: calculation.subscriptionsTotal,
      adjustmentAmount: 0, // Manual adjustments handled separately
      totalAmount: calculation.total,
      status: (updated.fields as any).status || 'draft',
      lineItems: calculation.lineItems,
    };
  } else {
    // Create new bill
    const created = await client.createRecord(billingTableId, fields);
    
    return {
      id: created.id,
      studentId,
      studentName,
      month: billingMonth,
      lessonsAmount: calculation.lessonsTotal,
      subscriptionsAmount: calculation.subscriptionsTotal,
      adjustmentAmount: 0,
      totalAmount: calculation.total,
      status: 'draft',
      lineItems: calculation.lineItems,
    };
  }
}

/**
 * Fetch lessons with cancellation datetime from Airtable
 * This ensures we have all necessary fields for billing calculation
 */
export async function fetchLessonsForBilling(
  client: AirtableClient,
  startDate: string,
  endDate: string
): Promise<LessonWithCancellation[]> {
  const lessonsTableId = client.getTableId('lessons');
  
  // Build filter for date range
  const filterFormula = `AND(
    IS_AFTER({start_datetime}, "${startDate}"),
    IS_BEFORE({start_datetime}, "${endDate}")
  )`;
  
  const records = await client.getRecords(lessonsTableId, {
    filterByFormula: filterFormula,
    pageSize: 100,
  });

  // Map to LessonWithCancellation, preserving raw fields
  return records.map(record => {
    const fields = record.fields as any;
    
    // Extract cancellation datetime from various possible field names
    const cancellationDatetime = fields.cancellation_datetime ||
                                fields.cancellationDatetime ||
                                fields.Cancellation_Datetime ||
                                fields['תאריך ביטול'] ||
                                null;

    // Map basic lesson fields (simplified - you may want to use your existing mapper)
    const startDatetime = fields.start_datetime || '';
    const date = startDatetime ? startDatetime.split('T')[0] : '';
    const startTime = startDatetime ? startDatetime.split('T')[1]?.substring(0, 5) : '';
    
    return {
      id: record.id,
      studentId: fields.Student?.[0] || fields.student_id || '',
      studentName: fields.Student_Name || fields.student_name || '',
      date,
      startTime,
      duration: 60, // Default or calculate from end_datetime
      status: fields.status || 'מתוכנן',
      subject: fields.Subject || 'מתמטיקה',
      isChargeable: fields.Is_Chargeable !== false,
      isPrivate: fields.Is_Private !== false,
      lessonType: fields.Lesson_Type || fields.lesson_type || 'private',
      cancellationDatetime,
      rawFields: fields, // Preserve raw fields for additional access
    } as LessonWithCancellation;
  });
}

/**
 * Generate monthly bills for all students
 */
export async function generateAllMonthlyBills(
  client: AirtableClient,
  billingMonth: string,
  lessons: (Lesson | LessonWithCancellation)[],
  subscriptions: Subscription[],
  students: Array<{ id: string; name: string }>
): Promise<MonthlyBill[]> {
  const bills: MonthlyBill[] = [];
  const errors: Array<{ studentId: string; error: any }> = [];

  for (const student of students) {
    try {
      const bill = await generateMonthlyBill(
        client,
        student.id,
        student.name,
        billingMonth,
        lessons,
        subscriptions
      );
      bills.push(bill);
    } catch (error: any) {
      if (error.MISSING_FIELDS) {
        // Re-throw missing fields error immediately
        throw error;
      }
      errors.push({ studentId: student.id, error });
      console.error(`Failed to generate bill for student ${student.id}:`, error);
    }
  }

  if (errors.length > 0) {
    console.warn(`Generated ${bills.length} bills, ${errors.length} errors`);
  }

  return bills;
}

/**
 * Create Monthly Charges - Idempotent charge creation
 * 
 * For a given billingMonth (YYYY-MM), create exactly one charge record per student with billable lessons
 * in Airtable table "חיובים". This action is idempotent: running it multiple times will NOT
 * create duplicates.
 * 
 * Logic:
 * 1) Fetch lessons where billing_month == selectedMonth
 * 2) Keep only lessons where (billable OR is_billable) is truthy
 * 3) Group by studentRecordId = first(fields["תלמידים"])
 * 4) Compute studentTotal = sum(line_amount) (fallback to unit_price if line_amount missing)
 * 5) For each student: Upsert into "חיובים" by (id=studentRecordId AND חודש חיוב=selectedMonth)
 * 
 * @param client - AirtableClient instance
 * @param billingMonth - Billing month in YYYY-MM format
 * @returns Summary with createdCount, skippedCount, billingMonth
 */
export interface CreateMonthlyChargesResult {
  createdCount: number;
  skippedCount: number;
  billingMonth: string;
  errors?: Array<{ studentId: string; error: string }>;
}

export interface ChargeTableSchema {
  studentField: string; // Field name for student link (e.g., "id" or "תלמיד")
  studentFieldIsArray: boolean; // Whether the student field expects array format
  billingMonthField: string; // Field name for billing month (e.g., "חודש חיוב")
  approvedField: string; // Field name for approval flag (e.g., "מאושר לחיוב")
  linkSentField: string; // Field name for link sent flag (e.g., "נשלח קישור")
  paidField: string; // Field name for paid flag (e.g., "שולם")
}

/**
 * Discover the schema of the "חיובים" table by querying multiple records to find all field names
 */
export async function discoverChargeTableSchema(
  client: AirtableClient
): Promise<ChargeTableSchema | MissingFields[]> {
  const billingTableId = client.getTableId('monthlyBills');
  
  try {
    // Get up to 100 records to ensure we find checkbox fields even if some are false
    const records = await client.getRecords(billingTableId, { maxRecords: 100 });
    
    // Helper to log string with character codes for invisible char detection
    const logStringDetailed = (str: string) => {
      const codes = Array.from(str).map(c => c.charCodeAt(0)).join(',');
      return `"${str}" [codes: ${codes}]`;
    };

    // Known field names from config or actual schema (used as fallback)
    const KNOWN_STUDENT_FIELD = AIRTABLE_CONFIG.fields.billingStudent || 'full_name';
    const KNOWN_BILLING_MONTH_FIELD = AIRTABLE_CONFIG.fields.billingMonth || 'חודש חיוב';
    const KNOWN_APPROVED_FIELD = AIRTABLE_CONFIG.fields.billingApproved || 'מאושר לחיוב';
    const KNOWN_LINK_SENT_FIELD = AIRTABLE_CONFIG.fields.billingLinkSent || 'נשלח קישור';
    const KNOWN_PAID_FIELD = AIRTABLE_CONFIG.fields.billingPaid || 'שולם';
    
    if (records.length === 0) {
      return {
        studentField: KNOWN_STUDENT_FIELD,
        studentFieldIsArray: true,
        billingMonthField: KNOWN_BILLING_MONTH_FIELD,
        approvedField: KNOWN_APPROVED_FIELD,
        linkSentField: KNOWN_LINK_SENT_FIELD,
        paidField: KNOWN_PAID_FIELD,
      };
    }
    
    // Aggregate all unique field names from the records
    // CRITICAL: Normalize all keys to NFC to handle Hebrew encoding variations correctly
    const rawFields = new Set<string>();
    records.forEach(r => {
      Object.keys(r.fields).forEach(f => rawFields.add(f));
    });
    
    const fields = Array.from(rawFields);
    const normalizedFieldsMap = new Map<string, string>(); // normalized -> raw
    fields.forEach(f => normalizedFieldsMap.set(f.normalize('NFC').trim(), f));
    
    const normalizedFieldsList = Array.from(normalizedFieldsMap.keys());
    
    // Helper to find boolean-like fields (checkboxes)
    const getBooleanFields = () => {
      return normalizedFieldsList.filter(f => {
        const rawKey = normalizedFieldsMap.get(f)!;
        return records.some(r => {
          const val = (r.fields as any)[rawKey];
          // Check for explicit boolean OR null (checkboxes are null when false)
          // but we only include it if it's explicitly null/boolean in some records
          return typeof val === 'boolean' || val === 1 || val === 0 || val === null;
        });
      });
    };

    const booleanFields = getBooleanFields();

    if (_isDev) {
      console.log('--- AIRTABLE SCHEMA DIAGNOSTIC (חיובים) ---');
      console.log('Total unique fields found in', records.length, 'records:', fields.length);
      console.log('All available fields (normalized):', normalizedFieldsList.map(f => logStringDetailed(f)));
      console.log('Fields with boolean/null values:', booleanFields);
      console.log('------------------------------------------');
    }
    
    const findExactRawField = (searchTerms: string[], fallback: string): string => {
      // 1. Try exact match on normalized names
      for (const term of searchTerms) {
        const normalizedTerm = term.normalize('NFC').trim();
        if (normalizedFieldsMap.has(normalizedTerm)) {
          return normalizedFieldsMap.get(normalizedTerm)!;
        }
      }
      
      // 2. Try fuzzy match on normalized names
      const found = normalizedFieldsList.find(f => 
        searchTerms.some(term => {
          const normTerm = term.normalize('NFC').trim().toLowerCase();
          return f.toLowerCase().includes(normTerm);
        })
      );
      
      if (found) return normalizedFieldsMap.get(found)!;
      
      // 3. Fallback
      return fallback;
    };

    // Find student link field
    let rawStudentField = findExactRawField([KNOWN_STUDENT_FIELD, 'id', 'תלמיד', 'student'], KNOWN_STUDENT_FIELD);
    let studentFieldIsArray = false;
    
    // Check if the found field uses array format
    const recordWithStudent = records.find(r => (r.fields as any)[rawStudentField]);
    if (recordWithStudent) {
      studentFieldIsArray = Array.isArray((recordWithStudent.fields as any)[rawStudentField]);
    } else {
      // Fallback detection if primary search failed
      for (const r of records) {
        const rFields = r.fields as any;
        for (const rawKey of Object.keys(rFields)) {
          const value = rFields[rawKey];
          if (typeof value === 'string' && value.startsWith('rec')) {
            rawStudentField = rawKey;
            studentFieldIsArray = false;
            break;
          } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string' && value[0].startsWith('rec')) {
            rawStudentField = rawKey;
            studentFieldIsArray = true;
            break;
          }
        }
        if (rawStudentField !== KNOWN_STUDENT_FIELD) break;
      }
    }
    
    // Find billing month field
    let rawBillingMonthField = findExactRawField([KNOWN_BILLING_MONTH_FIELD, 'חודש חיוב', 'month', 'חודש'], KNOWN_BILLING_MONTH_FIELD);
    
    // Find approval field - prioritize boolean fields
    const potentialApproved = booleanFields.find(f => f.includes('מאושר') && !f.includes('נשלח') && !f.includes('שולם'));
    let rawApprovedField = potentialApproved ? normalizedFieldsMap.get(potentialApproved)! : 
                          findExactRawField([KNOWN_APPROVED_FIELD, 'approved', 'מאושר'], KNOWN_APPROVED_FIELD);

    // Find link sent field
    const potentialLink = booleanFields.find(f => f.includes('נשלח') || f.includes('קישור'));
    let rawLinkSentField = potentialLink ? normalizedFieldsMap.get(potentialLink)! :
                          findExactRawField([KNOWN_LINK_SENT_FIELD, 'נשלח קישור', 'link', 'נשלח', 'קישור'], KNOWN_LINK_SENT_FIELD);
    
    // Find paid field
    const potentialPaid = booleanFields.find(f => f.includes('שולם') && !f.includes('מאושר'));
    let rawPaidField = potentialPaid ? normalizedFieldsMap.get(potentialPaid)! :
                      findExactRawField([KNOWN_PAID_FIELD, 'paid', 'שולם'], KNOWN_PAID_FIELD);
    
    if (_isDev) {
      console.log('[discoverChargeTableSchema] Discovered Raw Schema Mapping:', {
        studentField: logStringDetailed(rawStudentField),
        billingMonthField: logStringDetailed(rawBillingMonthField),
        approvedField: logStringDetailed(rawApprovedField),
        linkSentField: logStringDetailed(rawLinkSentField),
        paidField: logStringDetailed(rawPaidField),
      });
    }
    
    return {
      studentField: rawStudentField,
      studentFieldIsArray,
      billingMonthField: rawBillingMonthField,
      approvedField: rawApprovedField,
      linkSentField: rawLinkSentField,
      paidField: rawPaidField,
    };
  } catch (error: any) {
    // If we can't access the table, return missing fields error
    return [{
      table: 'חיובים',
      field: 'table_access',
      why_needed: 'Cannot access חיובים table to discover schema',
      example_values: ['Check table ID and API permissions'],
    }];
  }
}

/**
 * Check if a student is eligible for billing in the given month
 * Preferred: check numeric field on student representing billable total
 * Fallback: query lessons for that month and count billable lessons
 */
async function isStudentEligible(
  client: AirtableClient,
  studentId: string,
  billingMonth: string
): Promise<boolean> {
  const studentsTableId = client.getTableId('students');
  const lessonsTableId = client.getTableId('lessons');
  
  try {
    // Get student record
    const student = await client.getRecord(studentsTableId, studentId);
    const studentFields = student.fields as any;
    
    // Preferred: Check for numeric field representing billable total for the month
    // Look for fields like "חיוב חודשי", "כולל מע\"מ ומנויים", or similar
    const possibleBillableFields = [
      'חיוב חודשי',
      'כולל מע"מ ומנויים',
      'monthly_billing',
      'billing_total',
      'חיוב',
    ];
    
    for (const fieldName of possibleBillableFields) {
      if (studentFields[fieldName] !== undefined) {
        const value = studentFields[fieldName];
        // Check if it's a number > 0
        if (typeof value === 'number' && value > 0) {
          return true;
        }
        // Check if it's a string that can be parsed as a number
        if (typeof value === 'string') {
          const num = parseFloat(value.replace(/[₪,\s]/g, ''));
          if (!isNaN(num) && num > 0) {
            return true;
          }
        }
      }
    }
    
    // Fallback: Query lessons for this student in the billing month
    // Calculate date range for the billing month
    const [year, month] = billingMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Query lessons for this student in the billing month
    // Note: full_name is the linked record field in lessons table
    const lessonsFilter = `AND(
      {full_name} = "${studentId}",
      IS_AFTER({start_datetime}, "${startDateStr}"),
      IS_BEFORE({start_datetime}, "${endDateStr}T23:59:59")
    )`;
    
    const lessons = await client.getRecords(lessonsTableId, {
      filterByFormula: lessonsFilter,
      maxRecords: 1000,
    });
    
    // Check if there are any billable lessons
    // A lesson is billable if:
    // 1. It's a private lesson (פרטי) - these are charged at 175
    // 2. It's a completed or scheduled lesson (not cancelled or pending)
    // 3. Or it's a cancelled lesson with <24h cancellation (billable cancellation)
    
    for (const lessonRecord of lessons) {
      const lessonFields = lessonRecord.fields as any;
      const lessonType = lessonRecord.fields.lesson_type || lessonFields.Lesson_Type || '';
      const status = lessonFields.status || '';
      
      // Private lessons are billable
      if (lessonType === 'פרטי' || lessonType === 'private') {
        if (status === 'הסתיים' || status === 'מתוכנן' || status === 'completed' || status === 'scheduled') {
          return true;
        }
        // Check for billable cancellation
        if (status === 'בוטל' || status === 'cancelled') {
          // This would require checking cancellation datetime, but for simplicity,
          // if there's a cancelled private lesson, consider it potentially billable
          return true;
        }
      }
    }
    
    // Also check subscriptions - if student has active subscription, they're eligible
    const subscriptionsTableId = client.getTableId('subscriptions');
    const subscriptionsFilter = `{student_id} = "${studentId}"`;
    const subscriptions = await client.getRecords(subscriptionsTableId, {
      filterByFormula: subscriptionsFilter,
      maxRecords: 100,
    });
    
    for (const subRecord of subscriptions) {
      const subFields = subRecord.fields as any;
      if (subFields.pause_subscription === true || subFields.pause_subscription === 1) {
        continue;
      }
      
      // Check if subscription is active during billing month
      const subStart = subFields.subscription_start_date;
      const subEnd = subFields.subscription_end_date;
      
      if (subStart) {
        const startDate = new Date(subStart);
        if (startDate.getFullYear() > year || (startDate.getFullYear() === year && startDate.getMonth() + 1 > month)) {
          continue;
        }
      }
      
      if (subEnd) {
        const endDate = new Date(subEnd);
        if (endDate.getFullYear() < year || (endDate.getFullYear() === year && endDate.getMonth() + 1 < month)) {
          continue;
        }
      }
      
      // Subscription is active - check if it has a monthly amount
      const monthlyAmount = subFields.monthly_amount;
      if (monthlyAmount) {
        const amount = typeof monthlyAmount === 'number' 
          ? monthlyAmount 
          : parseFloat(String(monthlyAmount).replace(/[₪,\s]/g, ''));
        if (!isNaN(amount) && amount > 0) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    // If we can't determine eligibility, assume not eligible to be safe
    console.warn(`Could not determine eligibility for student ${studentId}:`, error);
    return false;
  }
}

/**
 * Extract first student record ID from תלמידים field
 */
function firstStudentId(תלמידיםField: any): string | null {
  if (!תלמידיםField) {
    return null;
  }
  
  // Handle array of record IDs
  if (Array.isArray(תלמידיםField)) {
    if (תלמידיםField.length === 0) {
      return null;
    }
    const first = תלמידיםField[0];
    // Could be string (record ID) or object with id property
    if (typeof first === 'string') {
      return first;
    } else if (first && typeof first === 'object' && first.id) {
      return first.id;
    }
  }
  
  // Handle single string record ID
  if (typeof תלמידיםField === 'string') {
    return תלמידיםField;
  }
  
  // Handle object with id property
  if (תלמידיםField && typeof תלמידיםField === 'object' && תלמידיםField.id) {
    return תלמידיםField.id;
  }
  
  return null;
}

/**
 * Extract numeric value from line_amount or unit_price
 */
function extractAmount(lessonFields: any): number {
  // Try line_amount first
  if (lessonFields.line_amount !== undefined && lessonFields.line_amount !== null) {
    const value = lessonFields.line_amount;
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[₪,\s]/g, ''));
      if (!isNaN(num)) {
        return num;
      }
    }
  }
  
  // Fallback to unit_price
  if (lessonFields.unit_price !== undefined && lessonFields.unit_price !== null) {
    const value = lessonFields.unit_price;
    if (typeof value === 'number' && !isNaN(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[₪,\s]/g, ''));
      if (!isNaN(num)) {
        return num;
      }
    }
  }
  
  // If neither is available, return 0
  return 0;
}

/**
 * Check if lesson is billable
 */
function isBillable(lessonFields: any): boolean {
  // Check billable field
  if (lessonFields.billable !== undefined && lessonFields.billable !== null) {
    if (lessonFields.billable === true || lessonFields.billable === 1) {
      return true;
    }
    if (lessonFields.billable === false || lessonFields.billable === 0) {
      return false;
    }
  }
  
  // Check is_billable field
  if (lessonFields.is_billable !== undefined && lessonFields.is_billable !== null) {
    if (lessonFields.is_billable === true || lessonFields.is_billable === 1) {
      return true;
    }
    if (lessonFields.is_billable === false || lessonFields.is_billable === 0) {
      return false;
    }
  }
  
  // If neither field exists or both are falsy, consider not billable
  return false;
}

export async function createMonthlyCharges(
  client: AirtableClient,
  billingMonth: string
): Promise<CreateMonthlyChargesResult> {
  // Validate billingMonth format
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    throw new Error(`Invalid billingMonth format: ${billingMonth}. Expected YYYY-MM`);
  }
  
  try {
    console.log(`[createMonthlyCharges] Starting billing creation for ${billingMonth} using BillingEngine`);
    
    // Use the robust billing engine instead of the simple logic
    const result = await buildMonthForAllActiveStudents(client, billingMonth, false);
    
    return {
      createdCount: result.summary.chargesCreated,
      skippedCount: result.summary.chargesSkipped,
      billingMonth,
      errors: result.errors.map(e => ({
        studentId: e.studentId,
        error: e.error.message
      }))
    };
  } catch (error: any) {
    console.error(`[createMonthlyCharges] Failed to create charges:`, error);
    throw error;
  }
}

/**
 * Charges Report - Query and format charge records from "חיובים" table
 * 
 * Data source: Airtable table "חיובים" (charges table)
 * Do NOT compute charges from lessons - use lookup fields from charges table
 */

export type ChargesReportStatusFilter = 'all' | 'draft' | 'sent' | 'paid' | 'link_sent';

export interface ChargesReportInput {
  billingMonth: string; // YYYY-MM format
  statusFilter: ChargesReportStatusFilter;
  searchQuery?: string; // Optional search string for student/parent name
  pageSize?: number; // Optional page size for paging
  offset?: string; // Optional offset for paging
}

export interface ChargeReportRow {
  chargeRecordId: string;
  studentRecordId: string;
  displayName: string; // Student/parent name from lookup
  lessonsCount?: number; // From lookup field if exists
  lessonsAmount?: number;
  subscriptionsCount?: number; // From lookup field if exists
  subscriptionsAmount?: number; // From lookup field if exists
  cancellationsAmount?: number;
  totalAmount?: number; // From lookup field: "כולל מע\"מ ומנויים (from תלמיד)" or equivalent
  manualAdjustmentAmount?: number; // From charges table: manual_adjustment_amount
  manualAdjustmentReason?: string; // From charges table: manual_adjustment_reason
  manualAdjustmentDate?: string; // From charges table: manual_adjustment_date
  flags: {
    approved: boolean; // מאושר לחיוב
    linkSent: boolean; // נשלח קישור
    paid: boolean; // שולם
  };
  derivedStatus: 'טיוטה' | 'נשלח' | 'שולם';
}

export interface ChargesReportResult {
  rows: ChargeReportRow[];
  totalCount?: number; // Total count if available
  hasMore?: boolean; // Whether there are more records
  offset?: string; // Next offset for paging
}

/**
 * Discover lookup fields in the charges table
 * Lookup fields typically have names like "Field Name (from תלמיד)" or "Field Name_Lookup"
 */
interface ChargesLookupFields {
  displayNameField?: string; // e.g., "שם מלא (from תלמיד)" or "full_name (from תלמיד)"
  lessonsCountField?: string; // Lookup field for lessons count
  lessonsAmountField?: string; // Lookup field for lessons amount
  subscriptionsCountField?: string; // Lookup field for subscriptions count
  subscriptionsAmountField?: string; // Lookup field for subscriptions amount
  totalAmountField?: string; // e.g., "כולל מע\"מ ומנויים (from תלמיד)"
}

function discoverLookupFields(sampleRecord: any): ChargesLookupFields {
  const fields = Object.keys(sampleRecord.fields || {});
  const result: ChargesLookupFields = {};
  
  // 1. Display Name
  const preferredNameFields = ['שם מלא (from תלמיד)', 'full_name (from תלמיד)', 'Student_Name', 'תלמיד', 'full_name'];
  result.displayNameField = fields.find(f => preferredNameFields.includes(f)) || 
                           fields.find(f => f.toLowerCase().includes('name'));

  // 2. Lessons Count
  result.lessonsCountField = fields.find(f => f.includes('Total Lessons Attended') || f.includes('מספר שיעורים'));

  // 3. Subscriptions Amount - EXACT FIELD from User
  result.subscriptionsAmountField = fields.find(f => 
    f === 'Subscription Monthly Amount (from full_name)' ||
    f === 'Subscription Monthly Amount (from תלמיד)' ||
    f === 'Subscription Monthly Amount'
  );

  // 4. Total Amount (The bottom line)
  result.totalAmountField = fields.find(f => 
    f === 'כולל מע"מ ומנויים' || 
    f === 'כולל מע"מ ומנויים (from תלמיד)' || 
    f === 'כולל מע"מ ומנויים (from full_name)'
  );

  // 5. Lessons Amount (If exists as a separate field)
  result.lessonsAmountField = fields.find(f => 
    f === 'lessons_total' || 
    f === 'סכום שיעורים' || 
    f === 'שיעורים (סכום)'
  );

  return result;
}

/**
 * Extract student record ID from charge record
 */
function extractStudentRecordId(chargeRecord: any, studentFieldName: string): string | null {
  const studentField = chargeRecord.fields[studentFieldName];
  
  if (!studentField) {
    return null;
  }
  
  // Handle array of record IDs
  if (Array.isArray(studentField)) {
    if (studentField.length === 0) {
      return null;
    }
    // Could be array of strings (record IDs) or array of objects with id property
    const first = studentField[0];
    if (typeof first === 'string') {
      return first;
    } else if (first && typeof first === 'object' && first.id) {
      return first.id;
    }
  }
  
  // Handle single string record ID
  if (typeof studentField === 'string') {
    return studentField;
  }
  
  // Handle object with id property
  if (studentField && typeof studentField === 'object' && studentField.id) {
    return studentField.id;
  }
  
  return null;
}

/**
 * Extract display name from lookup fields
 */
function extractDisplayName(chargeRecord: any, lookupFields: ChargesLookupFields): string {
  const fields = chargeRecord.fields || {};
  
  // Try display name field first
  if (lookupFields.displayNameField) {
    const value = fields[lookupFields.displayNameField];
    if (value) {
      // Lookup fields can be arrays of objects with name property
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === 'object' && first.name) {
          return first.name;
        } else if (typeof first === 'string') {
          return first;
        }
      } else if (typeof value === 'string') {
        return value;
      }
    }
  }
  
  // Fallback: try common field name patterns
  const fallbackFields = [
    'שם מלא (from תלמיד)',
    'full_name (from תלמיד)',
    'Student_Name',
    'student_name',
    'display_name',
  ];
  
  for (const fieldName of fallbackFields) {
    const value = fields[fieldName];
    if (value) {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === 'object' && first.name) {
          return first.name;
        } else if (typeof first === 'string') {
          return first;
        }
      } else if (typeof value === 'string') {
        return value;
      }
    }
  }
  
  return 'לא צוין'; // Not specified
}

/**
 * Extract numeric value from lookup field
 * Handles arrays (sums them), numbers, and strings
 */
function extractNumericValue(chargeRecord: any, fieldName: string | undefined): number | undefined {
  if (!fieldName) {
    return undefined;
  }
  
  const value = chargeRecord.fields[fieldName];
  if (value === undefined || value === null) {
    return undefined;
  }
  
  // Handle array (lookup fields can return arrays of numbers or objects)
  if (Array.isArray(value)) {
    if (value.length === 0) return 0;
    
    // Sum all numeric values in the array
    return value.reduce((sum: number, val: any) => {
      if (typeof val === 'number') return sum + val;
      if (typeof val === 'string') {
        const num = parseFloat(val.replace(/[₪,\s]/g, ''));
        return sum + (isNaN(num) ? 0 : num);
      }
      // Handle object with value property (common in some Airtable lookups)
      if (val && typeof val === 'object' && typeof val.value === 'number') {
        return sum + val.value;
      }
      return sum;
    }, 0);
  }
  
  // Handle direct number
  if (typeof value === 'number') {
    return value;
  }
  
  // Handle string that can be parsed as number
  if (typeof value === 'string') {
    const num = parseFloat(value.replace(/[₪,\s]/g, ''));
    return isNaN(num) ? undefined : num;
  }

  // Handle object with value property
  if (value && typeof value === 'object' && typeof (value as any).value === 'number') {
    return (value as any).value;
  }
  
  return undefined;
}

/**
 * Derive status from approval and paid flags
 */
function deriveStatus(approved: boolean, paid: boolean): 'טיוטה' | 'נשלח' | 'שולם' {
  if (paid) {
    return 'שולם';
  }
  if (approved) {
    return 'נשלח';
  }
  return 'טיוטה';
}

/**
 * Build filter formula for charges report
 */
function buildFilterFormula(
  billingMonth: string,
  statusFilter: ChargesReportStatusFilter,
  schema: ChargeTableSchema,
  searchQuery?: string,
  displayNameField?: string
): string {
  const filters: string[] = [];
  
  const { billingMonthField, approvedField, linkSentField, paidField } = schema;
  
  // Always filter by billing month
  // Note: If billingMonth is empty or "all", don't filter by month
  if (billingMonth && billingMonth !== 'all') {
    const [year, month] = billingMonth.split('-');
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    
    // Try Date field filter first (most likely scenario)
    // Use YEAR and MONTH functions for Date fields
    const dateFilter = `AND(YEAR({${billingMonthField}}) = ${yearNum}, MONTH({${billingMonthField}}) = ${monthNum})`;
    
    // Fallback to text match for Text fields
    const textFilter = `{${billingMonthField}} = "${billingMonth}"`;
    
    // Combine with OR to handle both cases
    filters.push(`OR(${dateFilter}, ${textFilter})`);
  }
  
  // Apply status filter based on boolean fields
  if (statusFilter === 'draft') {
    // Draft = not approved
    filters.push(`{${approvedField}} = FALSE()`);
  } else if (statusFilter === 'link_sent') {
    // Link sent = linkSent checkbox is true
    filters.push(`{${linkSentField}} = TRUE()`);
  } else if (statusFilter === 'paid') {
    // Paid = paid checkbox is true
    filters.push(`{${paidField}} = TRUE()`);
  } else if (statusFilter === 'sent') {
    // Sent = approved but not paid (general sent status)
    filters.push(`AND({${approvedField}} = TRUE(), {${paidField}} = FALSE())`);
  }
  // 'all' doesn't add status filter
  
  // Apply search query if provided
  if (searchQuery && searchQuery.trim()) {
    const escapedQuery = searchQuery.replace(/"/g, '\\"');
    const lowerQuery = escapedQuery.toLowerCase();
    
    // Search in display name field if available
    // Use LOWER() for case-insensitive search and &"" to handle null values
    if (displayNameField) {
      filters.push(`SEARCH(LOWER("${lowerQuery}"), LOWER({${displayNameField}}&""))`);
    } else {
      // Fallback: try common field names including direct link field
      const searchFields = [
        schema.studentField, // Direct link field
        'שם מלא (from תלמיד)',
        'full_name (from תלמיד)',
        'Student_Name',
      ];
      const searchConditions = searchFields.map(f => 
        `SEARCH(LOWER("${lowerQuery}"), LOWER({${f}}&""))`
      );
      filters.push(`OR(${searchConditions.join(', ')})`);
    }
  }
  
  // If no filters, return empty string (get all records)
  if (filters.length === 0) {
    return '';
  }
  
  return filters.length > 1 ? `AND(${filters.join(', ')})` : filters[0];
}

/**
 * Filter records in memory as fallback when Airtable filter fails
 */
function filterRecordsInMemory(
  records: any[],
  input: ChargesReportInput,
  schema: ChargeTableSchema,
  lookupFields: ChargesLookupFields
): any[] {
  return records.filter(rec => {
    const fields = rec.fields as any;
    
    // Filter by billing month
    if (input.billingMonth && input.billingMonth !== 'all') {
      const val = fields[schema.billingMonthField];
      if (!val) return false;
      
      const [year, month] = input.billingMonth.split('-').map(Number);
      const yearNum = parseInt(year.toString());
      const monthNum = parseInt(month.toString());
      
      // Try date match first
      try {
        const date = new Date(val);
        if (!isNaN(date.getTime())) {
          if (date.getFullYear() !== yearNum || date.getMonth() + 1 !== monthNum) {
            return false;
          }
        } else {
          // Not a date, try string match
          const valStr = String(val);
          if (!valStr.includes(input.billingMonth)) {
            return false;
          }
        }
      } catch (e) {
        // Not a date, try string match
        const valStr = String(val);
        if (!valStr.includes(input.billingMonth)) {
          return false;
        }
      }
    }
    
    // Filter by status
    const statusFilter = input.statusFilter || 'all';
    if (statusFilter !== 'all') {
      const approved = fields[schema.approvedField] === true || fields[schema.approvedField] === 1;
      const linkSent = fields[schema.linkSentField] === true || fields[schema.linkSentField] === 1;
      const paid = fields[schema.paidField] === true || fields[schema.paidField] === 1;
      
      if (statusFilter === 'draft') {
        if (approved) return false;
      } else if (statusFilter === 'link_sent') {
        if (!linkSent) return false;
      } else if (statusFilter === 'paid') {
        if (!paid) return false;
      } else if (statusFilter === 'sent') {
        if (!approved || paid) return false;
      }
    }
    
    // Filter by search query
    if (input.searchQuery && input.searchQuery.trim()) {
      const searchTerm = input.searchQuery.toLowerCase();
      const displayName = extractDisplayName(rec, lookupFields);
      const nameStr = String(displayName || '').toLowerCase();
      
      if (!nameStr.includes(searchTerm)) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Get charges report
 */
export async function getChargesReport(
  client: AirtableClient,
  input: ChargesReportInput
): Promise<ChargesReportResult> {
  // Validate billingMonth format (allow empty string for "all months")
  if (input.billingMonth && !/^\d{4}-\d{2}$/.test(input.billingMonth)) {
    throw new Error(`Invalid billingMonth format: ${input.billingMonth}. Expected YYYY-MM or empty string for all months`);
  }
  
  const billingTableId = client.getTableId('monthlyBills');
  
  // Log table ID being used (for debugging 403 errors)
  if (_isDev) {
    console.log('[getChargesReport] Using table ID:', billingTableId, 'for monthlyBills');
  }
  
  try {
    // Get a sample record to discover field names
    const sampleRecords = await client.getRecords(billingTableId, { maxRecords: 1 });
    
    if (sampleRecords.length === 0) {
      // No records - return empty result
      return {
        rows: [],
        totalCount: 0,
        hasMore: false,
      };
    }
    
    // Discover schema
    const schemaResult = await discoverChargeTableSchema(client);
    let schema: ChargeTableSchema;
    if (Array.isArray(schemaResult)) {
      if (_isDev) {
        console.warn('[getChargesReport] Schema discovery returned missing fields, but continuing with fallbacks:', schemaResult);
      }
      // Use fallback schema instead of throwing
      schema = {
        studentField: AIRTABLE_CONFIG.fields.billingStudent || 'full_name',
        studentFieldIsArray: true,
        billingMonthField: AIRTABLE_CONFIG.fields.billingMonth || 'חודש חיוב',
        approvedField: AIRTABLE_CONFIG.fields.billingApproved || 'מאושר לחיוב',
        linkSentField: AIRTABLE_CONFIG.fields.billingLinkSent || 'נשלח קישור',
        paidField: AIRTABLE_CONFIG.fields.billingPaid || 'שולם',
      };
    } else {
      // Schema discovery succeeded
      schema = schemaResult;
    }
    const lookupFields = discoverLookupFields(sampleRecords[0]);
    
    // Build complete filter using buildFilterFormula (includes month, status, and search)
    const filterFormula = buildFilterFormula(
      input.billingMonth || '',
      input.statusFilter || 'all',
      schema,
      input.searchQuery,
      lookupFields.displayNameField
    );
    
    // Fetch records with the complete filter
    let chargeRecords: any[] = [];
    
    if (filterFormula) {
      try {
        chargeRecords = await client.getRecords(billingTableId, {
          filterByFormula: filterFormula,
          maxRecords: 100,
        });
        
        if (_isDev) {
          console.log(`[getChargesReport] Filter formula: ${filterFormula}`);
          console.log(`[getChargesReport] Found ${chargeRecords.length} records with filter`);
        }
      } catch (e) {
        if (_isDev) {
          console.warn('[getChargesReport] Filter failed, trying fallback:', e);
        }
        // Fallback: fetch all and filter in memory
        try {
          const allRecords = await client.getRecords(billingTableId, { maxRecords: 100 });
          chargeRecords = filterRecordsInMemory(allRecords, input, schema, lookupFields);
          
          if (_isDev) {
            console.log(`[getChargesReport] Filtered ${chargeRecords.length} records from ${allRecords.length} total in memory (fallback)`);
          }
        } catch (fallbackError) {
          console.error('[getChargesReport] Failed to fetch all records for fallback:', fallbackError);
          chargeRecords = [];
        }
      }
    } else {
      // No filter - get all records
      chargeRecords = await client.getRecords(billingTableId, { maxRecords: 100 });
    }

    const rows: ChargeReportRow[] = chargeRecords.map(record => {
      const fields = record.fields as any;
      const studentRecordId = extractStudentRecordId(record, schema.studentField) || '';
      const displayName = extractDisplayName(record, lookupFields);
      // Canonical total: "כולל מע"מ ומנויים (from תלמיד)" first, then fieldMap total_amount, then discovery
      const totalAmount =
        extractNumericValue(record, getField('monthlyBills', 'total_amount_from_student')) ??
        extractNumericValue(record, getField('monthlyBills', 'total_amount')) ??
        extractNumericValue(record, lookupFields.totalAmountField);
      const subscriptionsAmount =
        extractNumericValue(record, getField('monthlyBills', 'subscriptions_amount')) ??
        extractNumericValue(record, lookupFields.subscriptionsAmountField);
      const lessonsAmount =
        extractNumericValue(record, getField('monthlyBills', 'lessons_amount')) ??
        extractNumericValue(record, lookupFields.lessonsAmountField);
      const lessonsCount =
        extractNumericValue(record, getField('monthlyBills', 'lessons_count')) ??
        extractNumericValue(record, lookupFields.lessonsCountField);
      const subscriptionsCount = extractNumericValue(record, lookupFields.subscriptionsCountField);
      const cancellationsAmount = fields.cancellations_amount;
      
      const approved = fields[schema.approvedField] === true || fields[schema.approvedField] === 1;
      const linkSent = fields[schema.linkSentField] === true || fields[schema.linkSentField] === 1;
      const paid = fields[schema.paidField] === true || fields[schema.paidField] === 1;
      
      return {
        chargeRecordId: record.id,
        studentRecordId,
        displayName,
        lessonsCount,
        lessonsAmount,
        subscriptionsCount,
        subscriptionsAmount,
        cancellationsAmount,
        totalAmount,
        manualAdjustmentAmount: extractNumericValue(record, 'manual_adjustment_amount'),
        manualAdjustmentReason: fields.manual_adjustment_reason,
        manualAdjustmentDate: fields.manual_adjustment_date,
        flags: { approved, linkSent, paid },
        derivedStatus: deriveStatus(approved, paid),
      };
    });

    return {
      rows,
      totalCount: rows.length,
      hasMore: false,
    };
  } catch (error: any) {
    // Handle 403 errors (permission/table not found) with detailed diagnostics
    if (error.status === 403 || error.code === 'AIRTABLE_ERROR') {
      const tableId = client.getTableId('monthlyBills');
      const diagnosticError: any = {
        message: `Cannot access Airtable table "חיובים" (monthlyBills). ` +
          `Table ID in config: "${tableId}". ` +
          `Error: ${error.message || '403 Forbidden'}. ` +
          `Please verify: (1) Table ID "${tableId}" exists in your Airtable base, ` +
          `(2) API key has access to this table, (3) Table display name matches "Billing" or "חיובים".`,
        code: 'AIRTABLE_TABLE_ACCESS_ERROR',
        status: 403,
        details: {
          tableId: tableId,
          tableName: 'monthlyBills',
          originalError: error.message,
          errorDetails: error.details,
        },
      };
      
      if (_isDev) {
        console.error('[getChargesReport] 403 Error Details:', diagnosticError);
      }
      
      throw diagnosticError;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Charges Report KPIs - Calculate totals from "חיובים" table
 * 
 * Calculates:
 * - totalToBill: Sum of totalAmount for all charge rows in the month
 * - paidTotal: Sum of totalAmount where שולם = true
 * - pendingTotal: Sum of totalAmount where שולם = false
 * 
 * Fails loudly if totalAmount field is missing or non-numeric.
 */

export interface ChargesReportKPIs {
  billingMonth: string;
  totalToBill: number;
  paidTotal: number;
  pendingTotal: number;        // Total unpaid (draft + approved unpaid)
  draftTotal: number;          // Not yet approved
  approvedUnpaidTotal: number; // Approved but not yet paid
  // New KPIs
  collectionRate: number;      // (paidTotal / totalToBill) * 100
  pendingLinkCount: number;    // Number of approved bills where linkSent is false
  avgBillPerStudent: number;   // totalToBill / studentCount
  totalLessonsAmount: number;  // Sum of lessonsAmount lookup
  totalSubscriptionsAmount: number; // Sum of subscriptionsAmount lookup
  studentCount: number;        // Unique students with bills
}

/**
 * Get charges report KPIs for a billing month
 */
export async function getChargesReportKPIs(
  client: AirtableClient,
  billingMonth: string
): Promise<ChargesReportKPIs> {
  // Validate billingMonth format
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    throw new Error(`Invalid billingMonth format: ${billingMonth}. Expected YYYY-MM`);
  }
  
  const billingTableId = client.getTableId('monthlyBills');
  
  // Get multiple records to ensure we find checkbox fields even if some are false
  const sampleRecords = await client.getRecords(billingTableId, { maxRecords: 10 });
  
  if (sampleRecords.length === 0) {
    // No records - return zeros
    return {
      billingMonth,
      totalToBill: 0,
      paidTotal: 0,
      pendingTotal: 0,
      draftTotal: 0,
      approvedUnpaidTotal: 0,
      collectionRate: 0,
      pendingLinkCount: 0,
      avgBillPerStudent: 0,
      totalLessonsAmount: 0,
      totalSubscriptionsAmount: 0,
      studentCount: 0,
    };
  }
  
  // Discover schema
  const schemaResult = await discoverChargeTableSchema(client);
  if (Array.isArray(schemaResult)) {
    throw {
      MISSING_FIELDS: schemaResult,
    };
  }
  const schema = schemaResult;
  
  // Discover lookup fields to find totalAmount field
  const lookupFields = discoverLookupFields(sampleRecords[0]);
  
  // Validate that totalAmount field exists
  if (!lookupFields.totalAmountField) {
    // Try to find it with alternative patterns
    const fields = Object.keys(sampleRecords[0].fields || {});
    const alternativePatterns = [
      'כולל מע"מ ומנויים',
      'כולל מע\\"מ ומנויים',
      'total_amount',
      'totalAmount',
      'Total_Amount',
      'סה"כ',
    ];
    
    const foundField = fields.find(f => {
      const lower = f.toLowerCase();
      return alternativePatterns.some(pattern => 
        f.includes(pattern) || lower.includes(pattern.toLowerCase())
      );
    });
    
    if (!foundField) {
      // List candidate fields that might be the totalAmount field
      const candidateFields = fields.filter(f => {
        const lower = f.toLowerCase();
        return (
          lower.includes('total') ||
          lower.includes('amount') ||
          lower.includes('סה"כ') ||
          lower.includes('סכום') ||
          f.includes('מע"מ') ||
          f.includes('מנויים')
        );
      });
      
      throw new Error(
        `MISSING_FIELD_MAPPING: totalAmount field not found in "חיובים" table.\n` +
        `\n` +
        `Expected field patterns:\n` +
        `  - "כולל מע\"מ ומנויים (from תלמיד)"\n` +
        `  - Fields containing: total, amount, סה"כ, סכום, מע"מ, מנויים\n` +
        `\n` +
        `Candidate fields found (please map one of these to totalAmount):\n` +
        (candidateFields.length > 0 
          ? candidateFields.map(f => `  - "${f}"`).join('\n')
          : `  (none found matching patterns)`
        ) +
        `\n` +
        `\n` +
        `All available fields in "חיובים" table:\n` +
        fields.map(f => `  - "${f}"`).join('\n') +
        `\n` +
        `\n` +
        `ACTION REQUIRED: Please specify which field contains the total amount (including VAT and subscriptions).`
      );
    }
    
    lookupFields.totalAmountField = foundField;
  }
  
  // Query all charge records for this billing month
  // Use schema.billingMonthField for accurate filtering
  // Handle both Date and Text field types
  const [year, month] = billingMonth.split('-').map(Number);
  const yearNum = parseInt(year.toString());
  const monthNum = parseInt(month.toString());
  const monthStartDate = `${billingMonth}-01`;
  // Get last day of month: new Date(year, month, 0) gives last day of (month-1), so use month
  const lastDayOfMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthEndDate = `${billingMonth}-${String(lastDayOfMonth).padStart(2, '0')}`;
  
  // Try multiple filter strategies - try Date first (most likely), then Text
  let chargeRecords: any[] = [];
  
  // Strategy 1: Try Date field filters first (since field is likely Date type)
  try {
    const dateFilter = `AND(YEAR({${schema.billingMonthField}}) = ${yearNum}, MONTH({${schema.billingMonthField}}) = ${monthNum})`;
    chargeRecords = await client.getRecords(billingTableId, {
      filterByFormula: dateFilter,
      maxRecords: 10000,
    });
    
    if (_isDev && chargeRecords.length > 0) {
      console.log(`[getChargesReportKPIs] Found ${chargeRecords.length} records with date filter (YEAR/MONTH)`);
    }
  } catch (e) {
    if (_isDev) {
      console.warn('[getChargesReportKPIs] Date YEAR/MONTH filter failed:', e);
    }
  }
  
  // Strategy 2: If no records, try date range filter
  if (chargeRecords.length === 0) {
    try {
      const rangeFilter = `AND(IS_AFTER({${schema.billingMonthField}}, "${monthStartDate}"), IS_BEFORE({${schema.billingMonthField}}, "${monthEndDate}T23:59:59"))`;
      chargeRecords = await client.getRecords(billingTableId, {
        filterByFormula: rangeFilter,
        maxRecords: 10000,
      });
      
      if (_isDev && chargeRecords.length > 0) {
        console.log(`[getChargesReportKPIs] Found ${chargeRecords.length} records with date range filter`);
      }
    } catch (e) {
      if (_isDev) {
        console.warn('[getChargesReportKPIs] Date range filter failed:', e);
      }
    }
  }
  
  // Strategy 3: If still no records, try simple text match (for Text fields)
  if (chargeRecords.length === 0) {
    try {
      const simpleFilter = `{${schema.billingMonthField}} = "${billingMonth}"`;
      chargeRecords = await client.getRecords(billingTableId, {
        filterByFormula: simpleFilter,
        maxRecords: 10000,
      });
      
      if (_isDev && chargeRecords.length > 0) {
        console.log(`[getChargesReportKPIs] Found ${chargeRecords.length} records with text filter`);
      }
    } catch (e) {
      if (_isDev) {
        console.warn('[getChargesReportKPIs] Text filter failed:', e);
      }
    }
  }
  
  // Strategy 4: Last resort - fetch ALL and filter in memory
  if (chargeRecords.length === 0) {
    if (_isDev) {
      console.warn('[getChargesReportKPIs] All filters returned 0 records, fetching all and filtering in memory');
    }
    try {
      const allRecords = await client.getRecords(billingTableId, { maxRecords: 10000 });
      chargeRecords = allRecords.filter(rec => {
        const val = rec.fields[schema.billingMonthField];
        if (!val) return false;
        
        // Try to match as date first
        try {
          const date = new Date(val);
          if (!isNaN(date.getTime())) {
            const recordYear = date.getFullYear();
            const recordMonth = date.getMonth() + 1;
            if (recordYear === yearNum && recordMonth === monthNum) {
              return true;
            }
          }
        } catch (e) {
          // Not a date, try string match
        }
        
        // Try to match as string
        const valStr = String(val);
        if (valStr.includes(billingMonth)) return true;
        
        return false;
      });
      
      if (_isDev) {
        console.log(`[getChargesReportKPIs] Filtered ${chargeRecords.length} records from ${allRecords.length} total records in memory`);
      }
    } catch (e) {
      console.error('[getChargesReportKPIs] Failed to fetch all records:', e);
      chargeRecords = [];
    }
  }
  
  if (_isDev) {
    console.log(`[getChargesReportKPIs] Final result: ${chargeRecords.length} records for month ${billingMonth}`);
    if (chargeRecords.length > 0) {
      console.log(`[getChargesReportKPIs] Sample record billing month value:`, chargeRecords[0].fields[schema.billingMonthField]);
    }
  }
  
  // Calculate totals
  let totalToBill = 0;
  let paidTotal = 0;
  let pendingTotal = 0;
  let draftTotal = 0;
  let approvedUnpaidTotal = 0;
  let pendingLinkCount = 0;
  let totalLessonsAmount = 0;
  let totalSubscriptionsAmount = 0;
  const studentIds = new Set<string>();
  
  const totalAmountFieldName = lookupFields.totalAmountField!;
  const lessonsAmountFieldName = lookupFields.lessonsAmountField;
  const subscriptionsAmountFieldName = lookupFields.subscriptionsAmountField;
  
  for (const record of chargeRecords) {
    const fields = record.fields as any;
    
    // Track unique students
    const studentId = extractStudentRecordId(record, schema.studentField);
    if (studentId) {
      studentIds.add(studentId);
    }
    
    // Extract totalAmount value
    let totalAmount = extractNumericValue(record, totalAmountFieldName) || 0;
    
    // Extract breakdown amounts
    const subscriptionsAmount = extractNumericValue(record, subscriptionsAmountFieldName) || 0;
    let lessonsAmount = extractNumericValue(record, lessonsAmountFieldName) || 0;
    const adjustmentAmount = extractNumericValue(record, 'manual_adjustment_amount') || 0;
    
    // CALCULATION LOGIC:
    // 1. If we have a total but no explicit lessons amount field, lessons = total - subs
    if (totalAmount > 0 && lessonsAmount === 0) {
      lessonsAmount = Math.max(0, totalAmount - subscriptionsAmount);
    }
    
    // 2. If the total field itself is missing but we have parts, calculate it
    if (totalAmount === 0 && (lessonsAmount > 0 || subscriptionsAmount > 0)) {
      totalAmount = lessonsAmount + subscriptionsAmount + adjustmentAmount;
    }

    // 3. SMART RECOVERY (Same as nexusApi):
    // If totalAmount + adjustmentAmount == subscriptionsAmount, then totalAmount is Subtotal.
    if (totalAmount > 0 && Math.abs(totalAmount + adjustmentAmount - subscriptionsAmount) < 1) {
       totalAmount = totalAmount + adjustmentAmount;
    }
    
    totalToBill += totalAmount;
    totalLessonsAmount += lessonsAmount;
    totalSubscriptionsAmount += subscriptionsAmount;
    
    // Check flags
    const approved = fields[schema.approvedField] === true || fields[schema.approvedField] === 1;
    const paid = fields[schema.paidField] === true || fields[schema.paidField] === 1;
    const linkSent = fields[schema.linkSentField] === true || fields[schema.linkSentField] === 1;
    
    if (paid) {
      paidTotal += totalAmount;
    } else {
      // SMART CALCULATION: pendingTotal is the real "debt"
      pendingTotal += totalAmount;
      if (approved) {
        approvedUnpaidTotal += totalAmount;
        if (!linkSent) {
          pendingLinkCount++;
        }
      } else {
        draftTotal += totalAmount;
      }
    }
  }
  
  // FINAL ADJUSTMENT: Ensure consistency between sum of parts and grand total
  if (totalToBill === 0 && (totalLessonsAmount > 0 || totalSubscriptionsAmount > 0)) {
    totalToBill = totalLessonsAmount + totalSubscriptionsAmount;
  }
  
  const studentCount = studentIds.size;
  const collectionRate = totalToBill > 0 ? (paidTotal / totalToBill) * 100 : 0;
  const avgBillPerStudent = studentCount > 0 ? totalToBill / studentCount : 0;
  
  return {
    billingMonth,
    totalToBill,
    paidTotal,
    pendingTotal,
    draftTotal,
    approvedUnpaidTotal,
    collectionRate,
    pendingLinkCount,
    avgBillPerStudent,
    totalLessonsAmount,
    totalSubscriptionsAmount,
    studentCount,
  };
}
