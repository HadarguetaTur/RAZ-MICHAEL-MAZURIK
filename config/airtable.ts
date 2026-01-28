
export const AIRTABLE_CONFIG = {
  apiKey: import.meta.env.VITE_AIRTABLE_API_KEY || '',
  baseId: import.meta.env.VITE_AIRTABLE_BASE_ID || '',
  // Use Table IDs instead of display names
  tables: {
    students: 'tblSEiCD3DrOfcnR8', // Display name: 'תלמידים'
    lessons: 'tblz6twflNw2iB832',  // Display name: 'lessons'
    teachers: 'tblZz1lyROGM0Bkjy', // Display name: 'מורים'
    homework: 'שיעורי בית',
    subscriptions: 'tblEr05NrA5PT8dlH', // Display name: 'מנויים'
    cancellations: 'tblr0UIVvJr85vEfL', // Display name: 'cancellations'
    monthlyBills: 'tblyEsDpiRkw8doxQ', // Display name: 'חיובים'
    weekly_slot: 'tbloC7G7ixYDMtdK6', // Display name: 'weekly_slot'
    slot_inventory: 'tblqMt721kMMtRIWm', // Display name: 'slot_inventory'
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
