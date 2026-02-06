/**
 * Date utility functions for weekly slot management
 */

/** Day names in Hebrew (index 0 = Sunday, 6 = Saturday). Used for weekly_slot day_of_week field in Airtable. */
export const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

/** Map Hebrew day name to 0-6 (0 = Sunday). Used when reading day_of_week from Airtable. */
export const DAY_HEBREW_TO_NUM: Record<string, number> = {
  'ראשון': 0,
  'שני': 1,
  'שלישי': 2,
  'רביעי': 3,
  'חמישי': 4,
  'שישי': 5,
  'שבת': 6,
};

/**
 * Get the start of the week (Sunday) for a given date
 * @param date - Reference date
 * @returns Date object set to Sunday 00:00:00 of that week
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  const diff = d.getDate() - day; // Days to subtract to get to Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Add weeks to a date
 * @param date - Base date
 * @param weeks - Number of weeks to add
 * @returns New date
 */
export function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + (weeks * 7));
  return result;
}

/**
 * Get date for a specific day of week within a week
 * @param weekStart - Start of the week (Sunday)
 * @param dayOfWeek - Day of week (0 = Sunday, 6 = Saturday)
 * @returns Date for that day
 */
export function getDateForDayOfWeek(weekStart: Date, dayOfWeek: number): Date {
  const result = new Date(weekStart);
  result.setDate(result.getDate() + dayOfWeek);
  return result;
}

/**
 * Calculate the two open weeks (current and next)
 * @param referenceDate - Reference date (usually now)
 * @returns Tuple of [currentWeekStart, nextWeekStart]
 */
export function calculateOpenWeeks(referenceDate: Date): [Date, Date] {
  const currentWeekStart = getWeekStart(referenceDate);
  const nextWeekStart = addWeeks(currentWeekStart, 1);
  return [currentWeekStart, nextWeekStart];
}

/**
 * Get the next week start after the given week
 * @param weekStart - Current week start
 * @returns Next week start
 */
export function getNextWeekStart(weekStart: Date): Date {
  return addWeeks(weekStart, 1);
}

/**
 * Format date as YYYY-MM-DD in local time (for display and slot date matching).
 * Use this instead of date.toISOString().split('T')[0] to avoid UTC shifting the calendar date.
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string as local midnight (not UTC) so week navigation stays in local time.
 */
export function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/**
 * Calculate duration in minutes from start and end times
 * @param startTime - Start time (HH:mm format)
 * @param endTime - End time (HH:mm format)
 * @returns Duration in minutes
 */
export function calculateDuration(startTime: string, endTime: string): number {
  if (!startTime || !endTime) {
    throw new Error(`calculateDuration: missing startTime or endTime. startTime=${startTime}, endTime=${endTime}`);
  }
  
  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;
  
  const duration = endTotal - startTotal;
  
  return duration;
}

/**
 * Generate natural key for slot inventory
 * Format: teacherId_date_startTime
 * @param teacherId - Teacher record ID
 * @param date - Date of the slot
 * @param startTime - Start time (HH:mm)
 * @returns Natural key string
 */
export function generateNaturalKey(teacherId: string, date: Date, startTime: string): string {
  if (!teacherId || !startTime || startTime === '') {
    throw new Error(`generateNaturalKey: missing required parameters. teacherId=${teacherId}, startTime=${startTime}`);
  }
  const dateStr = formatDate(date);
  return `${teacherId}_${dateStr}_${startTime}`;
}

