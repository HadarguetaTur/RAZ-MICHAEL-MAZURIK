/**
 * Mutations wrapper with automatic cache invalidation
 */

import { nexusApi } from '../services/nexusApi';
import { Lesson, WeeklySlot, SlotInventory, Subscription, MonthlyBill, HomeworkAssignment, HomeworkLibraryItem, Student } from '../types';
import {
  invalidateLessons,
  type LessonsRange,
} from './resources/lessons';
import {
  invalidateWeeklySlots,
} from './resources/weeklySlots';
import {
  invalidateSlotInventory,
  type SlotInventoryRange,
} from './resources/slotInventory';
import {
  invalidateStudents,
} from './resources/students';
import {
  invalidateTeachers,
} from './resources/teachers';
import {
  invalidateBilling,
} from './resources/billing';
import {
  invalidateSubscriptions,
} from './resources/subscriptions';
import {
  invalidateHomework,
} from './resources/homework';
import { getApiStats } from './fetchWithCache';

/**
 * Create a new lesson
 */
export async function createLesson(lesson: Partial<Lesson>): Promise<Lesson> {
  const result = await nexusApi.createLesson(lesson);
  
  // Invalidate both lessons and slot inventory (slots may have been auto-closed)
  invalidateLessons();
  invalidateSlotInventory();
  
  
  return result;
}

/**
 * Update a lesson
 */
export async function updateLesson(
  id: string,
  updates: Partial<Lesson>
): Promise<Lesson> {
  const result = await nexusApi.updateLesson(id, updates);
  
  // If lesson was cancelled, reopen linked slot_inventory records
  // LessonStatus.CANCELLED = 'בוטל' (Hebrew), so check both English and Hebrew values
  if (updates.status === 'CANCELLED' || updates.status === 'cancelled' || updates.status === 'בוטל') {
    try {
      const { reopenSlotsForCancelledLesson } = await import('../services/slotReopeningService');
      const reopenedSlots = await reopenSlotsForCancelledLesson(id);
      if (import.meta.env.DEV) {
        if (reopenedSlots.length > 0) {
        } else {
        }
      }
    } catch (error) {
      // Don't fail lesson update if slot reopening fails
      console.warn(`[Mutations] updateLesson | Failed to reopen slots for cancelled lesson ${id}:`, error);
    }
  }
  
  // Invalidate both lessons and slot inventory (slots may have been auto-closed or reopened)
  invalidateLessons();
  invalidateSlotInventory();
  
  return result;
}

/**
 * Create a weekly slot
 */
export async function createWeeklySlot(
  slot: Partial<WeeklySlot>
): Promise<WeeklySlot> {
  const result = await nexusApi.createWeeklySlot(slot);
  
  // Invalidate weekly slots and slot inventory (since weekly slots generate inventory)
  invalidateWeeklySlots();
  invalidateSlotInventory();
  
  
  return result;
}

/**
 * Update a weekly slot
 */
export async function updateWeeklySlot(
  id: string,
  updates: Partial<WeeklySlot>
): Promise<WeeklySlot> {
  const result = await nexusApi.updateWeeklySlot(id, updates);
  
  // Invalidate weekly slots and slot inventory
  invalidateWeeklySlots();
  invalidateSlotInventory();
  
  
  return result;
}

/**
 * Delete a weekly slot
 */
export async function deleteWeeklySlot(id: string): Promise<void> {
  await nexusApi.deleteWeeklySlot(id);
  
  // Invalidate weekly slots and slot inventory
  invalidateWeeklySlots();
  invalidateSlotInventory();
  
}

/**
 * Create a one-time slot inventory entry
 */
export async function createSlotInventory(
  data: Parameters<typeof nexusApi.createSlotInventory>[0]
): Promise<SlotInventory> {
  const result = await nexusApi.createSlotInventory(data);
  invalidateSlotInventory();
  return result;
}

/**
 * Update slot inventory
 */
export async function updateSlotInventory(
  id: string,
  updates: Partial<SlotInventory>
): Promise<SlotInventory> {
  const result = await nexusApi.updateSlotInventory(id, updates);
  
  // Invalidate slot inventory
  invalidateSlotInventory();
  
  
  return result;
}

/**
 * Delete slot inventory
 */
export async function deleteSlotInventory(id: string): Promise<void> {
  await nexusApi.deleteSlotInventory(id);
  
  // Invalidate slot inventory
  invalidateSlotInventory();
  
}

/**
 * Update slot inventory with lesson (creates lesson and updates slot)
 */
export async function updateSlotInventoryWithLesson(
  slotId: string,
  lessonData: Partial<Lesson>
): Promise<{ lesson: Lesson; slot: SlotInventory }> {
  const result = await nexusApi.updateSlotInventoryWithLesson(slotId, lessonData);
  
  // Invalidate both lessons and slot inventory
  invalidateLessons();
  invalidateSlotInventory();
  
  
  return result;
}

/**
 * Create a subscription
 */
export async function createSubscription(
  subscription: Partial<Subscription>
): Promise<Subscription> {
  // Use subscriptionsService instead of nexusApi
  const { subscriptionsService } = await import('../services/subscriptionsService');
  const result = await subscriptionsService.createSubscription(subscription);
  
  // Invalidate subscriptions cache
  invalidateSubscriptions();
  
  
  return result;
}

/**
 * Update a subscription
 */
export async function updateSubscription(
  id: string,
  updates: Partial<Subscription>
): Promise<Subscription> {
  // Use subscriptionsService instead of nexusApi
  const { subscriptionsService } = await import('../services/subscriptionsService');
  const result = await subscriptionsService.updateSubscription(id, updates);
  
  // Invalidate subscriptions cache
  invalidateSubscriptions();
  
  
  return result;
}

/**
 * Update billing status
 */
export async function updateBillStatus(
  billId: string,
  fields: { approved?: boolean; linkSent?: boolean; paid?: boolean },
  month?: string
): Promise<void> {
  await nexusApi.updateBillStatus(billId, fields);
  
  // Invalidate billing cache
  invalidateBilling(month);
  
}

/**
 * Update bill adjustment
 */
export async function updateBillAdjustment(
  id: string,
  adjustment: { amount: number; reason: string }
): Promise<void> {
  await nexusApi.updateBillAdjustment(id, adjustment);
  
  // Invalidate billing cache (we don't know the exact month, so invalidate all)
  invalidateBilling();
  
}

/**
 * Create monthly charges
 */
export async function createMonthlyCharges(
  billingMonth: string
): Promise<{ createdCount: number; skippedCount: number; errors?: any[] }> {
  const result = await nexusApi.createMonthlyCharges(billingMonth);
  
  // Invalidate billing cache for the specific month
  invalidateBilling(billingMonth);
  
  
  return result;
}

/**
 * Delete a bill
 */
export async function deleteBill(billId: string, month?: string): Promise<void> {
  await nexusApi.deleteBill(billId);
  
  // Invalidate billing cache
  invalidateBilling(month);
  
}

/**
 * Assign homework to a student
 */
export async function assignHomework(
  payload: Partial<HomeworkAssignment>
): Promise<HomeworkAssignment> {
  const result = await nexusApi.assignHomework(payload);
  
  // Invalidate homework assignments cache
  invalidateHomework();
  
  
  return result;
}

/**
 * Create a new homework library item
 */
export async function createHomeworkLibraryItem(
  item: Partial<HomeworkLibraryItem>
): Promise<HomeworkLibraryItem> {
  const result = await nexusApi.createHomeworkLibraryItem(item);
  invalidateHomework();
  return result;
}

/**
 * Update a homework library item
 */
export async function updateHomeworkLibraryItem(
  id: string,
  updates: Partial<HomeworkLibraryItem>
): Promise<HomeworkLibraryItem> {
  const result = await nexusApi.updateHomeworkLibraryItem(id, updates);
  invalidateHomework();
  return result;
}

/**
 * Delete a homework library item
 */
export async function deleteHomeworkLibraryItem(id: string): Promise<void> {
  await nexusApi.deleteHomeworkLibraryItem(id);
  invalidateHomework();
}

/**
 * Update student details
 */
export async function updateStudent(
  studentId: string,
  updates: Partial<Student>
): Promise<Student> {
  const result = await nexusApi.updateStudent(studentId, updates);
  
  // Invalidate students cache
  invalidateStudents();
  
  
  return result;
}

/**
 * Create a new student
 */
export async function createStudent(
  student: Partial<Student>
): Promise<Student> {
  const result = await nexusApi.createStudent(student);
  
  // Invalidate students cache to refresh the list
  invalidateStudents();
  
  
  return result;
}

/**
 * Update student notes
 */
export async function updateStudentNotes(
  studentId: string,
  notes: string
): Promise<Student> {
  const result = await nexusApi.updateStudent(studentId, { notes });
  
  // Invalidate students cache
  invalidateStudents();
  
  
  return result;
}
