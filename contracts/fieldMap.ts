/**
 * Field Map: Single Source of Truth for Airtable Table IDs and Field Names
 * 
 * This file is the authoritative source for:
 * - Table IDs (exact Airtable table identifiers)
 * - Field names (exact strings as they appear in Airtable)
 * - Primary fields per table
 * - Computed fields (formula/rollup/lookup) that should not be written to
 * - Required fields per feature/operation
 * 
 * IMPORTANT: All field names must match EXACTLY as they appear in Airtable.
 * Do not guess or assume field names. If a field is not in the report, mark it as TODO.
 */

/**
 * ============================================================================
 * TABLE DEFINITIONS
 * ============================================================================
 */
export const TABLES = {
  students: {
    id: 'tblSEiCD3DrOfcnR8',
    primaryField: 'full_name',
    displayNameHe: 'תלמידים',
  },
  lessons: {
    id: 'tblz6twflNw2iB832',
    primaryField: 'lesson_id',
    displayNameHe: 'lessons',
  },
  teachers: {
    id: 'tblZz1lyROGM0Bkjy',
    primaryField: 'teacher_id',
    displayNameHe: 'מורים',
  },
  weeklySlot: {
    id: 'tbloC7G7ixYDMtdK6',
    primaryField: 'day_of_week',
    displayNameHe: 'weekly_slot',
  },
  slotInventory: {
    id: 'tblqMt721kMMtRIWm',
    primaryField: 'natural_key',
    displayNameHe: 'slot_inventory',
  },
  exams: {
    id: 'tblHNAvjJHThiOE4a',
    primaryField: 'exam_id',
    displayNameHe: 'בחינות',
  },
  cancellations: {
    id: 'tblr0UIVvJr85vEfL',
    primaryField: 'natural_key',
    displayNameHe: 'cancellations',
  },
  monthlyBills: {
    id: 'tblyEsDpiRkw8doxQ',
    primaryField: 'id',
    displayNameHe: 'חיובים',
  },
  subscriptions: {
    id: 'tblEr05NrA5PT8dlH',
    primaryField: 'id',
    displayNameHe: 'מנויים',
  },
  waitingList: {
    id: 'tbl1tDzJo3CW91FU3',
    primaryField: 'waiting_id',
    displayNameHe: 'רשימת המתנה',
  },
  entities: {
    id: 'tblhjI6Qe6yYDRF6L',
    primaryField: 'ext_id',
    displayNameHe: 'Entities',
  },
  homework: {
    id: 'tbllzo51a55mbuP0E',
    primaryField: 'assignment_id',
    displayNameHe: 'שיעורי בית',
  },
  slotBlocks: {
    id: 'tblk9sSVBGzvHdaIv',
    primaryField: 'block_batch_id',
    displayNameHe: 'Slot_Blocks',
  },
} as const;

export type TableKey = keyof typeof TABLES;

/**
 * ============================================================================
 * FIELD DEFINITIONS (Exact Airtable Field Names)
 * ============================================================================
 */
export const FIELDS = {
  students: {
    full_name: 'full_name',
    phone_number: 'phone_number',
    parent_phone: 'parent_phone',
    parent_name: 'parent_name',
    grade_level: 'grade_level',
    subject_focus: 'subject_focus',
    lesson_type: 'lesson_type',
    level: 'level',
    weekly_lessons_limit: 'weekly_lessons_limit',
    payment_status: 'payment_status',
    notes: 'Notes',
    email: 'Email',
    tazman_customer_id: 'tazman_customer_id',
    is_active: 'is_active',
    registration_date: 'registration_date',
    last_activity: 'last_activity',
    'מנוי_בקתה': 'מנוי בקתה',
    'מנוי_קבוצתי': 'מנוי קבוצתי',
    // Computed fields (read-only)
    student_id: 'student_id', // Formula: LOWER(RECORD_ID()) & phone_number
    eligibility_this_week: 'eligibility_this_week', // Formula
    eligibility_next_week: 'eligibility_next_week', // Formula
    Subscription_Monthly_Amount: 'Subscription Monthly Amount', // Formula
    'כולל_מעמ_ומנויים': 'כולל מע"מ ומנויים', // Formula - total including VAT and subscriptions
  },
  lessons: {
    lesson_id: 'lesson_id',
    full_name: 'full_name', // Linked record to students
    status: 'status',
    lesson_date: 'lesson_date',
    start_datetime: 'start_datetime',
    end_datetime: 'end_datetime',
    slot: 'slot', // Linked record to weekly_slot
    teacher_id: 'teacher_id', // Linked record to teachers
    duration: 'duration',
    lesson_type: 'lesson_type',
    attendance_confirmed: 'attendance_confirmed',
    reminder_sent: 'reminder_sent',
    cancellation_reason: 'cancellation_reason',
    price: 'price',
    calender_event_id: 'calender_event_id',
    source: 'source',
    // Computed fields (read-only)
    'פרטי_השיעור': 'פרטי השיעור', // Formula
    count_this_week: 'count_this_week', // Formula
    billing_month: 'billing_month', // Formula: YYYY-MM
    is_billable: 'is_billable', // Formula
    unit_price: 'unit_price', // Formula
    line_amount: 'line_amount', // Formula
    'קיבולת': 'קיבולת', // Formula
    is_in_current_business_week: 'is_in_current_business_week', // Formula
    is_in_next_business_week: 'is_in_next_business_week', // Formula
    business_week_start: 'business_week_start', // Formula
    business_week_end: 'business_week_end', // Formula
    StartDT: 'StartDT', // Formula
    EndDT: 'EndDT', // Formula
  },
  teachers: {
    teacher_id: 'teacher_id',
    full_name: 'full_name',
    phone_number: 'phone_number',
    email: 'email',
    subjects: 'subjects',
    hourly_rate: 'hourly_rate',
    is_primary: 'is_primary',
    is_active: 'is_active',
  },
  weeklySlot: {
    day_of_week: 'day_of_week',
    day_num: 'day_num', // Normalized day number (1-7, where 1=Sunday)
    start_time: 'start_time',
    end_time: 'end_time',
    reserved_for: 'reserved_for', // Linked record
    is_reserved: 'is_reserved',
    type: 'type',
    slot: 'slot',
    duration_min: 'duration_min',
    teacher_id: 'teacher_id', // Linked record
    'קבוע': 'קבוע',
    has_overlap: 'has_overlap',
    overlap_with: 'overlap_with', // Linked record
    overlap_details: 'overlap_details',
    // Computed fields
    'קיבולת': 'קיבולת', // Formula
  },
  slotInventory: {
    natural_key: 'natural_key',
    'מזהה_מורה': 'מזהה מורה', // Text field (deprecated - contains invalid values like "1")
    'מורה': 'מורה', // Linked Record field (preferred - use this instead)
    'תאריך_שיעור': 'תאריך שיעור',
    'שעת_התחלה': 'שעת התחלה',
    'שעת_סיום': 'שעת סיום',
    'סוג_שיעור': 'סוג שיעור',
    'חדר': 'חדר',
    'קיבולת_כוללת': 'קיבולת כוללת',
    'תפוסה_נוכחית': 'תפוסה נוכחית', // Rollup
    'סטטוס': 'סטטוס',
    'נוצר_מתוך': 'נוצר מתוך', // Linked record
    'הוחלו_חריגות': 'הוחלו חריגות',
    'הערות': 'הערות',
    day_of_week: 'day_of_week',
    is_locked: 'is_locked', // Boolean field to prevent automatic updates
    lessons: 'lessons', // Linked record to lessons
    'תלמידים': 'תלמידים', // Linked record to students (alternative field name)
    // Computed fields
    is_full: 'is_full', // Formula
    is_block: 'is_block', // Formula
    StartDT: 'StartDT', // Formula
    EndDT: 'EndDT', // Formula
  },
  exams: {
    exam_id: 'exam_id',
    student_id: 'student_id', // Linked record
    exam_date: 'exam_date',
    subject: 'subject',
    description: 'description',
    study_material: 'study_material',
    is_active: 'is_active',
    created_at: 'created_at',
    Attachments: 'Attachments',
    // Computed fields
    exam_in_current_month: 'exam_in_current_month', // Formula
  },
  cancellations: {
    natural_key: 'natural_key',
    lesson: 'lesson', // Linked record
    student: 'student', // Linked record
    lessons_status: 'lessons_status', // Lookup
    cancellation_reason: 'cancellation_reason',
    cancellation_date: 'cancellation_date',
    hours_before: 'hours_before',
    is_charged: 'is_charged',
    charge: 'charge',
    reminder_sent: 'reminder_sent',
    created_at: 'created_at',
    updated_at: 'updated_at',
    // Computed fields
    billing_month: 'billing_month', // Formula: YYYY-MM
    is_lt_24h: 'is_lt_24h', // Formula
  },
  monthlyBills: {
    id: 'id',
    full_name: 'full_name', // Linked record to students
    'חודש_חיוב': 'חודש חיוב',
    'כולל_מעמ_ומנויים': 'כולל מע"מ ומנויים', // Lookup
    Subscription_Monthly_Amount: 'Subscription Monthly Amount', // Rollup
    Late_Cancellation_Dates: 'Late Cancellation Dates', // Lookup
    'מנוי_קבוצתי': 'מנוי קבוצתי', // Lookup
    'מנוי_בקתה': 'מנוי בקתה', // Lookup
    hours_before_from_cancellations: 'hours_before (from cancellations)', // Lookup
    lesson_from_cancellations: 'lesson (from cancellations)', // Lookup
    cancellations: 'cancellations', // Lookup
    Total_Lessons_Attended_This_Month: 'Total Lessons Attended This Month', // Lookup
    'שולם': 'שולם',
    'מאושר_לחיוב': 'מאושר לחיוב',
    manual_adjustment_amount: 'manual_adjustment_amount',
    manual_adjustment_reason: 'manual_adjustment_reason',
    manual_adjustment_date: 'manual_adjustment_date',
    lessons_amount: 'lessons_amount',
    subscriptions_amount: 'subscriptions_amount',
    cancellations_amount: 'cancellations_amount',
    total_amount: 'total_amount',
    lessons_count: 'lessons_count',
  },
  subscriptions: {
    id: 'id',
    student_id: 'student_id', // Linked record
    subscription_start_date: 'subscription_start_date',
    subscription_end_date: 'subscription_end_date',
    monthly_amount: 'monthly_amount',
    subscription_type: 'subscription_type',
    pause_subscription: 'pause_subscription',
    pause_date: 'pause_date',
  },
  waitingList: {
    waiting_id: 'waiting_id',
    student_id: 'student_id', // Linked record
    requested_date: 'requested_date',
    requested_time: 'requested_time',
    priority: 'priority',
    status: 'status',
    created_at: 'created_at',
  },
  entities: {
    ext_id: 'ext_id', // Formula: LOWER(RECORD_ID())
    role: 'role',
    full_name: 'full_name',
    phone_normalized: 'phone_normalized',
    email: 'email',
    full_name_: 'full_name_', // Linked record
    'הערות': 'הערות',
  },
  homework: {
    assignment_id: 'assignment_id',
    topic: 'topic',
    description: 'description',
    status: 'status',
    'רמה': 'רמה',
    'כיתה': 'כיתה',
    'מסמכים': 'מסמכים',
    'תת_נושא': 'תת נושא',
  },
  slotBlocks: {
    block_batch_id: 'block_batch_id',
    teacher_id: 'teacher_id',
    teacher_name: 'teacher_name',
    created_at: 'created_at',
    created_by_chatId: 'created_by_chatId',
    reason: 'reason',
    status: 'status',
    slots: 'slots', // Linked record
    errors_count: 'errors_count',
    'שיעורים_שבוטלו': 'שיעורים שבוטלו', // Linked record
  },
} as const;

export type FieldKey<T extends TableKey> = keyof typeof FIELDS[T];

/**
 * ============================================================================
 * COMPUTED FIELDS (Read-only: Formula/Rollup/Lookup)
 * ============================================================================
 * These fields should NEVER be written to in API calls
 */
export const COMPUTED_FIELDS = {
  students: new Set([
    'student_id',
    'eligibility_this_week',
    'eligibility_next_week',
    'Subscription Monthly Amount',
    'כולל מע"מ ומנויים',
  ]),
  lessons: new Set([
    'פרטי השיעור',
    'count_this_week',
    'billing_month',
    'is_billable',
    'unit_price',
    'line_amount',
    'קיבולת',
    'is_in_current_business_week',
    'is_in_next_business_week',
    'business_week_start',
    'business_week_end',
    'StartDT',
    'EndDT',
  ]),
  weeklySlot: new Set([
    'קיבולת',
  ]),
  slotInventory: new Set([
    'תפוסה נוכחית',
    'is_full',
    'is_block',
    'StartDT',
    'EndDT',
  ]),
  exams: new Set([
    'exam_in_current_month',
  ]),
  cancellations: new Set([
    'lessons_status',
    'billing_month',
    'is_lt_24h',
  ]),
  monthlyBills: new Set([
    'כולל מע"מ ומנויים',
    'Subscription Monthly Amount',
    'Late Cancellation Dates',
    'מנוי קבוצתי',
    'מנוי בקתה',
    'hours_before (from cancellations)',
    'lesson (from cancellations)',
    'cancellations',
    'Total Lessons Attended This Month',
  ]),
  entities: new Set([
    'ext_id',
  ]),
  teachers: new Set([]),
  subscriptions: new Set([]),
  waitingList: new Set([]),
  homework: new Set([]),
  slotBlocks: new Set([]),
} as const;

/**
 * ============================================================================
 * REQUIRED FIELDS PER FEATURE
 * ============================================================================
 */
export const REQUIRED_FIELDS = {
  students: {
    list: ['full_name', 'phone_number', 'is_active'],
    details: ['full_name', 'phone_number', 'parent_phone', 'parent_name', 'grade_level', 'is_active'],
  },
  lessons: {
    list: ['lesson_id', 'full_name', 'status', 'lesson_date', 'start_datetime', 'end_datetime'],
    create: ['full_name', 'status', 'lesson_date', 'start_datetime', 'end_datetime'],
    updateStatus: ['status'],
  },
  billing: {
    buildMonthly: [
      'id',
      'full_name',
      'חודש חיוב',
      'כולל מע"מ ומנויים',
      'שולם',
      'מאושר לחיוב',
    ],
  },
  subscriptions: {
    list: ['id', 'student_id', 'subscription_start_date', 'subscription_type', 'monthly_amount'],
    create: ['student_id', 'subscription_start_date', 'subscription_type', 'monthly_amount'],
  },
  teachers: {
    list: ['teacher_id', 'full_name', 'is_active'],
  },
} as const;

/**
 * ============================================================================
 * TODO: MISSING FIELDS
 * ============================================================================
 * Fields that appear in code but are not documented in the report
 */
export const TODO_MISSING_FIELDS = [
  {
    table: 'lessons',
    field: 'Student', // Used in code but not in report - might be lookup field
    why_needed: 'Used in createLesson and conflict checks',
    feature: 'lessons.create',
  },
  {
    table: 'lessons',
    field: 'Teacher', // Used in code but not in report - might be lookup field
    why_needed: 'Used in createLesson and conflict checks',
    feature: 'lessons.create',
  },
  {
    table: 'lessons',
    field: 'Student_ID', // Used in code but not in report
    why_needed: 'Used in mapAirtableToLesson',
    feature: 'lessons.list',
  },
  {
    table: 'lessons',
    field: 'Teacher_ID', // Used in code but not in report
    why_needed: 'Used in mapAirtableToLesson',
    feature: 'lessons.list',
  },
  {
    table: 'lessons',
    field: 'Student_Name', // Used in code but not in report
    why_needed: 'Used in mapAirtableToLesson',
    feature: 'lessons.list',
  },
  {
    table: 'lessons',
    field: 'Teacher_Name', // Used in code but not in report
    why_needed: 'Used in mapAirtableToLesson',
    feature: 'lessons.list',
  },
] as const;

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Get table ID by logical table key
 */
export function getTableId(tableKey: TableKey): string {
  return TABLES[tableKey].id;
}

/**
 * Get field name by logical table and field keys
 */
export function getField<T extends TableKey>(
  tableKey: T,
  logicalFieldKey: FieldKey<T>
): string {
  const fieldMap = FIELDS[tableKey];
  const fieldName = fieldMap[logicalFieldKey as keyof typeof fieldMap];
  if (!fieldName) {
    throw new Error(
      `Field "${String(logicalFieldKey)}" not found in table "${tableKey}". ` +
      `Available fields: ${Object.keys(fieldMap).join(', ')}`
    );
  }
  return fieldName;
}

/**
 * Check if a field is computed (read-only)
 */
export function isComputedField(tableKey: TableKey, fieldName: string): boolean {
  const computedSet = COMPUTED_FIELDS[tableKey];
  return computedSet ? computedSet.has(fieldName) : false;
}

/**
 * Assert that all required fields are present in a record
 */
export function assertRequiredFields<T extends TableKey>(
  tableKey: T,
  recordFields: Record<string, any>,
  requiredSetName: keyof typeof REQUIRED_FIELDS[T]
): void {
  const requiredFields = REQUIRED_FIELDS[tableKey]?.[requiredSetName];
  if (!requiredFields) {
    throw new Error(
      `Required field set "${String(requiredSetName)}" not defined for table "${tableKey}"`
    );
  }

  const missing: string[] = [];
  for (const logicalField of requiredFields) {
    const fieldName = getField(tableKey, logicalField as FieldKey<T>);
    if (!(fieldName in recordFields) || recordFields[fieldName] === undefined || recordFields[fieldName] === null) {
      missing.push(fieldName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required fields for ${tableKey}.${String(requiredSetName)}: ${missing.join(', ')}`
    );
  }
}

/**
 * Get primary field name for a table
 */
export function getPrimaryField(tableKey: TableKey): string {
  return TABLES[tableKey].primaryField;
}

/**
 * Filter out computed fields from a record object (for write operations)
 */
export function filterComputedFields<T extends TableKey>(
  tableKey: T,
  fields: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  const computedSet = COMPUTED_FIELDS[tableKey];
  
  for (const [fieldName, value] of Object.entries(fields)) {
    if (!computedSet || !computedSet.has(fieldName)) {
      result[fieldName] = value;
    }
  }
  
  return result;
}
