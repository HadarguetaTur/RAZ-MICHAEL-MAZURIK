
export const AIRTABLE_CONFIG = {
  apiKey: process.env.AIRTABLE_API_KEY,
  baseId: process.env.AIRTABLE_BASE_ID,
  tables: {
    students: 'Students',
    lessons: 'Lessons',
    teachers: 'Teachers',
    subscriptions: 'Subscriptions',
    monthlyBills: 'MonthlyBills',
    weeklySlots: 'WeeklySlots',
    slotInventory: 'SlotInventory',
  },
  fields: {
    // Common mappings
    id: 'ID',
    createdAt: 'Created At',
    // Lesson specific
    student: 'Student_Link',
    teacher: 'Teacher_Link',
    date: 'Date',
    startTime: 'Start Time',
    status: 'Status',
    isRecurring: 'Is Recurring',
    // Subscription specific
    billingCycle: 'Billing Cycle',
    planType: 'Plan Type',
  }
};
