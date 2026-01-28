/**
 * Runtime Validators for Airtable Data Contract
 * 
 * Manual validation (no Zod dependency) to ensure strict compliance
 * with the data contract.
 */

import {
  StudentsAirtableFields,
  LessonsAirtableFields,
  CancellationsAirtableFields,
  SubscriptionsAirtableFields,
  BillingAirtableFields,
  LinkedRecord,
  LessonTypeValue,
  ValidationResult,
  MissingField,
} from './types';

/**
 * ============================================================================
 * UTILITY VALIDATORS
 * ============================================================================
 */

function isString(value: any): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNumber(value: any): value is number {
  return typeof value === 'number' && !isNaN(value);
}

function isBoolean(value: any): value is boolean {
  return typeof value === 'boolean';
}

function isLinkedRecord(value: any): value is LinkedRecord {
  if (typeof value === 'string') {
    return value.startsWith('rec');
  }
  if (Array.isArray(value)) {
    return value.every(item => typeof item === 'string' && item.startsWith('rec'));
  }
  return false;
}

function isDateString(value: any): boolean {
  if (!isString(value)) return false;
  // Accept YYYY-MM-DD or ISO datetime
  const dateRegex = /^\d{4}-\d{2}-\d{2}/;
  return dateRegex.test(value);
}

function isBillingMonth(value: any): boolean {
  if (!isString(value)) return false;
  // YYYY-MM format
  const billingMonthRegex = /^\d{4}-\d{2}$/;
  if (!billingMonthRegex.test(value)) return false;
  
  const [year, month] = value.split('-').map(Number);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

function isLessonType(value: any): value is LessonTypeValue {
  return value === 'פרטי' || value === 'זוגי' || value === 'קבוצתי';
}

function isBooleanOr01(value: any): boolean {
  return isBoolean(value) || value === 0 || value === 1;
}

/**
 * ============================================================================
 * STUDENTS VALIDATOR
 * ============================================================================
 */
export function validateStudentsFields(
  fields: any
): ValidationResult<StudentsAirtableFields> {
  const errors: string[] = [];
  const missingFields: MissingField[] = [];

  // Required: full_name
  if (!isString(fields.full_name)) {
    missingFields.push({
      table: 'Students',
      field: 'full_name',
      why_needed: 'Primary field - student full name',
      example_values: ['יוסי כהן', 'שרה לוי'],
    });
    errors.push('Missing or invalid: full_name');
  }

  // Required: phone_number
  if (!isString(fields.phone_number)) {
    missingFields.push({
      table: 'Students',
      field: 'phone_number',
      why_needed: 'Student contact phone number',
      example_values: ['050-1234567', '+972-50-1234567'],
    });
    errors.push('Missing or invalid: phone_number');
  }

  // Required: is_active
  if (!isBooleanOr01(fields.is_active)) {
    missingFields.push({
      table: 'Students',
      field: 'is_active',
      why_needed: 'Active status flag',
      example_values: ['true', 'false', '1', '0'],
    });
    errors.push('Missing or invalid: is_active');
  }

  // Optional: linked records (validate format if present)
  if (fields.lessons !== undefined && !isLinkedRecord(fields.lessons)) {
    errors.push('Invalid format: lessons (must be string or array of record IDs)');
  }
  if (fields.cancellations !== undefined && !isLinkedRecord(fields.cancellations)) {
    errors.push('Invalid format: cancellations (must be string or array of record IDs)');
  }
  if (fields.subscriptions !== undefined && !isLinkedRecord(fields.subscriptions)) {
    errors.push('Invalid format: subscriptions (must be string or array of record IDs)');
  }
  if (fields.billing !== undefined && !isLinkedRecord(fields.billing)) {
    errors.push('Invalid format: billing (must be string or array of record IDs)');
  }

  if (errors.length > 0 || missingFields.length > 0) {
    return {
      success: false,
      errors,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  }

  return {
    success: true,
    data: {
      full_name: fields.full_name,
      phone_number: fields.phone_number,
      is_active: fields.is_active,
      lessons: fields.lessons,
      cancellations: fields.cancellations,
      subscriptions: fields.subscriptions,
      billing: fields.billing,
    },
  };
}

/**
 * ============================================================================
 * LESSONS VALIDATOR
 * ============================================================================
 */
export function validateLessonsFields(
  fields: any
): ValidationResult<LessonsAirtableFields> {
  const errors: string[] = [];
  const missingFields: MissingField[] = [];

  // Required: lesson_id
  if (!isString(fields.lesson_id)) {
    missingFields.push({
      table: 'lessons',
      field: 'lesson_id',
      why_needed: 'Primary field - unique lesson identifier',
      example_values: ['L001', 'lesson-2024-03-15-001'],
    });
    errors.push('Missing or invalid: lesson_id');
  }

  // Required: full_name (linked)
  if (!isLinkedRecord(fields.full_name)) {
    missingFields.push({
      table: 'lessons',
      field: 'full_name',
      why_needed: 'Linked record to Students table (may be multi-link)',
      example_values: ['rec123', '["rec123", "rec456"]'],
    });
    errors.push('Missing or invalid: full_name (must be linked record)');
  }

  // Required: status
  if (!isString(fields.status)) {
    missingFields.push({
      table: 'lessons',
      field: 'status',
      why_needed: 'Lesson status',
      example_values: ['מתוכנן', 'הסתיים', 'בוטל'],
    });
    errors.push('Missing or invalid: status');
  }

  // Required: lesson_date
  if (!isDateString(fields.lesson_date)) {
    missingFields.push({
      table: 'lessons',
      field: 'lesson_date',
      why_needed: 'Lesson date',
      example_values: ['2024-03-15', '2024-03-15T00:00:00.000Z'],
    });
    errors.push('Missing or invalid: lesson_date');
  }

  // Required: start_datetime
  if (!isString(fields.start_datetime)) {
    missingFields.push({
      table: 'lessons',
      field: 'start_datetime',
      why_needed: 'Lesson start datetime (ISO format)',
      example_values: ['2024-03-15T10:00:00.000Z'],
    });
    errors.push('Missing or invalid: start_datetime');
  }

  // Required: end_datetime
  if (!isString(fields.end_datetime)) {
    missingFields.push({
      table: 'lessons',
      field: 'end_datetime',
      why_needed: 'Lesson end datetime (ISO format)',
      example_values: ['2024-03-15T11:00:00.000Z'],
    });
    errors.push('Missing or invalid: end_datetime');
  }

  // Required: lesson_type
  if (!isLessonType(fields.lesson_type)) {
    missingFields.push({
      table: 'lessons',
      field: 'lesson_type',
      why_needed: 'Lesson type: פרטי, זוגי, or קבוצתי',
      example_values: ['פרטי', 'זוגי', 'קבוצתי'],
    });
    errors.push('Missing or invalid: lesson_type (must be פרטי, זוגי, or קבוצתי)');
  }

  // Required: duration
  if (!isNumber(fields.duration) || fields.duration < 0) {
    missingFields.push({
      table: 'lessons',
      field: 'duration',
      why_needed: 'Lesson duration in minutes',
      example_values: ['60', '90', '120'],
    });
    errors.push('Missing or invalid: duration');
  }

  // Required: billing_month
  if (!isBillingMonth(fields.billing_month)) {
    missingFields.push({
      table: 'lessons',
      field: 'billing_month',
      why_needed: 'Billing month in YYYY-MM format',
      example_values: ['2024-03', '2024-04'],
    });
    errors.push('Missing or invalid: billing_month (must be YYYY-MM format)');
  }

  // Optional: billable / is_billable
  if (fields.billable !== undefined && !isBooleanOr01(fields.billable)) {
    errors.push('Invalid format: billable (must be boolean or 0/1)');
  }
  if (fields.is_billable !== undefined && !isBooleanOr01(fields.is_billable)) {
    errors.push('Invalid format: is_billable (must be boolean or 0/1)');
  }

  // Optional: line_amount
  if (fields.line_amount !== undefined && !isNumber(fields.line_amount)) {
    errors.push('Invalid format: line_amount (must be number)');
  }

  // Optional: unit_price
  if (fields.unit_price !== undefined && !isNumber(fields.unit_price)) {
    errors.push('Invalid format: unit_price (must be number)');
  }

  if (errors.length > 0 || missingFields.length > 0) {
    return {
      success: false,
      errors,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  }

  return {
    success: true,
    data: {
      lesson_id: fields.lesson_id,
      full_name: fields.full_name,
      status: fields.status,
      lesson_date: fields.lesson_date,
      start_datetime: fields.start_datetime,
      end_datetime: fields.end_datetime,
      lesson_type: fields.lesson_type,
      duration: fields.duration,
      billing_month: fields.billing_month,
      billable: fields.billable,
      is_billable: fields.is_billable,
      line_amount: fields.line_amount,
      unit_price: fields.unit_price,
    },
  };
}

/**
 * ============================================================================
 * CANCELLATIONS VALIDATOR
 * ============================================================================
 */
export function validateCancellationsFields(
  fields: any
): ValidationResult<CancellationsAirtableFields> {
  const errors: string[] = [];
  const missingFields: MissingField[] = [];

  // Required: natural_key
  if (!isString(fields.natural_key)) {
    missingFields.push({
      table: 'cancellations',
      field: 'natural_key',
      why_needed: 'Primary field - natural key identifier',
      example_values: ['CANCEL-2024-03-15-001'],
    });
    errors.push('Missing or invalid: natural_key');
  }

  // Required: lesson (linked)
  if (!isLinkedRecord(fields.lesson)) {
    missingFields.push({
      table: 'cancellations',
      field: 'lesson',
      why_needed: 'Linked record to lessons table',
      example_values: ['rec123'],
    });
    errors.push('Missing or invalid: lesson (must be linked record)');
  }

  // Required: student (linked)
  if (!isLinkedRecord(fields.student)) {
    missingFields.push({
      table: 'cancellations',
      field: 'student',
      why_needed: 'Linked record to students table',
      example_values: ['rec456'],
    });
    errors.push('Missing or invalid: student (must be linked record)');
  }

  // Required: cancellation_date
  if (!isDateString(fields.cancellation_date)) {
    missingFields.push({
      table: 'cancellations',
      field: 'cancellation_date',
      why_needed: 'Date when cancellation occurred',
      example_values: ['2024-03-15'],
    });
    errors.push('Missing or invalid: cancellation_date');
  }

  // Required: hours_before
  if (!isNumber(fields.hours_before) || fields.hours_before < 0) {
    missingFields.push({
      table: 'cancellations',
      field: 'hours_before',
      why_needed: 'Hours before lesson when cancelled',
      example_values: ['12', '24', '48'],
    });
    errors.push('Missing or invalid: hours_before');
  }

  // Required: is_lt_24h (must be 0 or 1)
  if (fields.is_lt_24h !== 0 && fields.is_lt_24h !== 1) {
    missingFields.push({
      table: 'cancellations',
      field: 'is_lt_24h',
      why_needed: 'Flag indicating if cancelled less than 24h before (0 or 1)',
      example_values: ['0', '1'],
    });
    errors.push('Missing or invalid: is_lt_24h (must be 0 or 1)');
  }

  // Required: is_charged
  if (!isBoolean(fields.is_charged)) {
    missingFields.push({
      table: 'cancellations',
      field: 'is_charged',
      why_needed: 'Boolean flag if cancellation is charged',
      example_values: ['true', 'false'],
    });
    errors.push('Missing or invalid: is_charged (must be boolean)');
  }

  // Required: charge
  if (!isNumber(fields.charge) || fields.charge < 0) {
    missingFields.push({
      table: 'cancellations',
      field: 'charge',
      why_needed: 'Charge amount for cancellation',
      example_values: ['0', '175'],
    });
    errors.push('Missing or invalid: charge');
  }

  // Required: billing_month
  if (!isBillingMonth(fields.billing_month)) {
    missingFields.push({
      table: 'cancellations',
      field: 'billing_month',
      why_needed: 'Billing month in YYYY-MM format',
      example_values: ['2024-03', '2024-04'],
    });
    errors.push('Missing or invalid: billing_month (must be YYYY-MM format)');
  }

  if (errors.length > 0 || missingFields.length > 0) {
    return {
      success: false,
      errors,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  }

  return {
    success: true,
    data: {
      natural_key: fields.natural_key,
      lesson: fields.lesson,
      student: fields.student,
      cancellation_date: fields.cancellation_date,
      hours_before: fields.hours_before,
      is_lt_24h: fields.is_lt_24h,
      is_charged: fields.is_charged,
      charge: fields.charge,
      billing_month: fields.billing_month,
    },
  };
}

/**
 * ============================================================================
 * SUBSCRIPTIONS VALIDATOR
 * ============================================================================
 */
export function validateSubscriptionsFields(
  fields: any
): ValidationResult<SubscriptionsAirtableFields> {
  const errors: string[] = [];
  const missingFields: MissingField[] = [];

  // Required: id
  if (!isString(fields.id)) {
    missingFields.push({
      table: 'Subscriptions',
      field: 'id',
      why_needed: 'Primary field - subscription identifier',
      example_values: ['SUB001', 'sub-2024-001'],
    });
    errors.push('Missing or invalid: id');
  }

  // Required: student_id (linked)
  if (!isLinkedRecord(fields.student_id)) {
    missingFields.push({
      table: 'Subscriptions',
      field: 'student_id',
      why_needed: 'Linked record to students table',
      example_values: ['rec123'],
    });
    errors.push('Missing or invalid: student_id (must be linked record)');
  }

  // Required: subscription_start_date
  if (!isDateString(fields.subscription_start_date)) {
    missingFields.push({
      table: 'Subscriptions',
      field: 'subscription_start_date',
      why_needed: 'Subscription start date',
      example_values: ['2024-01-01'],
    });
    errors.push('Missing or invalid: subscription_start_date');
  }

  // Optional: subscription_end_date
  if (fields.subscription_end_date !== undefined && !isDateString(fields.subscription_end_date)) {
    errors.push('Invalid format: subscription_end_date (must be date string)');
  }

  // Required: monthly_amount
  if (typeof fields.monthly_amount !== 'string' && typeof fields.monthly_amount !== 'number') {
    missingFields.push({
      table: 'Subscriptions',
      field: 'monthly_amount',
      why_needed: 'Monthly subscription amount (currency string or number)',
      example_values: ['₪480.00', '480', '480.00'],
    });
    errors.push('Missing or invalid: monthly_amount');
  }

  // Required: subscription_type
  if (!isString(fields.subscription_type)) {
    missingFields.push({
      table: 'Subscriptions',
      field: 'subscription_type',
      why_needed: 'Subscription type (pair/group/etc)',
      example_values: ['pair', 'group', 'זוגי', 'קבוצתי'],
    });
    errors.push('Missing or invalid: subscription_type');
  }

  // Required: pause_subscription
  if (!isBoolean(fields.pause_subscription)) {
    missingFields.push({
      table: 'Subscriptions',
      field: 'pause_subscription',
      why_needed: 'Boolean flag if subscription is paused',
      example_values: ['true', 'false'],
    });
    errors.push('Missing or invalid: pause_subscription (must be boolean)');
  }

  // Optional: pause_date
  if (fields.pause_date !== undefined && !isDateString(fields.pause_date)) {
    errors.push('Invalid format: pause_date (must be date string)');
  }

  if (errors.length > 0 || missingFields.length > 0) {
    return {
      success: false,
      errors,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  }

  return {
    success: true,
    data: {
      id: fields.id,
      student_id: fields.student_id,
      subscription_start_date: fields.subscription_start_date,
      subscription_end_date: fields.subscription_end_date,
      monthly_amount: fields.monthly_amount,
      subscription_type: fields.subscription_type,
      pause_subscription: fields.pause_subscription,
      pause_date: fields.pause_date,
    },
  };
}

/**
 * ============================================================================
 * BILLING VALIDATOR
 * ============================================================================
 */
export function validateBillingFields(
  fields: any
): ValidationResult<BillingAirtableFields> {
  const errors: string[] = [];
  const missingFields: MissingField[] = [];

  // Required: id
  if (!isString(fields.id)) {
    missingFields.push({
      table: 'Billing',
      field: 'id',
      why_needed: 'Primary field - billing identifier',
      example_values: ['BILL001', 'bill-2024-03-001'],
    });
    errors.push('Missing or invalid: id');
  }

  // Required: חודש חיוב (billing month)
  if (!isBillingMonth(fields['חודש חיוב'])) {
    missingFields.push({
      table: 'Billing',
      field: 'חודש חיוב',
      why_needed: 'Billing month in YYYY-MM format',
      example_values: ['2024-03', '2024-04'],
    });
    errors.push('Missing or invalid: חודש חיוב (must be YYYY-MM format)');
  }

  // Required: שולם (paid)
  if (!isBoolean(fields['שולם'])) {
    missingFields.push({
      table: 'Billing',
      field: 'שולם',
      why_needed: 'Boolean flag if bill is paid',
      example_values: ['true', 'false'],
    });
    errors.push('Missing or invalid: שולם (must be boolean)');
  }

  // Required: מאושר לחיוב (approved for billing)
  if (!isBoolean(fields['מאושר לחיוב'])) {
    missingFields.push({
      table: 'Billing',
      field: 'מאושר לחיוב',
      why_needed: 'Boolean flag if bill is approved for billing',
      example_values: ['true', 'false'],
    });
    errors.push('Missing or invalid: מאושר לחיוב (must be boolean)');
  }

  // Required: תלמיד (student - linked)
  if (!isLinkedRecord(fields['תלמיד'])) {
    missingFields.push({
      table: 'Billing',
      field: 'תלמיד',
      why_needed: 'Linked record to students table',
      example_values: ['rec123'],
    });
    errors.push('Missing or invalid: תלמיד (must be linked record)');
  }

  if (errors.length > 0 || missingFields.length > 0) {
    return {
      success: false,
      errors,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  }

  return {
    success: true,
    data: {
      id: fields.id,
      'חודש חיוב': fields['חודש חיוב'],
      'שולם': fields['שולם'],
      'מאושר לחיוב': fields['מאושר לחיוב'],
      'תלמיד': fields['תלמיד'],
    },
  };
}
