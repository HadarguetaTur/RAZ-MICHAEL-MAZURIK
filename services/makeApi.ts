/**
 * Make.com API Service
 * Handles communication with Make scenarios through Vite proxy
 * 
 * The Vite proxy is configured to forward /api/make/* to Make.com API
 * with authentication automatically added.
 */

export interface SendTeacherCancelParams {
  phone: string;       // Normalized phone number (e.g., "504343547")
  date: string;        // ISO date format (e.g., "2026-02-01")
  name: string;        // Student name
}

export interface SendTeacherCancelResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Normalize Israeli phone number to digits only
 * Removes +972, leading 0, spaces, and dashes
 * @param phone - Raw phone number string
 * @returns Normalized phone (e.g., "504343547")
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  
  // Handle Israeli country code +972 or 972
  if (digits.startsWith('972')) {
    digits = digits.slice(3);
  }
  
  // Remove leading 0 if present
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  
  return digits;
}

/**
 * Format date to ISO format (YYYY-MM-DD)
 * @param date - Date string in various formats
 * @returns ISO date string
 */
export function formatDateForMake(date: string): string {
  if (!date) return '';
  
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  
  // Try to parse and format
  try {
    const dateObj = new Date(date);
    return dateObj.toISOString().split('T')[0];
  } catch {
    return date;
  }
}

// Get scenario IDs from environment
const TEACHER_CANCEL_SCENARIO_ID = import.meta.env.VITE_MAKE_SCENARIO_TEACHER_CANCEL_ID || '';
const CREATE_LESSON_SCENARIO_ID = import.meta.env.VITE_MAKE_SCENARIO_CREATE_LESSON_ID || '';
const CANCEL_LESSON_SCENARIO_ID = import.meta.env.VITE_MAKE_SCENARIO_CANCEL_LESSON_ID || '';

/**
 * Trigger a Make scenario with data
 * Uses the Vite proxy which forwards to Make.com API
 * 
 * @param scenarioId - The Make scenario ID to trigger
 * @param data - Data to pass to the scenario
 * @returns Result with success status
 */
async function triggerMakeScenario(
  scenarioId: string,
  data: Record<string, unknown>
): Promise<{ success: boolean; error?: string; responseData?: any }> {
  console.log('[makeApi] triggerMakeScenario called with:', { scenarioId, data });
  
  if (!scenarioId) {
    console.error('[makeApi] No scenario ID provided');
    return {
      success: false,
      error: 'Scenario ID not configured',
    };
  }

  try {
    // Make.com On-Demand API endpoint: POST /scenarios/{scenarioId}/run
    // The Vite proxy rewrites /api/make to /api/v2
    const url = `/api/make/scenarios/${scenarioId}/run`;
    console.log('[makeApi] Calling Make.com API:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });

    console.log('[makeApi] Response status:', response.status);
    const responseText = await response.text();
    console.log('[makeApi] Response body:', responseText);

    if (!response.ok) {
      let errorMessage = `Make API error (${response.status})`;
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        errorMessage = responseText || errorMessage;
      }
      console.error('[makeApi] triggerMakeScenario error:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }
    
    console.log('[makeApi] triggerMakeScenario SUCCESS:', responseData);
    return { success: true, responseData };
  } catch (err: any) {
    console.error('[makeApi] triggerMakeScenario network error:', err);
    return {
      success: false,
      error: err.message || 'Network error',
    };
  }
}

/**
 * Send teacher cancellation notification via Make scenario
 * This triggers the "הודעת ביטול ע\"י מורה" scenario
 * 
 * @param params - Phone, date, and name for the notification
 * @returns Result with success status and any error message
 */
export interface TriggerCreateLessonParams {
  lessonId: string;       // Airtable lesson record ID
  studentId: string;      // Airtable student record ID
  teacherId?: string;     // Airtable teacher record ID
  date: string;           // ISO date format (e.g., "2026-02-01")
  startTime: string;      // Time format (e.g., "08:00")
  duration: number;       // Duration in minutes
  lessonType?: string;    // private, pair, group
}

export interface TriggerCreateLessonResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Trigger Make scenario to create/sync calendar event for a lesson
 * This triggers the "Admin → Create/Sync Calendar Event" scenario
 * 
 * @param params - Lesson details for the scenario
 * @returns Result with success status and any error message
 */
export async function triggerCreateLessonScenario(
  params: TriggerCreateLessonParams
): Promise<TriggerCreateLessonResult> {
  const { lessonId, studentId, teacherId, date, startTime, duration, lessonType } = params;
  
  // Validate required fields
  if (!lessonId || !studentId || !date || !startTime) {
    console.error('[makeApi] triggerCreateLessonScenario missing required fields:', { lessonId, studentId, date, startTime });
    return {
      success: false,
      error: 'חסרים פרטים ליצירת אירוע בלוח שנה',
    };
  }
  
  // Check if scenario ID is configured
  if (!CREATE_LESSON_SCENARIO_ID) {
    console.error('[makeApi] VITE_MAKE_SCENARIO_CREATE_LESSON_ID not configured');
    return {
      success: false,
      error: 'סנריו יצירת שיעור לא מוגדר. יש להגדיר VITE_MAKE_SCENARIO_CREATE_LESSON_ID',
    };
  }
  
  console.log('[makeApi] Triggering CREATE_LESSON scenario:', {
    scenarioId: CREATE_LESSON_SCENARIO_ID,
    lessonId,
    studentId,
    date,
    startTime,
    duration,
  });
  
  // Trigger the Make scenario
  const result = await triggerMakeScenario(CREATE_LESSON_SCENARIO_ID, {
    lessonId,
    studentId,
    teacherId: teacherId || '',
    date: formatDateForMake(date),
    startTime,
    duration,
    lessonType: lessonType || 'private',
  });
  
  if (result.success) {
    console.log('[makeApi] CREATE_LESSON scenario triggered successfully for lesson:', lessonId);
    return {
      success: true,
      message: 'האירוע נוצר בלוח השנה בהצלחה',
    };
  } else {
    console.error('[makeApi] CREATE_LESSON scenario failed:', result.error);
    return {
      success: false,
      error: result.error || 'שגיאה ביצירת אירוע בלוח השנה',
    };
  }
}

export interface TriggerCancelLessonParams {
  lessonId: string;       // Airtable lesson record ID
  studentId?: string;     // Airtable student record ID
  date: string;           // ISO date format (e.g., "2026-02-01")
  startTime?: string;     // Time format (e.g., "08:00")
}

export interface TriggerCancelLessonResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Trigger Make scenario to delete calendar event for a cancelled lesson
 * This triggers the "Admin → Cancel Lesson + Delete Calendar Event" scenario
 * 
 * @param params - Lesson details for the scenario
 * @returns Result with success status and any error message
 */
export async function triggerCancelLessonScenario(
  params: TriggerCancelLessonParams
): Promise<TriggerCancelLessonResult> {
  const { lessonId, studentId, date, startTime } = params;
  
  // Validate required fields
  if (!lessonId || !date) {
    console.error('[makeApi] triggerCancelLessonScenario missing required fields:', { lessonId, date });
    return {
      success: false,
      error: 'חסרים פרטים למחיקת אירוע מלוח שנה',
    };
  }
  
  // Check if scenario ID is configured
  if (!CANCEL_LESSON_SCENARIO_ID) {
    console.error('[makeApi] VITE_MAKE_SCENARIO_CANCEL_LESSON_ID not configured');
    return {
      success: false,
      error: 'סנריו ביטול שיעור לא מוגדר. יש להגדיר VITE_MAKE_SCENARIO_CANCEL_LESSON_ID',
    };
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'makeApi.ts:triggerCancelLessonScenario',message:'Triggering CANCEL_LESSON scenario',data:{scenarioId:CANCEL_LESSON_SCENARIO_ID,lessonId,date,startTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H7'})}).catch(()=>{});
  // #endregion
  
  console.log('[makeApi] Triggering CANCEL_LESSON scenario:', {
    scenarioId: CANCEL_LESSON_SCENARIO_ID,
    lessonId,
    date,
    startTime,
  });
  
  // Trigger the Make scenario
  const result = await triggerMakeScenario(CANCEL_LESSON_SCENARIO_ID, {
    lessonId,
    studentId: studentId || '',
    date: formatDateForMake(date),
    startTime: startTime || '',
  });
  
  if (result.success) {
    console.log('[makeApi] CANCEL_LESSON scenario triggered successfully for lesson:', lessonId);
    return {
      success: true,
      message: 'האירוע נמחק מלוח השנה בהצלחה',
    };
  } else {
    console.error('[makeApi] CANCEL_LESSON scenario failed:', result.error);
    return {
      success: false,
      error: result.error || 'שגיאה במחיקת אירוע מלוח השנה',
    };
  }
}

export async function sendTeacherCancelNotification(
  params: SendTeacherCancelParams
): Promise<SendTeacherCancelResult> {
  const { phone, date, name } = params;
  
  // Validate required fields
  if (!phone || !date || !name) {
    return {
      success: false,
      error: 'חסרים פרטים לשליחת ההודעה (טלפון, תאריך או שם)',
    };
  }
  
  // Normalize phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone || normalizedPhone.length < 9) {
    return {
      success: false,
      error: 'מספר טלפון לא תקין',
    };
  }
  
  // Format date
  const formattedDate = formatDateForMake(date);
  
  // Check if scenario ID is configured
  if (!TEACHER_CANCEL_SCENARIO_ID) {
    console.error('[makeApi] VITE_MAKE_SCENARIO_TEACHER_CANCEL_ID not configured');
    return {
      success: false,
      error: 'סנריו ההודעות לא מוגדר. יש להגדיר VITE_MAKE_SCENARIO_TEACHER_CANCEL_ID',
    };
  }
  
  // Trigger the Make scenario
  const result = await triggerMakeScenario(TEACHER_CANCEL_SCENARIO_ID, {
    phone: normalizedPhone,
    date: formattedDate,
    name: name.trim(),
  });
  
  if (result.success) {
    return {
      success: true,
      message: 'ההודעה נשלחה בהצלחה',
    };
  } else {
    return {
      success: false,
      error: result.error || 'שגיאה בשליחת ההודעה',
    };
  }
}
