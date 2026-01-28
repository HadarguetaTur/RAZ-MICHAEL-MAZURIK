/**
 * Strict Data Contract Types for Airtable Tables
 * 
 * These types represent the EXACT structure of Airtable records.
 * Only fields explicitly listed in the contract are included.
 * 
 * Table IDs:
 * - Students: tblSEiCD3DrOfcnR8
 * - lessons: tblz6twflNw2iB832
 * - cancellations: tblr0UIVvJr85vEfL
 * - Subscriptions: tblEr05NrA5PT8dlH
 * - Billing: tbllyEsDpiRkw8doxQ
 */

/**
 * Airtable record structure (all tables follow this)
 */
export interface AirtableRecord<T> {
  id: string; // Airtable record ID (e.g., "rec...")
  fields: T;
  createdTime?: string;
}

/**
 * Linked record field (can be single string ID or array of IDs)
 */
export type LinkedRecord = string | string[];

/**
 * Lesson type values (Hebrew)
 */
export type LessonTypeValue = 'פרטי' | 'זוגי' | 'קבוצתי';

/**
 * ============================================================================
 * STUDENTS TABLE (tblSEiCD3DrOfcnR8)
 * ============================================================================
 */
export interface StudentsAirtableFields {
  /** Primary field - student full name */
  full_name: string;
  
  /** Phone number */
  phone_number: string;
  
  /** Active status (boolean or 0/1) */
  is_active: boolean | 0 | 1;
  
  /** Linked records to lessons table */
  lessons?: LinkedRecord;
  
  /** Linked records to cancellations table */
  cancellations?: LinkedRecord;
  
  /** Linked records to subscriptions table */
  subscriptions?: LinkedRecord;
  
  /** Linked records to billing table */
  billing?: LinkedRecord;
}

export type StudentsRecord = AirtableRecord<StudentsAirtableFields>;

/**
 * ============================================================================
 * LESSONS TABLE (tblz6twflNw2iB832)
 * ============================================================================
 */
export interface LessonsAirtableFields {
  /** Primary field - lesson ID */
  lesson_id: string;
  
  /** Linked to Students (may be multi-link) */
  full_name: LinkedRecord;
  
  /** Lesson status */
  status: string;
  
  /** Lesson date */
  lesson_date: string; // Date format
  
  /** Start datetime */
  start_datetime: string; // ISO datetime string
  
  /** End datetime */
  end_datetime: string; // ISO datetime string
  
  /** Lesson type: פרטי, זוגי, קבוצתי */
  lesson_type: LessonTypeValue;
  
  /** Duration (in minutes) */
  duration: number;
  
  /** Billing month (YYYY-MM format) */
  billing_month: string;
  
  /** Billable flag (optional - may not exist) */
  billable?: boolean | 0 | 1;
  is_billable?: boolean | 0 | 1;
  
  /** Line amount (optional - may not exist) */
  line_amount?: number;
  
  /** Unit price (optional - may not exist) */
  unit_price?: number;
}

export type LessonsRecord = AirtableRecord<LessonsAirtableFields>;

/**
 * ============================================================================
 * CANCELLATIONS TABLE (tblr0UIVvJr85vEfL)
 * ============================================================================
 */
export interface CancellationsAirtableFields {
  /** Primary field - natural key */
  natural_key: string;
  
  /** Linked to lessons table */
  lesson: LinkedRecord;
  
  /** Linked to students table */
  student: LinkedRecord;
  
  /** Cancellation date */
  cancellation_date: string; // Date format
  
  /** Hours before lesson */
  hours_before: number;
  
  /** Is less than 24 hours (0 or 1) */
  is_lt_24h: 0 | 1;
  
  /** Is charged (boolean) */
  is_charged: boolean;
  
  /** Charge amount */
  charge: number;
  
  /** Billing month (YYYY-MM format) */
  billing_month: string;
}

export type CancellationsRecord = AirtableRecord<CancellationsAirtableFields>;

/**
 * ============================================================================
 * SUBSCRIPTIONS TABLE (tblEr05NrA5PT8dlH)
 * ============================================================================
 */
export interface SubscriptionsAirtableFields {
  /** Primary field - subscription ID */
  id: string;
  
  /** Linked to students table */
  student_id: LinkedRecord;
  
  /** Subscription start date */
  subscription_start_date: string; // Date format
  
  /** Subscription end date */
  subscription_end_date?: string; // Date format (optional)
  
  /** Monthly amount (currency string or number) */
  monthly_amount: string | number;
  
  /** Subscription type (pair/group/etc) */
  subscription_type: string;
  
  /** Pause subscription flag */
  pause_subscription: boolean;
  
  /** Pause date */
  pause_date?: string; // Date format (optional)
}

export type SubscriptionsRecord = AirtableRecord<SubscriptionsAirtableFields>;

/**
 * ============================================================================
 * BILLING TABLE (tbllyEsDpiRkw8doxQ)
 * ============================================================================
 * 
 * Note: This table uses Hebrew field names
 */
export interface BillingAirtableFields {
  /** Primary field - billing ID */
  id: string;
  
  /** Billing month (YYYY-MM format) - Hebrew: "חודש חיוב" */
  'חודש חיוב': string;
  
  /** Paid status (boolean) - Hebrew: "שולם" */
  'שולם': boolean;
  
  /** Approved for billing (boolean) - Hebrew: "מאושר לחיוב" */
  'מאושר לחיוב': boolean;
  
  /** Linked to students table - Hebrew: "תלמיד" */
  'תלמיד': LinkedRecord;
}

export type BillingRecord = AirtableRecord<BillingAirtableFields>;

/**
 * ============================================================================
 * WEEKLY SLOT TABLE (tbloC7G7ixYDMtdK6)
 * ============================================================================
 */
export interface WeeklySlotAirtableFields {
  /** Primary field - day of week (Select field - expects string) */
  day_of_week: string | number; // Can be "0"-"6" or 0-6 (0 = Sunday)
  
  /** Normalized day number - 1-7 where 1=Sunday, 7=Saturday */
  day_num?: number; // 1-7 format (1 = Sunday)
  
  /** Start time */
  start_time: string; // Time format (HH:mm)
  
  /** End time */
  end_time: string; // Time format (HH:mm)
  
  /** Reserved for (linked record to students) */
  reserved_for?: LinkedRecord;
  
  /** Is reserved (boolean) */
  is_reserved?: boolean | 0 | 1;
  
  /** Type: פרטי, זוגי, קבוצתי */
  type?: string;
  
  /** Slot identifier */
  slot?: string;
  
  /** Duration in minutes */
  duration_min?: number;
  
  /** Teacher ID (linked record) */
  teacher_id: LinkedRecord;
  
  /** קבוע - Fixed/recurring slot (boolean) */
  'קבוע'?: boolean | 0 | 1;
  
  /** Has overlap (boolean) */
  has_overlap?: boolean | 0 | 1;
  
  /** Overlap with (linked record) */
  overlap_with?: LinkedRecord;
  
  /** Overlap details */
  overlap_details?: string;
  
  // Computed fields (read-only)
  /** קיבולת - Capacity (formula) */
  'קיבולת'?: number;
}

export type WeeklySlotRecord = AirtableRecord<WeeklySlotAirtableFields>;

/**
 * ============================================================================
 * SLOT INVENTORY TABLE (tblqMt721kMMtRIWm)
 * ============================================================================
 * 
 * Note: This table uses Hebrew field names
 */
export interface SlotInventoryAirtableFields {
  /** Primary field - natural key */
  natural_key: string;
  
  /** Teacher ID - Hebrew: "מזהה מורה" (Text field - deprecated, contains invalid values) */
  'מזהה_מורה'?: LinkedRecord;
  
  /** Teacher - Hebrew: "מורה" (Linked Record - preferred field) */
  'מורה'?: LinkedRecord;
  
  /** Lesson date - Hebrew: "תאריך שיעור" */
  'תאריך_שיעור': string; // Date format
  
  /** Start time - Hebrew: "שעת התחלה" */
  'שעת_התחלה': string; // Time format (HH:mm)
  
  /** End time - Hebrew: "שעת סיום" */
  'שעת_סיום': string; // Time format (HH:mm)
  
  /** Lesson type - Hebrew: "סוג שיעור" */
  'סוג_שיעור'?: string;
  
  /** Room - Hebrew: "חדר" */
  'חדר'?: string;
  
  /** Total capacity - Hebrew: "קיבולת כוללת" */
  'קיבולת_כוללת'?: number;
  
  /** Current occupancy - Hebrew: "תפוסה נוכחית" (rollup) */
  'תפוסה_נוכחית'?: number;
  
  /** Status - Hebrew: "סטטוס" */
  'סטטוס'?: string; // open/booked/blocked
  
  /** Created from (linked record to weekly_slot) - Hebrew: "נוצר מתוך" */
  'נוצר_מתוך'?: LinkedRecord;
  
  /** Exceptions applied - Hebrew: "הוחלו חריגות" */
  'הוחלו_חריגות'?: boolean | 0 | 1;
  
  /** Notes - Hebrew: "הערות" */
  'הערות'?: string;
  
  /** Day of week */
  day_of_week?: number;
  
  /** Is locked - prevents automatic updates (boolean) */
  is_locked?: boolean | 0 | 1;
  
  /** Linked to lessons table */
  lessons?: LinkedRecord;
  
  /** Linked to students table - Hebrew: "תלמידים" */
  'תלמידים'?: LinkedRecord;
  
  // Computed fields (read-only)
  /** Is full (formula) */
  is_full?: boolean;
  
  /** Is block (formula) */
  is_block?: boolean;
  
  /** Start datetime (formula) */
  StartDT?: string;
  
  /** End datetime (formula) */
  EndDT?: string;
}

export type SlotInventoryRecord = AirtableRecord<SlotInventoryAirtableFields>;

/**
 * ============================================================================
 * MISSING FIELDS ERROR TYPE
 * ============================================================================
 */
export interface MissingField {
  table: string;
  field: string;
  why_needed: string;
  example_values: string[];
}

export interface MissingFieldsError {
  MISSING_FIELDS: MissingField[];
}

/**
 * ============================================================================
 * VALIDATION RESULT
 * ============================================================================
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
  missingFields?: MissingField[];
}
