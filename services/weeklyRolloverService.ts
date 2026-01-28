/**
 * Weekly Rollover Service
 * Handles the weekly rollover process: closing past week and opening new week
 */

import { calculateOpenWeeks, getNextWeekStart, formatDate } from './dateUtils';
import { createSlotInventoryForWeek, createFixedLessonsForWeek } from './slotManagementService';

/**
 * Close a past week (logical operation - no deletion)
 * Currently, slot_inventory records are kept, so this is mainly for logging
 */
export async function closePastWeek(weekStart: Date): Promise<void> {
  console.log(`[weeklyRolloverService] Closing week starting ${formatDate(weekStart)}`);
  // No actual deletion - records are kept in Airtable
  // This function is here for future enhancements (e.g., status updates)
}

/**
 * Open a new week
 * Creates slot_inventory and fixed lessons for the new week
 */
export async function openNewWeek(weekStart: Date): Promise<{
  slotInventoryCount: number;
  fixedLessonsCount: number;
}> {
  console.log(`[weeklyRolloverService] Opening week starting ${formatDate(weekStart)}`);
  
  // Create slot inventory for non-fixed slots
  const slotInventoryCount = await createSlotInventoryForWeek(weekStart);
  
  // Create fixed lessons
  const fixedLessonsCount = await createFixedLessonsForWeek(weekStart);
  
  return {
    slotInventoryCount,
    fixedLessonsCount,
  };
}

/**
 * Perform weekly rollover
 * This is the main function that should be called on Friday mornings
 * 
 * Process:
 * 1. Calculate current open weeks
 * 2. Determine the new week to open
 * 3. Close the past week (logical)
 * 4. Open the new week (create slots and lessons)
 */
export async function performWeeklyRollover(referenceDate?: Date): Promise<{
  closedWeek: Date;
  openedWeek: Date;
  slotInventoryCount: number;
  fixedLessonsCount: number;
}> {
  const now = referenceDate || new Date();
  console.log(`[weeklyRolloverService] Starting weekly rollover at ${now.toISOString()}`);
  
  // Calculate current open weeks
  const currentOpenWeeks = calculateOpenWeeks(now);
  console.log(`[weeklyRolloverService] Current open weeks: ${formatDate(currentOpenWeeks[0])} to ${formatDate(getNextWeekStart(currentOpenWeeks[1]))}`);
  
  // Calculate the new week to open (week after the second open week)
  const newWeekStart = getNextWeekStart(currentOpenWeeks[1]);
  console.log(`[weeklyRolloverService] New week to open: ${formatDate(newWeekStart)}`);
  
  // Close the past week (first of the two open weeks)
  await closePastWeek(currentOpenWeeks[0]);
  
  // Open the new week
  const { slotInventoryCount, fixedLessonsCount } = await openNewWeek(newWeekStart);
  
  console.log(`[weeklyRolloverService] Rollover completed:`);
  console.log(`  - Closed week: ${formatDate(currentOpenWeeks[0])}`);
  console.log(`  - Opened week: ${formatDate(newWeekStart)}`);
  console.log(`  - Created ${slotInventoryCount} slot inventory records`);
  console.log(`  - Created ${fixedLessonsCount} fixed lessons`);
  
  return {
    closedWeek: currentOpenWeeks[0],
    openedWeek: newWeekStart,
    slotInventoryCount,
    fixedLessonsCount,
  };
}

/**
 * Get current open weeks
 * Returns the two weeks that are currently open for scheduling
 */
export function getCurrentOpenWeeks(referenceDate?: Date): [Date, Date] {
  const now = referenceDate || new Date();
  return calculateOpenWeeks(now);
}
