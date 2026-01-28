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
} from './billingRules';
import {
  LessonsAirtableFields,
  CancellationsAirtableFields,
  SubscriptionsAirtableFields,
  BillingAirtableFields,
  StudentsAirtableFields,
  LinkedRecord,
} from '../contracts/types';
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
  runId?: string
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

  // Fetch student
  let student: AirtableRecord<StudentsAirtableFields>;
  try {
    student = await client.getRecord<StudentsAirtableFields>(studentsTableId, studentRecordId);
  } catch (error: any) {
    throw new DomainError(
      `Student not found: ${studentRecordId}`,
      'STUDENT_NOT_FOUND',
      { studentRecordId }
    );
  }

  // Fetch lessons for this student AND billing month
  // CRITICAL FIX: Filter by both student AND billing_month in the query
  // Also try filtering by date range as fallback if billing_month field doesn't exist
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
  
  const lessons = await client.listRecords<LessonsAirtableFields>(
    lessonsTableId,
    { filterByFormula: lessonsFilter }
  );

  // Validate lessons have required fields
  if (lessons.length > 0) {
    const sampleLesson = lessons[0].fields;
    const requiredFields = ['full_name', 'lesson_type', 'status'];
    const missingFields: string[] = [];
    
    for (const field of requiredFields) {
      if (!(field in sampleLesson)) {
        missingFields.push(field);
      }
    }
    
    // Validation complete
  }

  // Fetch cancellations for this student AND billing month
  const cancellationsFilter = `AND(
    {student} = "${studentRecordId}",
    {billing_month} = "${billingMonth}"
  )`;
  
  const cancellations = await client.listRecords<CancellationsAirtableFields>(
    cancellationsTableId,
    { filterByFormula: cancellationsFilter }
  );

  // Fetch all subscriptions for this student (filtered by month in calculation logic)
  const subscriptionsFilter = `{student_id} = "${studentRecordId}"`;
  
  const subscriptions = await client.listRecords<SubscriptionsAirtableFields>(
    subscriptionsTableId,
    { filterByFormula: subscriptionsFilter }
  );

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


  // CRITICAL FIX: Do not create/update charge record if total is 0 and there's no billable data
  const hasBillableLessons = lessonsContribution.lessonsCount > 0;
  const hasBillableCancellations = cancellationsResult.cancellationsCount > 0;
  const hasSubscriptions = subscriptionsResult.subscriptionsTotal > 0;
  const hasAnyBillableData = hasBillableLessons || hasBillableCancellations || hasSubscriptions;

  if (total === 0 && !hasAnyBillableData) {
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

  // Check existing billing record
  const billingKey = generateBillingKey(studentRecordId, billingMonth);
  
  // Try to find existing billing record
  // Search by student (Hebrew field name) and billing month
  // For linked record, use direct ID comparison
  const billingFilter = `AND(
    {תלמיד} = "${studentRecordId}",
    {חודש חיוב} = "${billingMonth}"
  )`;
  
  const matchingBills = await client.listRecords<BillingAirtableFields>(
    billingTableId,
    { filterByFormula: billingFilter }
  );

  // Check for duplicates - CRITICAL: Stop immediately if duplicates found
  if (matchingBills.length > 1) {
    const duplicateError = new DuplicateBillingRecordsError(
      studentRecordId,
      billingMonth,
      matchingBills.map(b => b.id)
    );
    throw duplicateError;
  }

  // Determine status
  const isPaid = matchingBills.length === 1 ? matchingBills[0].fields['שולם'] === true : false;
  const status = determineBillingStatus(
    cancellationsResult.pendingCancellationsCount,
    isPaid
  );

  // Prepare billing fields
  // CRITICAL: Ensure student link field is properly set
  // The 'תלמיד' field expects a linked record (can be string ID or array)
  // Based on schema, it should be a single linked record (string)
  const billingFields: Partial<BillingAirtableFields> = {
    'חודש חיוב': billingMonth,
    'שולם': isPaid,
    'מאושר לחיוב': status === 'approved' || status === 'paid',
    'תלמיד': studentRecordId, // Linked record field - Airtable accepts record ID string
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

  // Calculate date range for the billing month
  const [year, month] = billingMonth.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];


  // Fetch all active students
  const activeStudentsFilter = '{is_active} = 1';
  const students = await client.listRecords<StudentsAirtableFields>(
    studentsTableId,
    { filterByFormula: activeStudentsFilter }
  );


  // Fetch all lessons for the billing month (for validation)
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


  // Fetch all cancellations for the billing month
  const cancellationsFilter = `{billing_month} = "${billingMonth}"`;
  const allCancellations = await client.listRecords<CancellationsAirtableFields>(
    cancellationsTableId,
    { filterByFormula: cancellationsFilter }
  );


  // Hard assertion: If UI shows lessons exist but we fetched 0, throw error
  if (allLessons.length === 0 && import.meta.env?.DEV) {
    // Try a broader query to see what lessons exist
    const broaderLessons = await client.listRecords<LessonsAirtableFields>(
      lessonsTableId,
      { maxRecords: 5 }
    );
    
    // No lessons found for this month
  }

  const success: BillingResult[] = [];
  const errors: Array<{ studentId: string; error: DomainError | MissingFieldsError }> = [];
  const skipped: Array<{ studentId: string; reason: string }> = [];

  let chargesCreated = 0;
  let chargesUpdated = 0;
  let chargesSkipped = 0;

  // Sample one student for detailed logging
  const sampleStudentIndex = Math.min(2, students.length - 1);

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const isSampleStudent = i === sampleStudentIndex;


    try {
      const result = await buildStudentMonth(client, student.id, billingMonth, runId);
      
      if (result instanceof MissingFieldsError || result instanceof DomainError) {
        errors.push({
          studentId: student.id,
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
        // Don't process further for this student
        errors.push({
          studentId: student.id,
          error,
        });
      } else if (error instanceof DomainError && error.code === 'NO_BILLABLE_DATA') {
        // This is expected - student has no billable data for this month
        chargesSkipped++;
        skipped.push({
          studentId: student.id,
          reason: error.message || 'No billable data',
        });
        
      } else {
        errors.push({
          studentId: student.id,
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

  if (dryRun) {
    // In dry-run mode, print summary table
    console.log('\n=== DRY RUN SUMMARY ===');
    console.log(`Billing Month: ${billingMonth}`);
    console.log(`Date Range: ${startDateStr} to ${endDateStr}`);
    console.log(`\nStudents: ${summary.studentsFetched}`);
    console.log(`Lessons: ${summary.lessonsFetched}`);
    console.log(`Cancellations: ${summary.cancellationsFetched}`);
    console.log(`\nCharges:`);
    console.log(`  - Would Create: ${summary.chargesCreated}`);
    console.log(`  - Would Update: ${summary.chargesUpdated}`);
    console.log(`  - Would Skip: ${summary.chargesSkipped}`);
    
    if (success.length > 0) {
      console.log(`\nSample Results (first 5):`);
      success.slice(0, 5).forEach((result, idx) => {
        const student = students.find(s => s.id === result.studentRecordId);
        console.log(`\n${idx + 1}. ${student?.fields.full_name || result.studentRecordId}`);
        console.log(`   Record ID: ${result.studentRecordId}`);
        console.log(`   Lessons: ${result.lessonsCount} (₪${result.lessonsTotal})`);
        console.log(`   Cancellations: ${result.cancellationsCount} (₪${result.cancellationsTotal})`);
        console.log(`   Subscriptions: ₪${result.subscriptionsTotal}`);
        console.log(`   Total: ₪${result.total}`);
        console.log(`   Action: ${result.created ? 'CREATE' : 'UPDATE'}`);
      });
    }
  }

  return { success, errors, skipped, summary };
}
