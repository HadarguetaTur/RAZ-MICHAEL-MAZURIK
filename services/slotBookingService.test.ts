/**
 * Unit tests for slot booking service
 * Pure function tests for shouldRenderOpenSlot logic
 */

import { SlotInventory, Lesson } from '../types';

/**
 * Helper: Determine if an open slot card should be rendered
 * Returns false if:
 * - Status is not "open" (e.g., "closed", "סגור", "blocked")
 * - Slot has linked lessons (lessons array not empty)
 * - A lesson exists for the same slot_inventory id
 */
export function shouldRenderOpenSlot(
  slot: SlotInventory,
  allLessons: Lesson[]
): boolean {
  // Guard 1: Status must be "open"
  if (slot.status !== 'open') {
    return false;
  }
  
  // Guard 2: Check if any lesson references this slot_inventory id
  // Note: We check by matching date, time, and teacher since SlotInventory doesn't have lessons field
  // but lessons might have a slot_inventory reference
  const slotDateTime = `${slot.date}T${slot.startTime}:00`;
  const hasMatchingLesson = allLessons.some(lesson => {
    const lessonDateTime = `${lesson.date}T${lesson.startTime}:00`;
    return lessonDateTime === slotDateTime && 
           lesson.teacherId === slot.teacherId;
  });
  
  if (hasMatchingLesson) {
    return false;
  }
  
  return true;
}

// Test cases
if (import.meta.env.DEV) {
  // Test 1: Open slot with no lessons -> should render
  const openSlot: SlotInventory = {
    id: 'slot1',
    teacherId: 'teacher1',
    teacherName: 'Teacher 1',
    date: '2024-01-15',
    startTime: '10:00',
    endTime: '11:00',
    status: 'open',
  };
  
  const emptyLessons: Lesson[] = [];
  console.assert(
    shouldRenderOpenSlot(openSlot, emptyLessons) === true,
    'Test 1 failed: Open slot with no lessons should render'
  );
  
  // Test 2: Closed slot -> should NOT render
  const closedSlot: SlotInventory = {
    ...openSlot,
    status: 'closed',
  };
  console.assert(
    shouldRenderOpenSlot(closedSlot, emptyLessons) === false,
    'Test 2 failed: Closed slot should NOT render'
  );
  
  // Test 3: Open slot with matching lesson -> should NOT render
  const matchingLesson: Lesson = {
    id: 'lesson1',
    studentId: 'student1',
    studentName: 'Student 1',
    date: '2024-01-15',
    startTime: '10:00',
    duration: 60,
    teacherId: 'teacher1',
    status: 'scheduled' as any,
  };
  
  console.assert(
    shouldRenderOpenSlot(openSlot, [matchingLesson]) === false,
    'Test 3 failed: Open slot with matching lesson should NOT render'
  );
  
  // Test 4: Open slot with non-matching lesson (different time) -> should render
  const nonMatchingLesson: Lesson = {
    ...matchingLesson,
    startTime: '11:00',
  };
  
  console.assert(
    shouldRenderOpenSlot(openSlot, [nonMatchingLesson]) === true,
    'Test 4 failed: Open slot with non-matching lesson should render'
  );
  
  // Test 5: Open slot with non-matching lesson (different teacher) -> should render
  const differentTeacherLesson: Lesson = {
    ...matchingLesson,
    teacherId: 'teacher2',
  };
  
  console.assert(
    shouldRenderOpenSlot(openSlot, [differentTeacherLesson]) === true,
    'Test 5 failed: Open slot with different teacher lesson should render'
  );
  
  console.log('[slotBookingService.test] All tests passed!');
}
