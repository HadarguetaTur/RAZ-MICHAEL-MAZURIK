
import { Lesson, Student, Teacher, Subscription, MonthlyBill, LessonStatus, BillLineItem } from '../types';

const MOCK_TEACHERS: Teacher[] = [
  { id: 't1', name: 'רז מנהל', specialties: ['מתמטיקה', 'פיזיקה'] },
  { id: 't2', name: 'שרה לוי', specialties: ['אנגלית'] },
  { id: 't3', name: 'יוסי כהן', specialties: ['מחשבים'] },
];

const MOCK_STUDENTS: Student[] = [
  { 
    id: '1', 
    name: 'אבי כהן', 
    parentName: 'שרה כהן',
    email: 'avi@example.com', 
    phone: '050-1234567', 
    grade: 'כיתה י',
    status: 'active',
    subscriptionType: 'חודשי פרימיום', 
    balance: 0,
  },
  { 
    id: '2', 
    name: 'מיכל לוי', 
    parentName: 'דוד לוי',
    email: 'michal@example.com', 
    phone: '052-7654321', 
    grade: 'כיתה ח',
    status: 'active',
    subscriptionType: 'כרטיסייה', 
    balance: 3 
  },
  { 
    id: '3', 
    name: 'דניאל מזרחי', 
    parentName: 'משה מזרחי',
    email: 'dan@example.com', 
    phone: '054-9988776', 
    grade: 'כיתה יב',
    status: 'on_hold',
    subscriptionType: 'חודשי בסיסי', 
    balance: -150 
  },
];

let MOCK_LESSONS: Lesson[] = [
  { id: 'l1', studentId: '1', studentName: 'אבי כהן', teacherId: 't1', date: new Date().toISOString().split('T')[0], startTime: '10:00', duration: 60, status: LessonStatus.SCHEDULED, subject: 'מתמטיקה', isChargeable: true, isPrivate: true },
  { id: 'l2', studentId: '2', studentName: 'מיכל לוי', teacherId: 't1', date: new Date().toISOString().split('T')[0], startTime: '12:30', duration: 45, status: LessonStatus.SCHEDULED, subject: 'אנגלית', isChargeable: true, isPrivate: true },
  { id: 'l3', studentId: '3', studentName: 'דניאל מזרחי', teacherId: 't2', date: new Date(Date.now() + 86400000).toISOString().split('T')[0], startTime: '15:00', duration: 60, status: LessonStatus.COMPLETED, subject: 'פיזיקה', isChargeable: true, isPrivate: true },
];

export const mockData = {
  getTeachers: async (): Promise<Teacher[]> => {
    await new Promise(r => setTimeout(r, 200));
    return MOCK_TEACHERS;
  },
  getStudents: async (): Promise<{ students: Student[]; nextOffset?: string }> => {
    await new Promise(r => setTimeout(r, 200));
    return { students: MOCK_STUDENTS };
  },
  getLessons: async (start: string, end: string, teacherId?: string): Promise<Lesson[]> => {
    await new Promise(r => setTimeout(r, 300));
    let filtered = MOCK_LESSONS;
    if (teacherId && teacherId !== 'all') {
      filtered = filtered.filter(l => l.teacherId === teacherId);
    }
    return filtered;
  },
  updateLesson: async (id: string, updates: Partial<Lesson>): Promise<Lesson> => {
    await new Promise(r => setTimeout(r, 200));
    const index = MOCK_LESSONS.findIndex(l => l.id === id);
    if (index === -1) throw new Error('Lesson not found');
    MOCK_LESSONS[index] = { ...MOCK_LESSONS[index], ...updates };
    return MOCK_LESSONS[index];
  },
  getMonthlyBills: async (month: string): Promise<MonthlyBill[]> => {
    return [];
  },
  getSubscriptions: async (status: string): Promise<Subscription[]> => {
    return [];
  }
};
