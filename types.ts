
export enum LessonStatus {
  SCHEDULED = 'מתוכנן',
  COMPLETED = 'הסתיים',
  CANCELLED = 'בוטל',
  PENDING = 'ממתין',
  NOSHOW = 'לא הופיע',
  PENDING_CANCEL = 'ממתין לאישור ביטול'
}

export type LessonType = 'private' | 'pair' | 'group' | 'recurring';

export interface Student {
  id: string;
  name: string;
  parentName?: string;
  parentPhone?: string;
  email: string;
  phone: string;
  grade?: string;
  level?: string;
  subjectFocus?: string;
  weeklyLessonsLimit?: number;
  paymentStatus?: string;
  registrationDate?: string;
  lastActivity?: string;
  status: 'active' | 'on_hold' | 'inactive';
  subscriptionType: string;
  balance: number;
  notes?: string;
  homework?: { id: string; title: string; status: 'pending' | 'completed'; dueDate: string }[];
  tests?: { id: string; subject: string; date: string; result?: string }[];
}

export interface Lesson {
  id: string;
  studentId: string; // Keep for legacy/single primary student
  studentIds?: string[]; // Support for multiple students
  studentName: string;
  teacherId?: string;
  teacherName?: string;
  date: string;
  startTime: string;
  duration: number;
  status: LessonStatus;
  subject: string;
  isChargeable: boolean;
  chargeReason?: string;
  isPrivate: boolean;
  lessonType?: LessonType;
  notes?: string;
  monthlyBillId?: string;
  monthlyBillMonth?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'partial';
  attendanceConfirmed?: boolean;
  price?: number; // מחיר השיעור (ניתן לעריכה)
  /** Optional: link to weekly_slot when lesson was created from a recurring template */
  weeklySlotId?: string;
}

export interface WeeklySlot {
  id: string;
  teacherId: string;
  teacherName: string;
  dayOfWeek: number; // 0-6
  startTime: string;
  endTime: string;
  type: 'private' | 'group' | 'pair';
  status: 'active' | 'paused';
  isFixed?: boolean; // Whether this slot is fixed/recurring (from 'קבוע' field)
  reservedFor?: string; // Student ID if reserved (from 'reserved_for' field) - DEPRECATED: use reservedForIds
  reservedForIds?: string[]; // Array of student IDs (from 'reserved_for' field)
  reservedForNames?: string[]; // Array of student names (from lookup field 'full_name (from reserved_for)')
  durationMin?: number; // Duration in minutes
  hasOverlap?: boolean; // Whether this slot overlaps with other weekly slots
}

export interface SlotInventory {
  id: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'open' | 'closed' | 'canceled' | 'blocked';
  occupied?: number;
  capacityOptional?: number;
  students?: string[];
  lessons?: string[]; // Linked lesson record IDs (from slot_inventory.lessons field)
}

export interface HomeworkLibraryItem {
  id: string;
  title: string;
  subject: string;
  level: string;
  description: string;
  attachmentUrl?: string;
}

export interface HomeworkAssignment {
  id: string;
  studentId: string;
  studentName: string;
  homeworkId: string;
  homeworkTitle: string;
  status: 'assigned' | 'done' | 'reviewed';
  dueDate: string;
  assignedDate: string;
}

export interface Teacher {
  id: string;
  name: string;
  specialties: string[];
}

export interface Subscription {
  id: string;
  studentId: string;
  fullName?: string; // Lookup from student_id, may be empty
  subscriptionStartDate?: string; // Date
  subscriptionEndDate?: string; // Date
  monthlyAmount?: string; // Currency string like "₪480.00"
  subscriptionType?: string; // Single select: e.g. "קבוצתי", "זוגי"
  pauseSubscription?: boolean;
  pauseDate?: string; // Date
}

export interface BillLineItem {
  id: string;
  description: string;
  amount: number;
  type: 'lesson' | 'subscription' | 'adjustment';
  date?: string;
}

export interface MonthlyBill {
  id: string;
  studentId: string;
  studentName: string;
  parentName?: string;
  parentPhone?: string;
  month: string;
  lessonsAmount?: number;
  lessonsCount?: number;
  subscriptionsAmount?: number;
  cancellationsAmount?: number;
  adjustmentAmount: number;
  manualAdjustmentAmount?: number;
  manualAdjustmentReason?: string;
  manualAdjustmentDate?: string;
  totalAmount: number;
  status: 'draft' | 'pending_approval' | 'link_sent' | 'paid' | 'overdue' | 'partial';
  approved: boolean;
  linkSent: boolean;
  paid: boolean;
  sentAt?: string;
  paidAt?: string;
  lineItems?: BillLineItem[];
  auditLog?: { timestamp: string; event: string }[];
}

export interface ApiError {
  message: string;
  code: string;
  details?: any;
}

// Entity types for bot authorization
export type EntityPermission = 'parent' | 'admin' | 'student' | 'teacher';

export interface Entity {
  id: string;
  name: string;           // Airtable: full_name
  phone: string;          // Airtable: phone_normalized
  permission: EntityPermission;  // Airtable: role
  email?: string;         // Airtable: email
  notes?: string;         // Airtable: הערות
  studentIds?: string[];  // Airtable: full_name_ (relation to students)
}
