/**
 * Server-side env accessor only.
 * Airtable secrets must never be resolved from import.meta.env / VITE_*.
 */
const getEnv = (name: string): string => {
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[name] || '';
    if (fromProcess) return fromProcess;
  }
  return '';
};

export const AIRTABLE_CONFIG = {
  apiKey: getEnv('AIRTABLE_API_KEY'),
  baseId: getEnv('AIRTABLE_BASE_ID'),
  // Use Table IDs instead of display names
  tables: {
    students: 'tblSEiCD3DrOfcnR8', // Display name: 'תלמידים'
    lessons: 'tblz6twflNw2iB832',  // Display name: 'lessons'
    teachers: 'tblZz1lyROGM0Bkjy', // Display name: 'מורים'
    homework: 'tbllzo51a55mbuP0E',
    subscriptions: 'tblEr05NrA5PT8dlH', // Display name: 'מנויים'
    cancellations: 'tblr0UIVvJr85vEfL', // Display name: 'cancellations'
    monthlyBills: 'tblyEsDpiRkw8doxQ', // Display name: 'חיובים'
    weekly_slot: 'tbloC7G7ixYDMtdK6', // Display name: 'weekly_slot'
    slot_inventory: 'tblqMt721kMMtRIWm', // Display name: 'slot_inventory'
    entities: 'tblhjI6Qe6yYDRF6L', // Display name: 'Entities' - bot authorized users
    studentGroups: 'tblUURXeFzvg2hcGQ', // Display name: 'קבוצות תלמידים'
  },
  fields: {
    // Students fields
    studentFullName: 'full_name',
    studentPhone: 'phone_number',
    studentParentPhone: 'parent_phone',
    // Lessons fields - STRICT MAPPING (only include fields that exist in Airtable)
    lessonDate: 'lesson_date',
    lessonStartDatetime: 'start_datetime',
    lessonEndDatetime: 'end_datetime',
    lessonStatus: 'status',
    lessonDetails: 'פרטי השיעור', // Primary display field for lesson cards
    // Linked record fields (exact field names as they appear in Airtable)
    lessonStudent: 'Student', // Linked record field for student in lessons table
    lessonTeacher: 'Teacher', // Linked record field for teacher in lessons table
    // Monthly Bills (חיובים) fields
    billingStudent: 'full_name',
    billingMonth: 'חודש חיוב',
    billingApproved: 'מאושר לחיוב',
    billingLinkSent: 'נשלח קישור',
    billingPaid: 'שולם',
    // Optional fields - ONLY add if field exists in Airtable (discovered via getLessons logs)
    // lessonSubject: undefined, // TODO: Discover from existing records - DO NOT use until confirmed
    // lessonType: undefined, // TODO: Discover from existing records - DO NOT use until confirmed
    // Read-only formula fields (do not write to these):
    // unitPrice: 'unit_price', // Formula field - read-only
    // lineAmount: 'line_amount', // Formula field - read-only
    // source: 'source', // May be read-only
    // cancellationReason: 'cancellation_reason', // May be read-only
  }
};
