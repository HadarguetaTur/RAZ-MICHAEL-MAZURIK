
import { Lesson, Student, Teacher, Subscription, MonthlyBill, LessonStatus, SystemError, HomeworkLibraryItem, HomeworkAssignment, WeeklySlot, SlotInventory } from '../types';
import { mockData } from './mockApi';

const API_BASE_URL = process.env.API_BASE_URL || '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = 'שגיאת שרת לא ידועה';
    let errorCode = 'SERVER_ERROR';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
      errorCode = errorData.code || errorCode;
    } catch (e) {
      errorMessage = response.statusText || errorMessage;
    }
    throw { message: errorMessage, code: errorCode, status: response.status };
  }
  return response.json() as Promise<T>;
}

export const parseApiError = (err: any): string => {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  return 'אירעה שגיאה בלתי צפויה';
};

async function withFallback<T>(apiCall: () => Promise<T>, fallbackData: T | (() => Promise<T>)): Promise<T> {
  try {
    return await apiCall();
  } catch (err: any) {
    if (err.status === 404 || err.message?.includes('Failed to fetch')) {
      return typeof fallbackData === 'function' ? (fallbackData as any)() : fallbackData;
    }
    throw err;
  }
}

export const nexusApi = {
  getTeachers: (): Promise<Teacher[]> => 
    withFallback(
      () => fetch(`${API_BASE_URL}/teachers`).then(res => handleResponse<Teacher[]>(res)),
      mockData.getTeachers
    ),

  getStudents: (page: number = 1): Promise<Student[]> => 
    withFallback(
      () => fetch(`${API_BASE_URL}/students?page=${page}`).then(res => handleResponse<Student[]>(res)),
      mockData.getStudents
    ),

  getLessons: (start: string, end: string, teacherId?: string): Promise<Lesson[]> => 
    withFallback(
      () => {
        const params = new URLSearchParams({ start, end });
        if (teacherId) params.append('teacherId', teacherId);
        return fetch(`${API_BASE_URL}/lessons?${params.toString()}`).then(res => handleResponse<Lesson[]>(res));
      },
      () => mockData.getLessons(start, end, teacherId)
    ),

  getWeeklySlots: (): Promise<WeeklySlot[]> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/weekly-slots`).then(res => handleResponse<WeeklySlot[]>(res)),
      async () => [
        { id: 'ws1', teacherId: 't1', teacherName: 'רז מנהל', dayOfWeek: 0, startTime: '16:00', endTime: '17:00', type: 'private', status: 'active' },
        { id: 'ws2', teacherId: 't1', teacherName: 'רז מנהל', dayOfWeek: 0, startTime: '17:00', endTime: '18:00', type: 'private', status: 'active' },
        { id: 'ws3', teacherId: 't2', teacherName: 'שרה לוי', dayOfWeek: 1, startTime: '15:30', endTime: '16:30', type: 'group', status: 'active' },
      ]
    ),

  getSlotInventory: (start: string, end: string): Promise<SlotInventory[]> =>
    withFallback(
      () => {
        const params = new URLSearchParams({ start, end });
        return fetch(`${API_BASE_URL}/slot-inventory?${params.toString()}`).then(res => handleResponse<SlotInventory[]>(res));
      },
      async () => [
        { id: 'inv1', teacherId: 't1', teacherName: 'רז מנהל', date: '2024-03-24', startTime: '16:00', endTime: '17:00', status: 'booked' },
        { id: 'inv2', teacherId: 't1', teacherName: 'רז מנהל', date: '2024-03-24', startTime: '17:00', endTime: '18:00', status: 'open' },
        { id: 'inv3', teacherId: 't1', teacherName: 'רז מנהל', date: '2024-03-25', startTime: '16:00', endTime: '17:00', status: 'blocked' },
      ]
    ),

  updateWeeklySlot: (id: string, updates: Partial<WeeklySlot>): Promise<WeeklySlot> =>
    fetch(`${API_BASE_URL}/weekly-slots/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }).then(res => handleResponse<WeeklySlot>(res)).catch(() => ({ id, ...updates } as WeeklySlot)),

  updateSlotInventory: (id: string, updates: Partial<SlotInventory>): Promise<SlotInventory> =>
    fetch(`${API_BASE_URL}/slot-inventory/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }).then(res => handleResponse<SlotInventory>(res)).catch(() => ({ id, ...updates } as SlotInventory)),

  getHomeworkLibrary: (): Promise<HomeworkLibraryItem[]> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/homework-library`).then(res => handleResponse<HomeworkLibraryItem[]>(res)),
      async () => [
        { id: 'hw1', title: 'פונקציות קוויות - בסיס', subject: 'מתמטיקה', level: 'כיתה ט', description: 'תרגול בסיסי של שיפוע ונקודת חיתוך' },
        { id: 'hw2', title: 'Present Simple Mastery', subject: 'אנגלית', level: 'מתחילים', description: 'Verb to be and regular verbs practice' },
        { id: 'hw3', title: 'מכניקה - קינמטיקה', subject: 'פיזיקה', level: 'תיכון', description: 'תנועה שוות תאוצה' }
      ]
    ),

  getHomeworkAssignments: (): Promise<HomeworkAssignment[]> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/homework-assignments`).then(res => handleResponse<HomeworkAssignment[]>(res)),
      async () => [
        { id: 'as1', studentId: '1', studentName: 'אבי כהן', homeworkId: 'hw1', homeworkTitle: 'פונקציות קוויות', status: 'assigned', dueDate: '2024-03-30', assignedDate: '2024-03-20' }
      ]
    ),

  assignHomework: (payload: Partial<HomeworkAssignment>): Promise<HomeworkAssignment> =>
    fetch(`${API_BASE_URL}/homework-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(res => handleResponse<HomeworkAssignment>(res)).catch(() => ({
      id: Math.random().toString(36).substr(2, 9),
      ...payload,
      assignedDate: new Date().toISOString(),
      status: 'assigned'
    } as HomeworkAssignment)),

  getSystemErrors: (): Promise<SystemError[]> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/errors`).then(res => handleResponse<SystemError[]>(res)),
      mockData.getSystemErrors
    ),

  updateLesson: (id: string, updates: Partial<Lesson>): Promise<Lesson> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/lessons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      }).then(res => handleResponse<Lesson>(res)),
      () => mockData.updateLesson(id, updates)
    ),

  getMonthlyBills: (month: string): Promise<MonthlyBill[]> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/monthly-bills?month=${month}`).then(res => handleResponse<MonthlyBill[]>(res)),
      () => mockData.getMonthlyBills(month)
    ),

  approveAndSendBill: (id: string): Promise<void> =>
    fetch(`${API_BASE_URL}/monthly-bills/${id}/approve-and-send`, { method: 'POST' }).then(() => {}).catch(() => {
      console.warn('Fallback: Approve and send billed mock (UI only)');
    }),

  markBillPaid: (id: string): Promise<void> =>
    fetch(`${API_BASE_URL}/monthly-bills/${id}/mark-paid`, { method: 'POST' }).then(() => {}).catch(() => {
      console.warn('Fallback: Mark paid billed mock (UI only)');
    }),

  getSubscriptions: (status: string = 'active'): Promise<Subscription[]> =>
    withFallback(
      () => fetch(`${API_BASE_URL}/subscriptions?status=${status}`).then(res => handleResponse<Subscription[]>(res)),
      () => mockData.getSubscriptions(status)
    ),
};
