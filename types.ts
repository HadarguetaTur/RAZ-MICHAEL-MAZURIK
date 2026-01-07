
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
  email: string;
  phone: string;
  grade?: string;
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
}

export interface SlotInventory {
  id: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'open' | 'booked' | 'blocked';
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

export interface SystemError {
  id: string;
  timestamp: string;
  message: string;
  code: string;
  signature: string;
  details: string;
}

export interface Teacher {
  id: string;
  name: string;
  specialties: string[];
}

export interface Subscription {
  id: string;
  studentId: string;
  planName: string;
  price: number;
  status: 'active' | 'cancelled' | 'expired';
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
  month: string;
  lessonsAmount: number;
  subscriptionsAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
  status: 'draft' | 'pending_approval' | 'link_sent' | 'paid' | 'overdue' | 'partial';
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
