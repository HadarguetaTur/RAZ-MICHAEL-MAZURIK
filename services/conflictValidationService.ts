/**
 * Conflict Validation Service
 * 
 * Provides comprehensive conflict checking between lessons and open slot_inventory windows.
 * Implements hard rules to prevent overlaps at the data layer.
 */

import { Lesson, SlotInventory } from '../types';
import { nexusApi } from './nexusApi';
import { hasOverlap } from './overlapDetection';
import { invalidateSlotInventory } from '../data/resources/slotInventory';
import { invalidateLessons } from '../data/resources/lessons';

export interface ConflictValidationResult {
  conflicts: {
    lessons: Lesson[];
    openSlots: SlotInventory[];
  };
  canProceed: boolean;
}

export interface ValidationParams {
  teacherId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm (for slots) or duration in minutes (for lessons)
  excludeLessonId?: string;
  excludeSlotId?: string;
}

/**
 * Convert date + time to ISO datetime string
 */
function toISO(date: string, time: string): string {
  const timeStr = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${timeStr}`).toISOString();
}

/**
 * Validate conflicts for a proposed time range
 * Checks both lessons and open slot_inventory windows
 */
export async function validateConflicts(
  params: ValidationParams
): Promise<ConflictValidationResult> {
  const { teacherId, date, startTime, endTime, excludeLessonId, excludeSlotId } = params;
  
  // Calculate time range
  const startISO = toISO(date, startTime);
  // endTime can be either HH:mm (for slots) or duration in minutes (for lessons)
  // If it's a number (duration), calculate end time
  // If it's a string (HH:mm), use it directly
  let endISO: string;
  if (typeof endTime === 'number') {
    const startDate = new Date(startISO);
    endISO = new Date(startDate.getTime() + endTime * 60 * 1000).toISOString();
  } else {
    endISO = toISO(date, endTime);
  }

  // Fetch lessons and open slots for the same teacher and date
  // If teacherId is undefined, check all teachers (no filter)
  const dayStartISO = new Date(`${date}T00:00:00`).toISOString();
  const dayEndISO = new Date(`${date}T23:59:59.999`).toISOString();

  const [lessons, slots] = await Promise.all([
    nexusApi.getLessons(dayStartISO, dayEndISO, teacherId),
    nexusApi.getSlotInventory(dayStartISO, dayEndISO, teacherId), // undefined teacherId means all teachers
  ]);

  // Filter out excluded records
  const filteredLessons = excludeLessonId
    ? lessons.filter(l => l.id !== excludeLessonId)
    : lessons;
  
  const filteredSlots = excludeSlotId
    ? slots.filter(s => s.id !== excludeSlotId)
    : slots;

  // Check for overlapping lessons (exclude cancelled)
  const conflictingLessons = filteredLessons.filter(lesson => {
    if (lesson.status === 'בוטל' || lesson.status === 'CANCELLED') {
      return false;
    }
    const lessonStartISO = toISO(lesson.date, lesson.startTime);
    const lessonEndISO = new Date(
      new Date(lessonStartISO).getTime() + (lesson.duration || 60) * 60 * 1000
    ).toISOString();
    
    return hasOverlap(startISO, endISO, lessonStartISO, lessonEndISO);
  });

  // Check for overlapping open slots
  // IMPORTANT: slot.status can be 'open' (English) or 'פתוח' (Hebrew) from Airtable
  // Also check if slot has linked lessons - if it does, it's not really "open"
  // If teacherId was provided, also filter by teacher match
  const conflictingOpenSlots = filteredSlots.filter(slot => {
    // Check status: must be 'open' (normalized) or 'פתוח' (Hebrew from Airtable)
    const isOpenStatus = slot.status === 'open' || slot.status === 'פתוח';
    if (!isOpenStatus) {
      return false;
    }
    
    // Also exclude slots that have linked lessons (they're already booked)
    if (slot.lessons && slot.lessons.length > 0) {
      return false;
    }
    
    // If teacherId was provided (and is a valid record ID), filter by teacher match
    // If teacherId is undefined or not a record ID, check all slots
    if (teacherId && teacherId.startsWith('rec') && slot.teacherId !== teacherId) {
      return false;
    }
    
    const slotStartISO = toISO(slot.date, slot.startTime);
    const slotEndISO = toISO(slot.date, slot.endTime);
    const overlaps = hasOverlap(startISO, endISO, slotStartISO, slotEndISO);
    return overlaps;
  });

  return {
    conflicts: {
      lessons: conflictingLessons,
      openSlots: conflictingOpenSlots,
    },
    canProceed: conflictingLessons.length === 0 && conflictingOpenSlots.length === 0,
  };
}

/**
 * Auto-close overlapping open slots
 * Called before creating/updating a lesson to prevent duplicate windows
 */
export async function autoCloseOverlappingSlots(
  teacherId: string,
  date: string,
  startTime: string,
  duration: number,
  lessonId?: string // If provided, link the lesson to the closed slots
): Promise<SlotInventory[]> {
  const startISO = toISO(date, startTime);
  const endISO = new Date(new Date(startISO).getTime() + duration * 60 * 1000).toISOString();
  
  const dayStartISO = new Date(`${date}T00:00:00`).toISOString();
  const dayEndISO = new Date(`${date}T23:59:59.999`).toISOString();

  // Fetch open slots for the same teacher and date
  const slots = await nexusApi.getSlotInventory(dayStartISO, dayEndISO, teacherId);
  // IMPORTANT: slot.status can be 'open' (English) or 'פתוח' (Hebrew) from Airtable
  // Also exclude slots that have linked lessons (they're already booked)
  const openSlots = slots.filter(s => {
    const isOpenStatus = s.status === 'open' || s.status === 'פתוח';
    const hasNoLinkedLessons = !s.lessons || s.lessons.length === 0;
    return isOpenStatus && hasNoLinkedLessons;
  });

  // Find overlapping open slots
  const overlappingSlots = openSlots.filter(slot => {
    const slotStartISO = toISO(slot.date, slot.startTime);
    const slotEndISO = toISO(slot.date, slot.endTime);
    return hasOverlap(startISO, endISO, slotStartISO, slotEndISO);
  });

  if (overlappingSlots.length === 0) {
    return [];
  }


  // Close each overlapping slot and link lesson if provided
  const closedSlots: SlotInventory[] = [];
  const { airtableClient } = await import('./airtableClient');
  const { getTableId, getField } = await import('../contracts/fieldMap');
  const { SlotInventoryAirtableFields } = await import('../contracts/types');

  for (const slot of overlappingSlots) {
    try {
      const slotTableId = getTableId('slotInventory');
      const updateFields: Partial<SlotInventoryAirtableFields> = {
        'סטטוס': 'סגור', // Status = closed
      };

      // Link the lesson if provided
      if (lessonId) {
        try {
          const lessonsField = getField('slotInventory', 'lessons');
          // Get current lessons and add the new one
          const currentLessons = slot.lessons || [];
          const updatedLessons = [...new Set([...currentLessons, lessonId])]; // Avoid duplicates
          (updateFields as any)[lessonsField] = updatedLessons;
        } catch (fieldError) {
          // Field doesn't exist in fieldMap, skip linking lessons
          if (import.meta.env.DEV) {
            console.warn(`[autoCloseOverlappingSlots] lessons field not found in fieldMap, skipping lesson linking`);
          }
        }
      }

      // Update directly via airtableClient to support lesson linking
      await airtableClient.updateRecord<SlotInventoryAirtableFields>(
        slotTableId,
        slot.id,
        updateFields,
        { typecast: true }
      );

      // Fetch updated slot to return
      const updatedSlot = await nexusApi.getSlotInventory(
        dayStartISO,
        dayEndISO,
        teacherId
      ).then(slots => slots.find(s => s.id === slot.id));

      if (updatedSlot) {
        closedSlots.push(updatedSlot);
      }

    } catch (error: any) {
      console.error(`[autoCloseOverlappingSlots] Error closing slot ${slot.id}:`, error);
      // Continue with other slots even if one fails
    }
  }

  // Invalidate cache
  invalidateSlotInventory();
  invalidateLessons();

  return closedSlots;
}

/**
 * Check for overlapping slot_inventory records (internal overlap - warning only)
 * Used when creating/updating slot_inventory to show warnings for overlapping open slots.
 * Returns overlapping slots on the same date (one-off slots only compare same date).
 * Excludes self if excludeSlotId is provided.
 */
export async function findOverlappingSlotInventory(
  teacherId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeSlotId?: string
): Promise<SlotInventory[]> {
  const startISO = toISO(date, startTime);
  const endISO = toISO(date, endTime);

  const dayStartISO = new Date(`${date}T00:00:00`).toISOString();
  const dayEndISO = new Date(`${date}T23:59:59.999`).toISOString();

  // Fetch slot_inventory for the same teacher and date (one-off slots compare only same date)
  const slots = await nexusApi.getSlotInventory(dayStartISO, dayEndISO, teacherId);

  // Filter to only open slots (status='open' or 'פתוח')
  const openSlots = slots.filter(slot => {
    const isOpenStatus = slot.status === 'open' || slot.status === 'פתוח';
    return isOpenStatus;
  });

  // Check for overlapping slots (exclude self if excludeSlotId provided)
  const overlappingSlots = openSlots.filter(slot => {
    // Self-exclusion: skip the slot being edited
    if (excludeSlotId && slot.id === excludeSlotId) {
      return false;
    }
    
    // Scope: one-off slots compare only same date (already filtered by date range above)
    if (slot.date !== date) {
      return false;
    }
    
    const slotStartISO = toISO(slot.date, slot.startTime);
    const slotEndISO = toISO(slot.date, slot.endTime);
    
    return hasOverlap(startISO, endISO, slotStartISO, slotEndISO);
  });

  return overlappingSlots;
}

/**
 * Prevent opening a slot if lessons overlap (blocking check)
 * Called before creating/updating a slot_inventory with status="open"
 * Returns blocking result: cannot open if lessons overlap.
 * Excludes self if excludeSlotId is provided (for edit mode).
 */
export async function preventSlotOpeningIfLessonsOverlap(
  teacherId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeSlotId?: string
): Promise<{ canOpen: boolean; conflictingLessons: Lesson[] }> {
  const startISO = toISO(date, startTime);
  const endISO = toISO(date, endTime);

  const dayStartISO = new Date(`${date}T00:00:00`).toISOString();
  const dayEndISO = new Date(`${date}T23:59:59.999`).toISOString();

  // Fetch lessons for the same teacher and date
  const lessons = await nexusApi.getLessons(dayStartISO, dayEndISO, teacherId);

  // Check for overlapping lessons (exclude cancelled)
  // Self-exclusion: excludeSlotId is for slot_inventory, not lessons, but we keep parameter for API consistency
  const conflictingLessons = lessons.filter(lesson => {
    if (lesson.status === 'בוטל' || lesson.status === 'CANCELLED') {
      return false;
    }
    
    // Scope: compare only same date (one-off slots)
    if (lesson.date !== date) {
      return false;
    }
    
    const lessonStartISO = toISO(lesson.date, lesson.startTime);
    const lessonEndISO = new Date(
      new Date(lessonStartISO).getTime() + (lesson.duration || 60) * 60 * 1000
    ).toISOString();
    
    return hasOverlap(startISO, endISO, lessonStartISO, lessonEndISO);
  });

  return {
    canOpen: conflictingLessons.length === 0,
    conflictingLessons,
  };
}
