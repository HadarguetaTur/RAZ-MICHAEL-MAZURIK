/**
 * Date utility functions for weekly slot management
 */

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
 * Format date as YYYY-MM-DD
 * @param date - Date to format
 * @returns Formatted date string
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate duration in minutes from start and end times
 * @param startTime - Start time (HH:mm format)
 * @param endTime - End time (HH:mm format)
 * @returns Duration in minutes
 */
export function calculateDuration(startTime: string, endTime: string): number {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dateUtils.ts:81',message:'calculateDuration entry',data:{startTime:startTime,startTimeType:typeof startTime,startTimeIsUndefined:startTime===undefined,startTimeIsNull:startTime===null,endTime:endTime,endTimeType:typeof endTime,endTimeIsUndefined:endTime===undefined,endTimeIsNull:endTime===null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  if (!startTime || !endTime) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dateUtils.ts:85',message:'calculateDuration missing params',data:{startTime:startTime,endTime:endTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    throw new Error(`calculateDuration: missing startTime or endTime. startTime=${startTime}, endTime=${endTime}`);
  }
  
  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dateUtils.ts:90',message:'calculateDuration after split',data:{startHours:startHours,startMinutes:startMinutes,endHours:endHours,endMinutes:endMinutes},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;
  
  const duration = endTotal - startTotal;
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'dateUtils.ts:97',message:'calculateDuration result',data:{duration:duration},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
  // #endregion
  
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
