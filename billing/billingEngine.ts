/**
 * Billing Engine - Main orchestration logic
 * 
 * Public API:
 * - buildStudentMonth(studentRecordId, billingMonth, runId?)
 * - buildMonthForAllActiveStudents(billingMonth, dryRun?)
 * 
 * Field Mappings (validated against contracts/types.ts):
 * - Lessons table: full_name (linked record), billing_month (string), lesson_type, status, start_datetime
 * - Charges table: תלמיד (linked record), חודש חיוב (string), שולם (checkbox), מאושר לחיוב (checkbox)
 * - Students table: full_name (primary field), is_active (checkbox)
 * 
 * Key Fixes:
 * 1. Lessons query now filters by billing_month OR date range (handles both field types)
 * 2. Charge records are NOT created if total === 0 AND no billable data exists
 * 3. Comprehensive logging with unique runId for debugging
 * 4. Student record ID validation (must start with 'rec')
 * 5. Proper error handling for NO_BILLABLE_DATA (counted as skipped, not error)
 */

import { AirtableClient, AirtableRecord } from './airtableClient';
import {
  calculateLessonsContribution,
  calculateCancellationsContribution,
  calculateSubscriptionsContribution,
  calculateTotal,
  determineBillingStatus,
  extractStudentId,
  extractLessonId,
  getAllStudentIds,
} from './billingRules';
import {
  LessonsAirtableFields,
  CancellationsAirtableFields,
  SubscriptionsAirtableFields,
  BillingAirtableFields,
  StudentsAirtableFields,
  LinkedRecord,
} from '../contracts/types';

const isDev = typeof process !== 'undefined' ? process.env.NODE_ENV === 'development' : (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV);
import {
  DomainError,
  MissingFieldsError,
  DuplicateBillingRecordsError,
} from './domainErrors';

/**
 * Generate unique run ID for logging
 */
function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build filter formula for billing month field
 * Handles both Date and Text field types
 * @param fieldName - The field name (e.g., "חודש חיוב")
 * @param billingMonth - Billing month in YYYY-MM format
 * @returns Airtable filter formula that works for both Date and Text fields
 */
function buildBillingMonthFilter(fieldName: string, billingMonth: string): string {
  const [year, month] = billingMonth.split('-').map(Number);
  const yearNum = parseInt(year.toString());
  const monthNum = parseInt(month.toString());
  
  // Handle both Date and Text fields:
  // 1. For Date fields: check YEAR and MONTH separately, or check date range
  // 2. For Text fields: exact match or starts with
  // Note: Airtable Date fields store full dates, so we check if the date falls within the month
  const monthStartDate = `${billingMonth}-01`;
  // Get last day of month: new Date(year, month, 0) gives last day of (month-1), so use month+1
  const lastDayOfMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthEndDate = `${billingMonth}-${String(lastDayOfMonth).padStart(2, '0')}`;
  
  return `OR(
    AND(YEAR({${fieldName}}) = ${yearNum}, MONTH({${fieldName}}) = ${monthNum}),
    AND(IS_AFTER({${fieldName}}, "${monthStartDate}"), IS_BEFORE({${fieldName}}, "${monthEndDate}T23:59:59")),
    {${fieldName}} = "${billingMonth}"
  )`;
}

/**
 * Convert billing month (YYYY-MM) to value suitable for Airtable field
 * Handles both Date and Text field types
 * @param billingMonth - Billing month in YYYY-MM format
 * @param isDateField - Whether the field is a Date field (default: try both)
 * @returns Value to set in Airtable (Date string for Date fields, YYYY-MM for Text fields)
 */
function convertBillingMonthToAirtableValue(billingMonth: string, isDateField: boolean = false): string {
  if (isDateField) {
    // For Date fields, use first day of month (YYYY-MM-01 format)
    return `${billingMonth}-01`;
  }
  // For Text fields, use YYYY-MM format
  return billingMonth;
}


/**
 * Helper to extract student record ID from linked record field
 */
function getLessonStudentRecordId(lesson: LessonsAirtableFields): string | null {
  const fullNameField = lesson.full_name;
  
  if (!fullNameField) {
    return null;
  }
  
  // Handle array of record IDs
  if (Array.isArray(fullNameField)) {
    if (fullNameField.length === 0) {
      return null;
    }
    const first = fullNameField[0];
    // Could be string (record ID) or object with id property
    if (typeof first === 'string') {
      return first.startsWith('rec') ? first : null;
    } else if (first && typeof first === 'object' && 'id' in first) {
      return (first as any).id;
    }
  }
  
  // Handle single string record ID
  if (typeof fullNameField === 'string') {
    return fullNameField.startsWith('rec') ? fullNameField : null;
  }
  
  // Handle object with id property
  if (fullNameField && typeof fullNameField === 'object' && 'id' in fullNameField) {
    return (fullNameField as any).id;
  }
  
  return null;
}

export interface BillingResult {
  billingRecordId: string;
  studentRecordId: string;
  billingMonth: string;
  lessonsTotal: number;
  lessonsCount: number;
  cancellationsTotal: number;
  cancellationsCount: number;
  pendingCancellationsCount: number;
  subscriptionsTotal: number;
  subscriptionsCount: number;
  total: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'paid';
  created: boolean;
}

/**
 * Generate billing key
 */
export function generateBillingKey(studentRecordId: string, billingMonth: string): string {
  return `${studentRecordId}_${billingMonth}`;
}

/**
 * Build monthly bill for a single student
 */
export async function buildStudentMonth(
  client: AirtableClient,
  studentRecordId: string,
  billingMonth: string,
  runId?: string,
  prefetchedData?: {
    student?: AirtableRecord<StudentsAirtableFields>;
    lessons?: AirtableRecord<LessonsAirtableFields>[];
    cancellations?: AirtableRecord<CancellationsAirtableFields>[];
    subscriptions?: AirtableRecord<SubscriptionsAirtableFields>[];
    existingBill?: AirtableRecord<BillingAirtableFields>;
  }
): Promise<BillingResult | MissingFieldsError | DomainError> {
  const logRunId = runId || generateRunId();
  
  // Validate billingMonth format
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    throw new DomainError(
      `Invalid billingMonth format: ${billingMonth}. Expected YYYY-MM`,
      'VALIDATION_ERROR'
    );
  }


  const studentsTableId = client.getTableId('students');
  const lessonsTableId = client.getTableId('lessons');
  const cancellationsTableId = client.getTableId('cancellations');
  const subscriptionsTableId = client.getTableId('subscriptions');
  const billingTableId = client.getTableId('monthlyBills');

  // Calculate date range for the billing month
  const [year, month] = billingMonth.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  // 1. Fetch student
  let student: AirtableRecord<StudentsAirtableFields>;
  if (prefetchedData?.student) {
    student = prefetchedData.student;
  } else {
    try {
      student = await client.getRecord<StudentsAirtableFields>(studentsTableId, studentRecordId);
    } catch (error: any) {
      throw new DomainError(
        `Student not found: ${studentRecordId}`,
        'STUDENT_NOT_FOUND',
        { studentRecordId }
      );
    }
  }

  // 2. Fetch lessons
  let lessons: AirtableRecord<LessonsAirtableFields>[];
  if (prefetchedData?.lessons) {
    lessons = prefetchedData.lessons;
  } else {
    const lessonsFilter = `AND(
      {full_name} = "${studentRecordId}",
      OR(
        {billing_month} = "${billingMonth}",
        AND(
          IS_AFTER({start_datetime}, "${startDateStr}"),
          IS_BEFORE({start_datetime}, "${endDateStr}T23:59:59")
        )
      )
    )`;
    lessons = await client.listRecords<LessonsAirtableFields>(
      lessonsTableId,
      { filterByFormula: lessonsFilter }
    );
  }

  // 3. Fetch cancellations
  let cancellations: AirtableRecord<CancellationsAirtableFields>[];
  if (prefetchedData?.cancellations) {
    cancellations = prefetchedData.cancellations;
  } else {
    const cancellationsFilter = `AND(
      {student} = "${studentRecordId}",
      {billing_month} = "${billingMonth}"
    )`;
    cancellations = await client.listRecords<CancellationsAirtableFields>(
      cancellationsTableId,
      { filterByFormula: cancellationsFilter }
    );
  }

  // 4. Fetch subscriptions
  let subscriptions: AirtableRecord<SubscriptionsAirtableFields>[];
  if (prefetchedData?.subscriptions) {
    subscriptions = prefetchedData.subscriptions;
  } else {
    const subscriptionsFilter = `{student_id} = "${studentRecordId}"`;
    subscriptions = await client.listRecords<SubscriptionsAirtableFields>(
      subscriptionsTableId,
      { filterByFormula: subscriptionsFilter }
    );
  }

  // Calculate lessons contribution
  const lessonsContribution = calculateLessonsContribution(
    lessons.map(r => r.fields),
    billingMonth,
    studentRecordId
  );

  if (lessonsContribution instanceof MissingFieldsError) {
    return lessonsContribution;
  }

  // Build lesson lookup for cancellations
  const lessonMap = new Map<string, LessonsAirtableFields>();
  for (const lessonRecord of lessons) {
    lessonMap.set(lessonRecord.id, lessonRecord.fields);
  }

  const getLinkedLesson = (lessonId: string): LessonsAirtableFields | undefined => {
    return lessonMap.get(lessonId);
  };

  // Calculate cancellations contribution
  const cancellationsResult = calculateCancellationsContribution(
    cancellations.map(r => r.fields),
    billingMonth,
    getLinkedLesson
  );

  if (cancellationsResult instanceof MissingFieldsError) {
    return cancellationsResult;
  }

  // Calculate subscriptions contribution
  const subscriptionsResult = calculateSubscriptionsContribution(
    subscriptions.map(r => r.fields),
    billingMonth
  );

  if (subscriptionsResult instanceof MissingFieldsError) {
    return subscriptionsResult;
  }

  // Calculate total
  const total = calculateTotal(
    lessonsContribution.lessonsTotal,
    cancellationsResult.cancellationsTotal,
    subscriptionsResult.subscriptionsTotal
  );

  console.log(`[BillingEngine] Calculation for ${studentRecordId}:`, {
    lessonsCount: lessonsContribution.lessonsCount,
    lessonsTotal: lessonsContribution.lessonsTotal,
    cancellationsCount: cancellationsResult.cancellationsCount,
    cancellationsTotal: cancellationsResult.cancellationsTotal,
    subscriptionsCount: subscriptionsResult.activeSubscriptionsCount,
    subscriptionsTotal: subscriptionsResult.subscriptionsTotal,
    total,
    lessonsFetched: lessons.length,
    cancellationsFetched: cancellations.length,
    subscriptionsFetched: subscriptions.length
  });

  // CRITICAL: Create billing record if there's ANY billable data, even if total is 0
  // This ensures students with lessons (but no subscription) get billed
  const hasBillableLessons = lessonsContribution.lessonsCount > 0;
  const hasBillableCancellations = cancellationsResult.cancellationsCount > 0;
  const hasSubscriptions = subscriptionsResult.activeSubscriptionsCount > 0;
  const hasAnyBillableData = hasBillableLessons || hasBillableCancellations || hasSubscriptions;

  console.log(`[BillingEngine] Billable data check for ${studentRecordId}:`, {
    hasBillableLessons,
    hasBillableCancellations,
    hasSubscriptions,
    hasAnyBillableData,
    total,
    willSkip: !hasAnyBillableData
  });

  // Only skip if there's NO billable data at all (no lessons, no cancellations, no subscriptions)
  // If there's any billable data, create the record even if total is 0
  if (!hasAnyBillableData) {
    // Return a special result indicating skip (but don't create record)
    // This allows the caller to distinguish between "skipped" and "created"
    throw new DomainError(
      `No billable data for student ${studentRecordId} in month ${billingMonth}. Skipping charge record creation.`,
      'NO_BILLABLE_DATA',
      {
        studentRecordId,
        billingMonth,
        lessonsCount: lessonsContribution.lessonsCount,
        cancellationsCount: cancellationsResult.cancellationsCount,
        subscriptionsTotal: subscriptionsResult.subscriptionsTotal,
      }
    );
  }

  // 5. Check existing billing record
  let matchingBills: AirtableRecord<BillingAirtableFields>[];
  if (prefetchedData?.existingBill) {
    matchingBills = [prefetchedData.existingBill];
  } else {
    // Use helper function to handle both Date and Text field types
    const billingMonthFilter = buildBillingMonthFilter('חודש חיוב', billingMonth);
    const billingFilter = `AND(
      {full_name} = "${studentRecordId}",
      ${billingMonthFilter}
    )`;
    matchingBills = await client.listRecords<BillingAirtableFields>(
      billingTableId,
      { filterByFormula: billingFilter }
    );
  }

  // Check for duplicates - CRITICAL: Stop immediately if duplicates found
  if (matchingBills.length > 1) {
    const duplicateError = new DuplicateBillingRecordsError(
      studentRecordId,
      billingMonth,
      matchingBills.map(b => b.id)
    );
    throw duplicateError;
  }

  // Get existing bill if it exists (for preserving manual adjustments)
  const existingBill = matchingBills.length === 1 ? matchingBills[0] : null;
  const existingFields = existingBill?.fields;

  // Determine status
  const isPaid = existingBill ? existingBill.fields['שולם'] === true : false;
  const status = determineBillingStatus(
    cancellationsResult.pendingCancellationsCount,
    isPaid
  );

  // Prepare billing fields
  // CRITICAL: Ensure student link field is properly set
  // The 'תלמיד' field expects a linked record (can be string ID or array)
  // Based on schema, it should be a single linked record (string)
  // NOTE: 'חודש חיוב' field may be Date or Text - try Date format first (YYYY-MM-01)
  // Airtable will accept this format for Date fields, and if it's Text, we'll handle it in error handling
  const billingMonthValue = convertBillingMonthToAirtableValue(billingMonth, true);
  
  // Preserve manual adjustment fields if they exist in existing bill
  // IMPORTANT: These fields are set manually by users and should NOT be overwritten
  
  const billingFields: Partial<BillingAirtableFields> = {
    'חודש חיוב': billingMonthValue as any, // Cast to any to allow both string and Date formats
    'שולם': isPaid,
    'מאושר לחיוב': status === 'approved' || status === 'paid',
    'full_name': [studentRecordId], // Linked record field - using full_name as per mapping
    'lessons_amount': lessonsContribution.lessonsTotal,
    'subscriptions_amount': subscriptionsResult.subscriptionsTotal,
    'cancellations_amount': cancellationsResult.cancellationsTotal,
    'total_amount': total,
    'lessons_count': lessonsContribution.lessonsCount,
    // Preserve manual adjustment fields if they exist (CRITICAL: don't overwrite user-set values)
    ...(existingFields?.manual_adjustment_amount !== undefined && existingFields.manual_adjustment_amount !== null && {
      manual_adjustment_amount: existingFields.manual_adjustment_amount,
    }),
    ...(existingFields?.manual_adjustment_reason !== undefined && existingFields.manual_adjustment_reason !== null && existingFields.manual_adjustment_reason !== '' && {
      manual_adjustment_reason: existingFields.manual_adjustment_reason,
    }),
    ...(existingFields?.manual_adjustment_date !== undefined && existingFields.manual_adjustment_date !== null && existingFields.manual_adjustment_date !== '' && {
      manual_adjustment_date: existingFields.manual_adjustment_date,
    }),
  };

  // Validate that studentRecordId is a valid record ID format
  if (!studentRecordId.startsWith('rec')) {
    throw new DomainError(
      `Invalid student record ID format: ${studentRecordId}. Expected record ID starting with 'rec'`,
      'INVALID_STUDENT_ID',
      { studentRecordId }
    );
  }


  let created = false;
  let billingRecordId: string;

  if (matchingBills.length === 0) {
    // Create new billing record
    const newRecord = await client.createRecord<BillingAirtableFields>(
      billingTableId,
      billingFields as BillingAirtableFields
    );
    billingRecordId = newRecord.id;
    created = true;
  } else {
    // Update existing billing record (idempotent - re-running updates totals)
    const existingBill = matchingBills[0];
    
    const updatedRecord = await client.updateRecord<BillingAirtableFields>(
      billingTableId,
      existingBill.id,
      billingFields
    );
    billingRecordId = updatedRecord.id;
  }

  const result: BillingResult = {
    billingRecordId,
    studentRecordId,
    billingMonth,
    lessonsTotal: lessonsContribution.lessonsTotal,
    lessonsCount: lessonsContribution.lessonsCount,
    cancellationsTotal: cancellationsResult.cancellationsTotal,
    cancellationsCount: cancellationsResult.cancellationsCount,
    pendingCancellationsCount: cancellationsResult.pendingCancellationsCount,
    subscriptionsTotal: subscriptionsResult.subscriptionsTotal,
    subscriptionsCount: subscriptionsResult.activeSubscriptionsCount,
    total,
    status,
    created,
  };

  return result;
}

/**
 * Build monthly bills for all active students
 */
export async function buildMonthForAllActiveStudents(
  client: AirtableClient,
  billingMonth: string,
  dryRun: boolean = false
): Promise<{
  success: BillingResult[];
  errors: Array<{ studentId: string; error: DomainError | MissingFieldsError }>;
  skipped: Array<{ studentId: string; reason: string }>;
  summary: {
    studentsFetched: number;
    lessonsFetched: number;
    cancellationsFetched: number;
    chargesCreated: number;
    chargesUpdated: number;
    chargesSkipped: number;
  };
}> {
  const runId = generateRunId();

  const studentsTableId = client.getTableId('students');
  const lessonsTableId = client.getTableId('lessons');
  const cancellationsTableId = client.getTableId('cancellations');
  const subscriptionsTableId = client.getTableId('subscriptions');
  const billingTableId = client.getTableId('monthlyBills');

  // Calculate date range for the billing month
  const [year, month] = billingMonth.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  if (isDev) {
    console.log(`[BillingEngine] Starting bulk build for ${billingMonth}. Fetching all data...`);
  }

  // 1. Fetch all active students
  const activeStudentsFilter = '{is_active} = 1';
  const students = await client.listRecords<StudentsAirtableFields>(
    studentsTableId,
    { filterByFormula: activeStudentsFilter }
  );

  // 2. Fetch ALL lessons for the billing month
  // 2. Fetch ALL lessons for the billing month
  const lessonsFilter = `OR(
    {billing_month} = "${billingMonth}",
    AND(
      IS_AFTER({start_datetime}, "${startDateStr}"),
      IS_BEFORE({start_datetime}, "${endDateStr}T23:59:59")
    )
  )`;
  
  const allLessons = await client.listRecords<LessonsAirtableFields>(
    lessonsTableId,
    { filterByFormula: lessonsFilter }
  );

  // 3. Fetch ALL cancellations for the billing month
  const cancellationsFilter = `{billing_month} = "${billingMonth}"`;
  const allCancellations = await client.listRecords<CancellationsAirtableFields>(
    cancellationsTableId,
    { filterByFormula: cancellationsFilter }
  );

  // 4. Fetch ALL subscriptions (grouped by student)
  const allSubscriptions = await client.listRecords<SubscriptionsAirtableFields>(
    subscriptionsTableId
  );

  // 5. Fetch ALL existing bills for this month
  // Use helper function to handle both Date and Text field types
  const billsFilter = buildBillingMonthFilter('חודש חיוב', billingMonth);
  const allExistingBills = await client.listRecords<BillingAirtableFields>(
    billingTableId,
    { filterByFormula: billsFilter }
  );

  console.log(`[BillingEngine] Data fetched: ${students.length} students, ${allLessons.length} lessons, ${allCancellations.length} cancellations, ${allSubscriptions.length} subscriptions, ${allExistingBills.length} existing bills.`);

  // Group data by studentId for fast lookup
  const lessonsByStudent = new Map<string, AirtableRecord<LessonsAirtableFields>[]>();
  for (const lesson of allLessons) {
    // Check multiple possible fields for student link
    const studentLink = lesson.fields.full_name || (lesson.fields as any).Student || (lesson.fields as any).תלמיד;
    const sIds = getAllStudentIds(studentLink);
    for (const sId of sIds) {
      if (!lessonsByStudent.has(sId)) lessonsByStudent.set(sId, []);
      lessonsByStudent.get(sId)!.push(lesson);
    }
  }

  const cancellationsByStudent = new Map<string, AirtableRecord<CancellationsAirtableFields>[]>();
  for (const cancellation of allCancellations) {
    if (!cancellation.fields.student) continue;
    try {
      const sId = extractStudentId(cancellation.fields.student);
      if (!cancellationsByStudent.has(sId)) cancellationsByStudent.set(sId, []);
      cancellationsByStudent.get(sId)!.push(cancellation);
    } catch (e) {
      console.warn(`[BillingEngine] Skipping cancellation ${cancellation.id} due to invalid student link`);
    }
  }

  const subscriptionsByStudent = new Map<string, AirtableRecord<SubscriptionsAirtableFields>[]>();
  for (const sub of allSubscriptions) {
    if (!sub.fields.student_id) continue;
    try {
      const sId = extractStudentId(sub.fields.student_id);
      if (!subscriptionsByStudent.has(sId)) subscriptionsByStudent.set(sId, []);
      subscriptionsByStudent.get(sId)!.push(sub);
    } catch (e) {
      // ignore
    }
  }

  const billsByStudent = new Map<string, AirtableRecord<BillingAirtableFields>>();
  for (const bill of allExistingBills) {
    if (!bill.fields.full_name) continue;
    try {
      const sId = extractStudentId(bill.fields.full_name);
      billsByStudent.set(sId, bill);
    } catch (e) {
      // ignore
    }
  }

  const success: BillingResult[] = [];
  const errors: Array<{ studentId: string; error: DomainError | MissingFieldsError }> = [];
  const skipped: Array<{ studentId: string; reason: string }> = [];

  let chargesCreated = 0;
  let chargesUpdated = 0;
  let chargesSkipped = 0;

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const sId = student.id;

    if (isDev) {
      console.log(`[BillingEngine] Processing student ${i+1}/${students.length}: ${student.fields.full_name} (${sId})`);
    }
    
    // Always log progress in browser console during this debug phase
    console.info(`[BillingEngine] Processing ${i+1}/${students.length}: ${student.fields.full_name}`);

    try {
      const result = await buildStudentMonth(
        client, 
        sId, 
        billingMonth, 
        runId,
        {
          student,
          lessons: lessonsByStudent.get(sId) || [],
          cancellations: cancellationsByStudent.get(sId) || [],
          subscriptions: subscriptionsByStudent.get(sId) || [],
          existingBill: billsByStudent.get(sId)
        }
      );
      
      if (result instanceof MissingFieldsError || result instanceof DomainError) {
        errors.push({
          studentId: sId,
          error: result,
        });
      } else {
        success.push(result);
        if (result.created) {
          chargesCreated++;
        } else {
          chargesUpdated++;
        }
      }
    } catch (error: any) {
      if (error instanceof DuplicateBillingRecordsError) {
        errors.push({ studentId: sId, error });
      } else if (error instanceof DomainError && error.code === 'NO_BILLABLE_DATA') {
        chargesSkipped++;
        skipped.push({
          studentId: sId,
          reason: error.message || 'No billable data',
        });
      } else {
        errors.push({
          studentId: sId,
          error: new DomainError(
            error.message || 'Unknown error',
            'UNKNOWN_ERROR',
            { originalError: error }
          ),
        });
      }
    }
  }

  const summary = {
    studentsFetched: students.length,
    lessonsFetched: allLessons.length,
    cancellationsFetched: allCancellations.length,
    chargesCreated,
    chargesUpdated,
    chargesSkipped,
  };

  return { success, errors, skipped, summary };
}
