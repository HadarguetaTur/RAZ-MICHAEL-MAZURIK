/**
 * Mutations wrapper with automatic cache invalidation
 */

import { nexusApi } from '../services/nexusApi';
import { Lesson, WeeklySlot, SlotInventory, Subscription, MonthlyBill, HomeworkAssignment, Student } from '../types';
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
  
  // Invalidate all lessons cache (since we don't know the exact range)
  invalidateLessons();
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] createLesson | invalidated: lessons:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  // Invalidate all lessons cache
  invalidateLessons();
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateLesson | invalidated: lessons:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] createWeeklySlot | invalidated: weekly_slot:*, slot_inventory:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateWeeklySlot | invalidated: weekly_slot:*, slot_inventory:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] deleteWeeklySlot | invalidated: weekly_slot:*, slot_inventory:* | calls/min: ${stats.callsPerMinute}`);
  }
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateSlotInventory | invalidated: slot_inventory:* | calls/min: ${stats.callsPerMinute}`);
  }
  
  return result;
}

/**
 * Delete slot inventory
 */
export async function deleteSlotInventory(id: string): Promise<void> {
  await nexusApi.deleteSlotInventory(id);
  
  // Invalidate slot inventory
  invalidateSlotInventory();
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] deleteSlotInventory | invalidated: slot_inventory:* | calls/min: ${stats.callsPerMinute}`);
  }
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateSlotInventoryWithLesson | invalidated: lessons:*, slot_inventory:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] createSubscription | invalidated: subscriptions:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateSubscription | invalidated: subscriptions:* | calls/min: ${stats.callsPerMinute}`);
  }
  
  return result;
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateBillAdjustment | invalidated: billing:* | calls/min: ${stats.callsPerMinute}`);
  }
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] createMonthlyCharges | invalidated: billing:${billingMonth}:* | calls/min: ${stats.callsPerMinute}`);
  }
  
  return result;
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] assignHomework | invalidated: homework:* | calls/min: ${stats.callsPerMinute}`);
  }
  
  return result;
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateStudent | invalidated: students:* | calls/min: ${stats.callsPerMinute}`);
  }
  
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
  
  if (import.meta.env.DEV) {
    const stats = getApiStats();
    console.log(`[Mutations] updateStudentNotes | invalidated: students:* | calls/min: ${stats.callsPerMinute}`);
  }
  
  return result;
}
